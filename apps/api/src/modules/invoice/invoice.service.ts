import { Injectable } from '@nestjs/common';
import {
  ActorType,
  ChargeCalculationType,
  InvoiceStatus,
  InvoiceType,
  Prisma,
} from '@prisma/client';

import {
  ErrorCode,
  ISSUED_INVOICE_STATUSES,
  Paginated,
  TimelineEventType,
} from '@smartpark/contracts';
import { AppException, notFound } from '@/common/errors/app-exception';
import { AuthenticatedUser } from '@/common/decorators/auth.decorators';
import { PaginationQueryDto, paginate } from '@/common/dto/pagination.dto';
import { RequestContextStore } from '@/common/context/request-context';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { addMoney, subtractMoney, toPrismaDecimal } from '@/common/money/money';
import { PrismaService, PrismaTransaction } from '@/infrastructure/prisma/prisma.service';
import { DomainEventType, OutboxService } from '@/infrastructure/outbox';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';
import { ChargeService } from '@/modules/billing/charge.service';
import { AccessScope } from '@/modules/identity/guards';
import { InvoiceStateMachine } from '@/modules/shared/state-machine';
import { BILLING_CONTEXT_INCLUDE, BillingPartyService } from './billing-party.service';

export interface GenerateInvoiceInput {
  sessionId: string;
  actorId: string;
  organizationId: string;
  /** Frozen at exit; omit to compute a FINAL calculation now. */
  chargeCalculationId?: string | null;
  /** Retrying with the same key returns the original invoice. */
  idempotencyKey: string;
  /** Collecting party, when a rule resolves to CUSTOMER. */
  customer?: {
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  } | null;
  releaseRequestedForPartyType?: string | null;
  notes?: string | null;
}

const SORTABLE = ['issueDate', 'createdAt', 'total', 'balance', 'dueDate', 'invoiceNumber'] as const;

/**
 * Invoicing.
 *
 * The rules that shape this service:
 *
 *   THE ENGINE IS AUTHORITATIVE. Amounts come from a `ChargeCalculation`
 *   produced by `ChargeEngine`. Nothing here recomputes a charge, and no
 *   caller may supply a total — a client-supplied amount is the classic route
 *   to a fraudulent invoice.
 *
 *   NUMBERS ARE GAP-FREE. `invoice_series.nextSequence` is incremented under a
 *   row lock inside the same transaction that inserts the invoice, so two
 *   concurrent generations cannot take the same number, and a rolled-back
 *   generation does not burn one.
 *
 *   ISSUED MEANS FROZEN. A database trigger rejects any change to an issued
 *   invoice's number, amounts, party or type; another rejects edits to its
 *   lines. Corrections go through void plus credit note, which leaves a trail.
 *
 *   GENERATION IS IDEMPOTENT. `idempotencyKey` is unique, so a retried request
 *   returns the original invoice rather than raising a second one.
 */
@Injectable()
export class InvoiceService {
  private readonly logger: ScopedLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargeService,
    private readonly billingParty: BillingPartyService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Invoice');
  }

  /**
   * Raises a parking invoice for a stay.
   *
   * Runs in the caller's transaction when given one, so a release can create
   * its invoice and advance its own state atomically.
   */
  async generateForSession(
    tx: PrismaTransaction,
    input: GenerateInvoiceInput,
  ): Promise<{ invoiceId: string; invoiceNumber: string; total: string; created: boolean }> {
    // Idempotency first: a retry must not even reach the numbering logic.
    const existing = await tx.invoice.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, invoiceNumber: true, total: true },
    });
    if (existing) {
      this.logger.debug('Invoice generation replayed from idempotency key', {
        invoiceId: existing.id,
      });
      return {
        invoiceId: existing.id,
        invoiceNumber: existing.invoiceNumber,
        total: existing.total.toFixed(4),
        created: false,
      };
    }

    const session = await tx.parkingSession.findUnique({
      where: { id: input.sessionId },
      include: BILLING_CONTEXT_INCLUDE,
    });
    if (!session) throw notFound('Parking session', input.sessionId);

    /* --- 1. The charge calculation ------------------------------- */
    let calculationId = input.chargeCalculationId ?? null;

    if (!calculationId) {
      const result = await this.charges.calculateAndStore(
        tx,
        input.sessionId,
        ChargeCalculationType.FINAL,
        session.exitAt ?? new Date(),
        { requireRate: true, actorId: input.actorId },
      );
      calculationId = result.calculationId;
    }

    if (!calculationId) {
      throw new AppException(
        ErrorCode.NO_APPLICABLE_RATE_PLAN,
        'This stay has no priced charge, so an invoice cannot be raised.',
        { details: { sessionId: input.sessionId } },
      );
    }

    const calculation = await tx.chargeCalculation.findUnique({
      where: { id: calculationId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!calculation) throw notFound('Charge calculation', calculationId);

    if (calculation.sessionId !== input.sessionId) {
      // Defensive: a caller passing another stay's calculation would invoice
      // the wrong amount against the wrong vehicle.
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'The supplied charge calculation belongs to a different stay.',
      );
    }

    /* --- 2. Who is billed ---------------------------------------- */
    const party = await this.billingParty.resolve(tx, {
      session,
      chargeSubtotal: calculation.subtotal.toFixed(4),
      soldAtAuction: false,
      releaseRequestedForPartyType: input.releaseRequestedForPartyType ?? null,
      customerOverride: input.customer ?? null,
    });

    /* --- 3. Number and dates -------------------------------------- */
    const series = await this.allocateNumber(tx, input.organizationId, InvoiceType.PARKING);
    const issueDate = startOfDayUtc(session.exitAt ?? new Date());
    const dueDate = new Date(issueDate.getTime() + party.paymentTermsDays * 86_400_000);

    /* --- 4. Create ------------------------------------------------ */
    const invoice = await tx.invoice.create({
      data: {
        organizationId: input.organizationId,
        siteId: session.siteId,
        seriesId: series.seriesId,
        type: InvoiceType.PARKING,
        // Created directly as GENERATED: the number is allocated and the lines
        // are written in this same transaction, so there is no meaningful
        // DRAFT window for a system-generated parking invoice.
        status: InvoiceStatus.GENERATED,
        invoiceNumber: series.invoiceNumber,
        billingPartyType: party.partyType,
        financierId: party.financierId,
        bidderId: party.bidderId,
        billingPartyName: party.name,
        billingPartyAddress: party.address,
        billingPartyGstin: party.gstin,
        billingPartyEmail: party.email,
        billingPartyPhone: party.phone,
        billingRuleId: party.decision.ruleId,
        sessionId: session.id,
        vehicleId: session.vehicleId,
        chargeCalculationId: calculation.id,
        currency: calculation.currency,
        subtotal: calculation.subtotal,
        taxTotal: calculation.taxTotal,
        total: calculation.total,
        amountPaid: new Prisma.Decimal(0),
        balance: calculation.total,
        notes: input.notes ?? null,
        idempotencyKey: input.idempotencyKey,
        correlationId: RequestContextStore.correlationId(),
        createdById: input.actorId,
        // Lines mirror the charge calculation exactly. Tax lines are separated
        // so the invoice can present them as a tax summary.
        lines: {
          create: calculation.lines
            .filter((line) => line.kind !== 'TAX')
            .map((line, index) => ({
              lineNo: index + 1,
              description: line.description,
              quantity: line.units,
              unitAmount: line.unitAmount,
              amount: line.amount,
              chargeLineId: line.id,
            })),
        },
        taxLines: {
          create: calculation.lines
            .filter((line) => line.kind === 'TAX')
            .map((line, index) => ({
              sequence: index + 1,
              code: `TAX${index + 1}`,
              name: line.description,
              kind: 'PERCENTAGE' as const,
              rate: line.unitAmount,
              taxableAmount: calculation.subtotal,
              amount: line.amount,
            })),
        },
      },
    });

    // Recorded now so the due date is available before issue.
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { dueDate: startOfDayUtc(dueDate) },
    });

    await this.outbox.record(tx, {
      eventType: DomainEventType.INVOICE_GENERATED,
      aggregateType: 'Invoice',
      aggregateId: invoice.id,
      payload: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        organizationId: input.organizationId,
        siteId: session.siteId,
        billingPartyType: party.partyType,
        financierId: party.financierId,
        total: invoice.total.toFixed(4),
        currency: invoice.currency,
        sessionId: session.id,
        vehicleId: session.vehicleId,
      },
    });

    await tx.vehicleTimelineEvent.create({
      data: {
        organizationId: input.organizationId,
        vehicleId: session.vehicleId,
        sessionId: session.id,
        siteId: session.siteId,
        type: TimelineEventType.INVOICE_GENERATED,
        occurredAt: new Date(),
        actorId: input.actorId,
        actorType: ActorType.USER,
        title: `Invoice ${invoice.invoiceNumber} generated`,
        description:
          `${invoice.currency} ${invoice.total.toFixed(2)} to ${party.name} ` +
          `(rule ${party.decision.ruleCode}).`,
        payload: {
          invoiceId: invoice.id,
          billingPartyType: party.partyType,
          billingRule: party.decision.ruleCode,
        },
        correlationId: RequestContextStore.correlationId(),
      },
    });

    await this.audit.record(tx, {
      action: AuditAction.INVOICE_GENERATED,
      entityType: 'Invoice',
      entityId: invoice.id,
      organizationId: input.organizationId,
      siteId: session.siteId,
      afterState: {
        invoiceNumber: invoice.invoiceNumber,
        billingPartyType: party.partyType,
        billingPartyName: party.name,
        total: invoice.total.toFixed(4),
        currency: invoice.currency,
        chargeCalculationId: calculation.id,
        // The rule and its reasoning are recorded so the decision is
        // defensible later, not just the outcome.
        billingRule: party.decision.ruleCode,
        billingRuleReasoning: party.decision.reasoning,
      },
    });

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total.toFixed(4),
      created: true,
    };
  }

  /**
   * Issues an invoice: the point at which it becomes a financial document.
   *
   * After this the database trigger freezes its number, amounts and party.
   */
  async issue(actor: AuthenticatedUser, invoiceId: string): Promise<InvoiceDetail> {
    await this.prisma.transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId: actor.organizationId },
      });
      if (!invoice) throw notFound('Invoice', invoiceId);
      AccessScope.assertSite(actor, invoice.siteId);

      // VALIDATED is an optional intermediate step; both routes are legal.
      if (invoice.status === InvoiceStatus.GENERATED) {
        InvoiceStateMachine.assert(invoice.status, InvoiceStatus.VALIDATED);
      }
      InvoiceStateMachine.assert(
        invoice.status === InvoiceStatus.GENERATED ? InvoiceStatus.VALIDATED : invoice.status,
        InvoiceStatus.ISSUED,
      );

      const now = new Date();
      const issueDate = invoice.issueDate ?? startOfDayUtc(now);

      const updated = await tx.invoice.updateMany({
        where: { id: invoiceId, version: invoice.version },
        data: {
          status: InvoiceStatus.ISSUED,
          issueDate,
          issuedAt: now,
          issuedById: actor.id,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new AppException(
          ErrorCode.CONCURRENT_MODIFICATION,
          'The invoice changed while you were issuing it. Reload and try again.',
        );
      }

      await this.outbox.record(tx, {
        eventType: DomainEventType.INVOICE_ISSUED,
        aggregateType: 'Invoice',
        aggregateId: invoiceId,
        payload: {
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          organizationId: actor.organizationId,
          siteId: invoice.siteId,
          billingPartyType: invoice.billingPartyType,
          financierId: invoice.financierId,
          total: invoice.total.toFixed(4),
          currency: invoice.currency,
          sessionId: invoice.sessionId,
          vehicleId: invoice.vehicleId,
          issuedAt: now.toISOString(),
          dueDate: invoice.dueDate?.toISOString() ?? null,
        },
      });

      if (invoice.vehicleId) {
        await tx.vehicleTimelineEvent.create({
          data: {
            organizationId: actor.organizationId,
            vehicleId: invoice.vehicleId,
            sessionId: invoice.sessionId,
            siteId: invoice.siteId,
            type: TimelineEventType.INVOICE_ISSUED,
            occurredAt: now,
            actorId: actor.id,
            actorType: ActorType.USER,
            title: `Invoice ${invoice.invoiceNumber} issued`,
            correlationId: RequestContextStore.correlationId(),
          },
        });
      }

      await this.audit.record(tx, {
        action: AuditAction.INVOICE_ISSUED,
        entityType: 'Invoice',
        entityId: invoiceId,
        organizationId: actor.organizationId,
        siteId: invoice.siteId,
        beforeState: { status: invoice.status },
        afterState: { status: InvoiceStatus.ISSUED, issuedAt: now.toISOString() },
      });
    });

    return this.findById(actor, invoiceId);
  }

  /**
   * Voids an issued invoice and, when it carried value, raises a credit note.
   *
   * The only sanctioned way to reverse an issued document. The original stays
   * exactly as it was; the credit note is what changes the ledger.
   */
  async voidInvoice(
    actor: AuthenticatedUser,
    invoiceId: string,
    reason: string,
  ): Promise<{ invoice: InvoiceDetail; creditNoteId: string | null }> {
    let creditNoteId: string | null = null;

    await this.prisma.transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId: actor.organizationId },
        include: { lines: { orderBy: { lineNo: 'asc' } }, taxLines: true },
      });
      if (!invoice) throw notFound('Invoice', invoiceId);
      AccessScope.assertSite(actor, invoice.siteId);

      InvoiceStateMachine.assert(invoice.status, InvoiceStatus.VOID);

      const wasIssued = ISSUED_INVOICE_STATUSES.includes(invoice.status);

      const updated = await tx.invoice.updateMany({
        where: { id: invoiceId, version: invoice.version },
        data: {
          status: InvoiceStatus.VOID,
          voidedById: actor.id,
          voidedAt: new Date(),
          voidReason: reason.slice(0, 512),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new AppException(
          ErrorCode.CONCURRENT_MODIFICATION,
          'The invoice changed while you were voiding it. Reload and try again.',
        );
      }

      // A credit note is only meaningful for a document that actually entered
      // the ledger with a value.
      if (wasIssued && invoice.total.greaterThan(0)) {
        const series = await this.allocateNumber(
          tx,
          actor.organizationId,
          InvoiceType.CREDIT_NOTE,
        );
        const now = new Date();

        const creditNote = await tx.invoice.create({
          data: {
            organizationId: actor.organizationId,
            siteId: invoice.siteId,
            seriesId: series.seriesId,
            type: InvoiceType.CREDIT_NOTE,
            status: InvoiceStatus.ISSUED,
            invoiceNumber: series.invoiceNumber,
            issueDate: startOfDayUtc(now),
            issuedAt: now,
            issuedById: actor.id,
            billingPartyType: invoice.billingPartyType,
            financierId: invoice.financierId,
            bidderId: invoice.bidderId,
            billingPartyName: invoice.billingPartyName,
            billingPartyAddress: invoice.billingPartyAddress,
            billingPartyGstin: invoice.billingPartyGstin,
            billingPartyEmail: invoice.billingPartyEmail,
            billingPartyPhone: invoice.billingPartyPhone,
            sessionId: invoice.sessionId,
            vehicleId: invoice.vehicleId,
            relatedInvoiceId: invoice.id,
            currency: invoice.currency,
            // Negative amounts: the CHECK constraint permits them for credit
            // notes specifically, and for nothing else.
            subtotal: invoice.subtotal.negated(),
            taxTotal: invoice.taxTotal.negated(),
            total: invoice.total.negated(),
            amountPaid: new Prisma.Decimal(0),
            balance: invoice.total.negated(),
            notes: `Credit note reversing ${invoice.invoiceNumber}. Reason: ${reason}`.slice(0, 1000),
            idempotencyKey: `credit-note:${invoice.id}`,
            correlationId: RequestContextStore.correlationId(),
            createdById: actor.id,
            lines: {
              create: invoice.lines.map((line) => ({
                lineNo: line.lineNo,
                description: `Reversal: ${line.description}`,
                quantity: line.quantity,
                unitAmount: line.unitAmount.negated(),
                amount: line.amount.negated(),
              })),
            },
          },
        });
        creditNoteId = creditNote.id;

        await this.audit.record(tx, {
          action: AuditAction.CREDIT_NOTE_ISSUED,
          entityType: 'Invoice',
          entityId: creditNote.id,
          organizationId: actor.organizationId,
          siteId: invoice.siteId,
          afterState: {
            creditNoteNumber: creditNote.invoiceNumber,
            reversesInvoice: invoice.invoiceNumber,
            total: creditNote.total.toFixed(4),
          },
          reason,
        });
      }

      await this.outbox.record(tx, {
        eventType: DomainEventType.INVOICE_VOIDED,
        aggregateType: 'Invoice',
        aggregateId: invoiceId,
        payload: {
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          organizationId: actor.organizationId,
          creditNoteId,
          reason,
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.INVOICE_VOIDED,
        entityType: 'Invoice',
        entityId: invoiceId,
        organizationId: actor.organizationId,
        siteId: invoice.siteId,
        beforeState: { status: invoice.status },
        afterState: { status: InvoiceStatus.VOID, creditNoteId },
        reason,
      });
    });

    return { invoice: await this.findById(actor, invoiceId), creditNoteId };
  }

  /**
   * Applies a successful payment to an invoice.
   *
   * Called only by `PaymentService`, inside its transaction. Advances the
   * status to PARTIALLY_PAID or PAID based on the resulting balance — the
   * status is derived from the arithmetic, never asserted by a caller.
   */
  async applyPayment(
    tx: PrismaTransaction,
    invoiceId: string,
    amount: Prisma.Decimal,
  ): Promise<{ amountPaid: string; balance: string; status: InvoiceStatus }> {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw notFound('Invoice', invoiceId);

    const newAmountPaid = addMoney(invoice.amountPaid.toFixed(4), amount.toFixed(4));
    const newBalance = subtractMoney(invoice.total.toFixed(4), newAmountPaid.toFixed(4));

    if (newAmountPaid.greaterThan(invoice.total)) {
      throw new AppException(
        ErrorCode.PAYMENT_EXCEEDS_BALANCE,
        'That payment would exceed the invoice total.',
        {
          details: {
            invoiceTotal: invoice.total.toFixed(4),
            alreadyPaid: invoice.amountPaid.toFixed(4),
            attempted: amount.toFixed(4),
          },
        },
      );
    }

    const nextStatus = newBalance.lessThanOrEqualTo(0)
      ? InvoiceStatus.PAID
      : InvoiceStatus.PARTIALLY_PAID;

    if (invoice.status !== nextStatus) {
      InvoiceStateMachine.assert(invoice.status, nextStatus);
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: toPrismaDecimal(newAmountPaid),
        balance: toPrismaDecimal(newBalance),
        status: nextStatus,
        version: { increment: 1 },
      },
    });

    if (nextStatus === InvoiceStatus.PAID) {
      await this.outbox.record(tx, {
        eventType: DomainEventType.INVOICE_PAID,
        aggregateType: 'Invoice',
        aggregateId: invoiceId,
        payload: {
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          organizationId: invoice.organizationId,
          total: invoice.total.toFixed(4),
          currency: invoice.currency,
        },
      });
    }

    return {
      amountPaid: newAmountPaid.toFixed(4),
      balance: newBalance.toFixed(4),
      status: nextStatus,
    };
  }

  /** Marks an issued invoice as sent. Called by the notification handler. */
  async markSent(tx: PrismaTransaction, invoiceId: string): Promise<void> {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return;
    if (invoice.status !== InvoiceStatus.ISSUED) return;

    InvoiceStateMachine.assert(invoice.status, InvoiceStatus.SENT);
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.SENT, sentAt: new Date(), version: { increment: 1 } },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Queries                                                           */
  /* ---------------------------------------------------------------- */

  async list(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
    filters: {
      status?: InvoiceStatus[];
      type?: InvoiceType;
      financierId?: string;
      siteId?: string;
      search?: string;
      outstandingOnly?: boolean;
      overdueOnly?: boolean;
    },
  ): Promise<Paginated<InvoiceListItem>> {
    const siteFilter = AccessScope.siteFilter(actor);

    const where: Prisma.InvoiceWhereInput = {
      organizationId: actor.organizationId,
      // A financier portal user sees only their own invoices. Mandatory
      // predicate, not a post-load filter.
      ...(actor.financierId ? { financierId: actor.financierId } : {}),
      ...(filters.financierId ? { financierId: filters.financierId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status?.length ? { status: { in: filters.status } } : {}),
      ...(filters.siteId ? { siteId: filters.siteId } : siteFilter ? { siteId: siteFilter } : {}),
      ...(filters.outstandingOnly
        ? { status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] }, balance: { gt: 0 } }
        : {}),
      ...(filters.overdueOnly
        ? {
            status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] },
            balance: { gt: 0 },
            dueDate: { lt: new Date() },
          }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
              { billingPartyName: { contains: filters.search, mode: 'insensitive' } },
              {
                vehicle: {
                  normalizedRegistrationNumber: {
                    contains: filters.search.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: listInclude,
        orderBy: query.orderBy(SORTABLE, 'createdAt'),
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return paginate(rows.map(toListItem), totalItems, query);
  }

  async findById(actor: AuthenticatedUser, invoiceId: string): Promise<InvoiceDetail> {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        organizationId: actor.organizationId,
        ...(actor.financierId ? { financierId: actor.financierId } : {}),
      },
      include: {
        ...listInclude,
        lines: { orderBy: { lineNo: 'asc' } },
        taxLines: { orderBy: { sequence: 'asc' } },
        payments: { orderBy: { initiatedAt: 'desc' } },
        billingRule: { select: { code: true, name: true } },
        chargeCalculation: { select: { id: true, explanation: true, inputsHash: true, engineVersion: true } },
        series: { select: { code: true, prefix: true } },
      },
    });
    if (!invoice) throw notFound('Invoice', invoiceId);

    return {
      ...toListItem(invoice),
      billingPartyAddress: invoice.billingPartyAddress,
      billingPartyGstin: invoice.billingPartyGstin,
      billingPartyEmail: invoice.billingPartyEmail,
      billingPartyPhone: invoice.billingPartyPhone,
      notes: invoice.notes,
      voidReason: invoice.voidReason,
      // The rule that chose the bill-to party, surfaced so a finance officer
      // can see WHY this party was invoiced, not just that they were.
      billingRuleCode: invoice.billingRule?.code ?? null,
      billingRuleName: invoice.billingRule?.name ?? null,
      chargeCalculationId: invoice.chargeCalculationId,
      chargeExplanation: (invoice.chargeCalculation?.explanation ?? []) as string[],
      chargeInputsHash: invoice.chargeCalculation?.inputsHash ?? null,
      chargeEngineVersion: invoice.chargeCalculation?.engineVersion ?? null,
      lines: invoice.lines.map((line) => ({
        lineNo: line.lineNo,
        description: line.description,
        quantity: line.quantity.toFixed(6),
        unitAmount: line.unitAmount.toFixed(4),
        amount: line.amount.toFixed(4),
      })),
      taxLines: invoice.taxLines.map((line) => ({
        sequence: line.sequence,
        code: line.code,
        name: line.name,
        rate: line.rate.toFixed(6),
        taxableAmount: line.taxableAmount.toFixed(4),
        amount: line.amount.toFixed(4),
      })),
      payments: invoice.payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount.toFixed(4),
        method: payment.method,
        status: payment.status,
        reference: payment.reference,
        completedAt: payment.completedAt?.toISOString() ?? null,
      })),
    };
  }

  /* ---------------------------------------------------------------- */

  /**
   * Allocates the next number in a series.
   *
   * `SELECT ... FOR UPDATE` serialises concurrent allocations on the series
   * row. Two simultaneous generations therefore queue rather than colliding,
   * and because the increment shares the caller's transaction, a rollback
   * returns the number to the pool — which is what "gap-free" requires.
   */
  private async allocateNumber(
    tx: PrismaTransaction,
    organizationId: string,
    type: InvoiceType,
  ): Promise<{ seriesId: string; invoiceNumber: string }> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; prefix: string; nextSequence: number; padding: number }>
    >`
      SELECT "id", "prefix", "nextSequence", "padding"
      FROM "invoice_series"
      WHERE "organizationId" = ${organizationId}::uuid
        AND "type" = ${type}::"InvoiceType"
        AND "isActive" = true
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE
    `;

    const series = rows[0];
    if (!series) {
      throw new AppException(
        ErrorCode.INVOICE_SERIES_NOT_CONFIGURED,
        `No active invoice series is configured for ${type} documents.`,
        { details: { type } },
      );
    }

    const invoiceNumber = `${series.prefix}${String(series.nextSequence).padStart(series.padding, '0')}`;

    await tx.invoiceSeries.update({
      where: { id: series.id },
      data: { nextSequence: { increment: 1 } },
    });

    return { seriesId: series.id, invoiceNumber };
  }
}

/* ------------------------------------------------------------------ */

const listInclude = {
  financier: { select: { id: true, displayName: true } },
  site: { select: { id: true, name: true, code: true } },
  vehicle: { select: { id: true, registrationNumber: true, make: true, model: true } },
  session: { select: { id: true, sessionNumber: true, entryAt: true, exitAt: true } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof listInclude }>;

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  billingPartyType: string;
  billingPartyName: string;
  financierId: string | null;
  financierName: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  balance: string;
  siteId: string;
  siteName: string;
  vehicleId: string | null;
  registrationNumber: string | null;
  sessionId: string | null;
  sessionNumber: string | null;
  createdAt: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  billingPartyAddress: string | null;
  billingPartyGstin: string | null;
  billingPartyEmail: string | null;
  billingPartyPhone: string | null;
  notes: string | null;
  voidReason: string | null;
  billingRuleCode: string | null;
  billingRuleName: string | null;
  chargeCalculationId: string | null;
  chargeExplanation: string[];
  chargeInputsHash: string | null;
  chargeEngineVersion: string | null;
  lines: Array<{
    lineNo: number;
    description: string;
    quantity: string;
    unitAmount: string;
    amount: string;
  }>;
  taxLines: Array<{
    sequence: number;
    code: string;
    name: string;
    rate: string;
    taxableAmount: string;
    amount: string;
  }>;
  payments: Array<{
    id: string;
    amount: string;
    method: string;
    status: string;
    reference: string | null;
    completedAt: string | null;
  }>;
}

function toListItem(row: InvoiceRow): InvoiceListItem {
  const outstanding = ['ISSUED', 'SENT', 'PARTIALLY_PAID'].includes(row.status);
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    type: row.type,
    status: row.status,
    issueDate: row.issueDate?.toISOString() ?? null,
    dueDate: row.dueDate?.toISOString() ?? null,
    isOverdue:
      outstanding && row.dueDate !== null && row.dueDate < new Date() && row.balance.greaterThan(0),
    billingPartyType: row.billingPartyType,
    billingPartyName: row.billingPartyName,
    financierId: row.financierId,
    financierName: row.financier?.displayName ?? null,
    currency: row.currency,
    subtotal: row.subtotal.toFixed(4),
    taxTotal: row.taxTotal.toFixed(4),
    total: row.total.toFixed(4),
    amountPaid: row.amountPaid.toFixed(4),
    balance: row.balance.toFixed(4),
    siteId: row.siteId,
    siteName: row.site.name,
    vehicleId: row.vehicleId,
    registrationNumber: row.vehicle?.registrationNumber ?? null,
    sessionId: row.sessionId,
    sessionNumber: row.session?.sessionNumber ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Invoice dates are calendar dates, so they are normalised to UTC midnight. */
function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
