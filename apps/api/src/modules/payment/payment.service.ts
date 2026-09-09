import { Injectable } from '@nestjs/common';
import { ActorType, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';

import {
  ErrorCode,
  PAYABLE_INVOICE_STATUSES,
  Paginated,
  TimelineEventType,
} from '@smartpark/contracts';
import { AppException, notFound } from '@/common/errors/app-exception';
import { AuthenticatedUser } from '@/common/decorators/auth.decorators';
import { PaginationQueryDto, paginate } from '@/common/dto/pagination.dto';
import { RequestContextStore } from '@/common/context/request-context';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { toDecimal, toPrismaDecimal } from '@/common/money/money';
import { sha256 } from '@/common/util/hash';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainEventType, OutboxService } from '@/infrastructure/outbox';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';
import { AccessScope } from '@/modules/identity/guards';
import { InvoiceService } from '@/modules/invoice/invoice.service';
import { PaymentStateMachine } from '@/modules/shared/state-machine';
import { PaymentProvider } from './payment.provider';

export interface RecordPaymentInput {
  invoiceId: string;
  amount: string;
  method: PaymentMethod;
  reference?: string | null;
  /** Retrying with the same key returns the original payment. */
  idempotencyKey: string;
  actorId: string;
  organizationId: string;
}

/**
 * Payments.
 *
 * Three properties matter more than anything else here, and each exists because
 * getting it wrong costs real money:
 *
 *   1. **A payment is never marked SUCCESS because a request succeeded.**
 *      Counter collection can settle synchronously — a human has the remittance
 *      advice in hand and the provider declares itself authoritative. A gateway
 *      payment settles only from a verified callback.
 *
 *   2. **Callbacks are idempotent.** Every callback is stored first, keyed on
 *      the provider's event id under a unique index. A duplicate delivery
 *      collides, is recognised, and returns the original outcome. Gateways
 *      retry; that is normal, not exceptional.
 *
 *   3. **The invoice balance is derived, never asserted.** A caller supplies an
 *      amount; the resulting status comes from arithmetic in
 *      `InvoiceService.applyPayment`, guarded by a CHECK constraint requiring
 *      `balance = total - amountPaid`.
 */
@Injectable()
export class PaymentService {
  private readonly logger: ScopedLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly invoices: InvoiceService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Payment');
  }

  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Records a payment received outside a gateway — bank transfer, cheque, UPI
   * or cash at the counter.
   *
   * Settles immediately, and legitimately: the provider is authoritative
   * because a member of staff is asserting the money arrived, and the audit
   * record names them.
   *
   * @throws AppException INVOICE_NOT_PAYABLE, PAYMENT_EXCEEDS_BALANCE
   */
  async recordManualPayment(
    actor: AuthenticatedUser,
    input: RecordPaymentInput,
  ): Promise<PaymentDetail> {
    const amount = toDecimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'The payment amount must be positive.');
    }

    const paymentId = await this.prisma.transaction(async (tx) => {
      // Idempotency before anything else.
      const existing = await tx.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (existing) {
        this.logger.debug('Manual payment replayed from idempotency key', {
          paymentId: existing.id,
        });
        return existing.id;
      }

      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, organizationId: input.organizationId },
      });
      if (!invoice) throw notFound('Invoice', input.invoiceId);
      AccessScope.assertSite(actor, invoice.siteId);

      if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
        throw new AppException(
          ErrorCode.INVOICE_NOT_PAYABLE,
          `Invoice ${invoice.invoiceNumber} is ${invoice.status} and cannot accept a payment.`,
          { details: { status: invoice.status, invoiceNumber: invoice.invoiceNumber } },
        );
      }

      if (amount.greaterThan(invoice.balance)) {
        throw new AppException(
          ErrorCode.PAYMENT_EXCEEDS_BALANCE,
          `That payment exceeds the outstanding balance of ${invoice.currency} ${invoice.balance.toFixed(2)}.`,
          { details: { balance: invoice.balance.toFixed(4), attempted: amount.toFixed(4) } },
        );
      }

      const now = new Date();
      const payment = await tx.payment.create({
        data: {
          organizationId: input.organizationId,
          invoiceId: invoice.id,
          amount: toPrismaDecimal(amount),
          currency: invoice.currency,
          method: input.method,
          provider: this.provider.name,
          providerTransactionId: input.reference ?? null,
          // Manual collection is settled at the moment of recording.
          status: PaymentStatus.SUCCESS,
          initiatedAt: now,
          completedAt: now,
          reference: input.reference ?? null,
          receivedById: input.actorId,
          idempotencyKey: input.idempotencyKey,
          correlationId: RequestContextStore.correlationId(),
        },
      });

      const applied = await this.invoices.applyPayment(tx, invoice.id, payment.amount);

      await this.outbox.record(tx, {
        eventType: DomainEventType.PAYMENT_RECORDED,
        aggregateType: 'Payment',
        aggregateId: payment.id,
        payload: {
          paymentId: payment.id,
          invoiceId: invoice.id,
          organizationId: input.organizationId,
          amount: payment.amount.toFixed(4),
          currency: payment.currency,
          method: payment.method,
          invoiceStatusAfter: applied.status,
        },
      });

      if (invoice.vehicleId) {
        await tx.vehicleTimelineEvent.create({
          data: {
            organizationId: input.organizationId,
            vehicleId: invoice.vehicleId,
            sessionId: invoice.sessionId,
            siteId: invoice.siteId,
            type: TimelineEventType.PAYMENT_RECEIVED,
            occurredAt: now,
            actorId: input.actorId,
            actorType: ActorType.USER,
            title: `Payment ${invoice.currency} ${payment.amount.toFixed(2)} received`,
            description: `Against invoice ${invoice.invoiceNumber}. Balance now ${applied.balance}.`,
            payload: { paymentId: payment.id, method: payment.method },
            correlationId: RequestContextStore.correlationId(),
          },
        });
      }

      await this.audit.record(tx, {
        action: AuditAction.PAYMENT_RECORDED,
        entityType: 'Payment',
        entityId: payment.id,
        organizationId: input.organizationId,
        siteId: invoice.siteId,
        afterState: {
          invoiceNumber: invoice.invoiceNumber,
          amount: payment.amount.toFixed(4),
          method: payment.method,
          reference: input.reference ?? null,
          invoiceStatusAfter: applied.status,
          invoiceBalanceAfter: applied.balance,
        },
      });

      return payment.id;
    });

    return this.findById(actor, paymentId);
  }

  /**
   * Starts a gateway payment.
   *
   * Creates a payment in INITIATED/PENDING and returns whatever the payer needs
   * in order to complete it. Deliberately does NOT touch the invoice balance —
   * that happens only when a verified callback arrives.
   */
  async initiateGatewayPayment(
    actor: AuthenticatedUser,
    input: Omit<RecordPaymentInput, 'method'> & { method: PaymentMethod },
  ): Promise<{ paymentId: string; redirectUrl: string | null; status: PaymentStatus }> {
    if (!this.provider.configured) {
      throw new AppException(
        ErrorCode.PAYMENT_PROVIDER_NOT_CONFIGURED,
        `The payment provider "${this.provider.name}" is not configured.`,
        { details: { provider: this.provider.name, openItem: 'OI-09' } },
      );
    }

    const amount = toDecimal(input.amount);

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: input.invoiceId, organizationId: input.organizationId },
    });
    if (!invoice) throw notFound('Invoice', input.invoiceId);
    AccessScope.assertSite(actor, invoice.siteId);

    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
      throw new AppException(
        ErrorCode.INVOICE_NOT_PAYABLE,
        `Invoice ${invoice.invoiceNumber} is ${invoice.status} and cannot accept a payment.`,
      );
    }
    if (amount.greaterThan(invoice.balance)) {
      throw new AppException(
        ErrorCode.PAYMENT_EXCEEDS_BALANCE,
        'That payment exceeds the outstanding balance.',
      );
    }

    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return {
        paymentId: existing.id,
        redirectUrl: null,
        status: existing.status,
      };
    }

    const intent = await this.provider.createIntent({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: amount.toFixed(4),
      currency: invoice.currency,
      method: input.method,
      payerName: invoice.billingPartyName,
      payerEmail: invoice.billingPartyEmail,
      payerPhone: invoice.billingPartyPhone,
      idempotencyKey: input.idempotencyKey,
    });

    // A non-authoritative provider is not permitted to settle synchronously,
    // whatever it claims. This is the guard that stops a simulator marking a
    // real invoice paid.
    const status =
      intent.outcome === 'SUCCESS' && this.provider.authoritative
        ? PaymentStatus.SUCCESS
        : intent.outcome === 'PENDING'
          ? PaymentStatus.PENDING
          : PaymentStatus.INITIATED;

    const payment = await this.prisma.payment.create({
      data: {
        organizationId: input.organizationId,
        invoiceId: invoice.id,
        amount: toPrismaDecimal(amount),
        currency: invoice.currency,
        method: input.method,
        provider: intent.provider,
        providerOrderId: intent.providerOrderId,
        providerTransactionId: intent.providerTransactionId,
        status,
        initiatedAt: new Date(),
        receivedById: input.actorId,
        idempotencyKey: input.idempotencyKey,
        correlationId: RequestContextStore.correlationId(),
        metadata: { redirectIssued: intent.redirectUrl !== null } as Prisma.InputJsonValue,
      },
    });

    this.logger.info('Gateway payment initiated', {
      paymentId: payment.id,
      provider: intent.provider,
      status,
    });

    return { paymentId: payment.id, redirectUrl: intent.redirectUrl, status };
  }

  /**
   * Processes a gateway callback.
   *
   * The order of operations is the entire safety design:
   *
   *   1. Verify the signature. An unsigned or mis-signed callback is rejected
   *      before it can influence anything.
   *   2. Store the raw callback keyed on the provider's event id. The unique
   *      index makes a duplicate delivery collide here.
   *   3. Only then apply it — and only to a payment that is not already
   *      terminal.
   *
   * Returns the same result for a repeat delivery, which is what "idempotent"
   * has to mean for a gateway that retries.
   */
  async handleWebhook(input: {
    rawBody: string;
    signature: string | undefined;
    payload: unknown;
  }): Promise<{ processed: boolean; duplicate: boolean; paymentId: string | null; reason?: string }> {
    if (this.provider.verifiesWebhooks) {
      if (!this.provider.verifyWebhookSignature(input.rawBody, input.signature)) {
        this.logger.warn('Payment webhook rejected: signature verification failed', {
          provider: this.provider.name,
        });
        throw new AppException(
          ErrorCode.PAYMENT_WEBHOOK_SIGNATURE_INVALID,
          'The webhook signature could not be verified.',
        );
      }
    } else {
      // A provider that cannot verify callbacks must not accept them at all;
      // otherwise anyone who learns the URL can mark invoices paid.
      throw new AppException(
        ErrorCode.PAYMENT_PROVIDER_NOT_CONFIGURED,
        `The provider "${this.provider.name}" does not accept webhooks.`,
      );
    }

    const normalised = this.provider.normaliseWebhook(input.payload);
    const correlationId = RequestContextStore.correlationId();

    /* --- Store first, process second --------------------------------- */
    let webhookRowId: string;
    try {
      const row = await this.prisma.paymentWebhookEvent.create({
        data: {
          provider: this.provider.name,
          providerEventId: normalised.providerEventId,
          eventType: normalised.eventType,
          signatureValid: true,
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
          correlationId,
        },
      });
      webhookRowId = row.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const original = await this.prisma.paymentWebhookEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider: this.provider.name,
              providerEventId: normalised.providerEventId,
            },
          },
          select: { paymentId: true, processedAt: true },
        });
        this.logger.info('Duplicate payment webhook ignored', {
          providerEventId: normalised.providerEventId,
        });
        return {
          processed: original?.processedAt !== null,
          duplicate: true,
          paymentId: original?.paymentId ?? null,
        };
      }
      throw error;
    }

    /* --- Correlate to a payment ------------------------------------- */
    const payment = await this.findPaymentForWebhook(normalised);

    if (!payment) {
      await this.prisma.paymentWebhookEvent.update({
        where: { id: webhookRowId },
        data: {
          processedAt: new Date(),
          processingError: 'No matching payment could be found for this callback.',
        },
      });
      this.logger.warn('Payment webhook could not be correlated to a payment', {
        providerEventId: normalised.providerEventId,
      });
      return {
        processed: false,
        duplicate: false,
        paymentId: null,
        reason: 'NO_MATCHING_PAYMENT',
      };
    }

    // Amount tampering check: a callback claiming a different amount than the
    // payment we created is not applied.
    if (normalised.amount) {
      const claimed = toDecimal(normalised.amount);
      if (!claimed.equals(payment.amount)) {
        await this.prisma.paymentWebhookEvent.update({
          where: { id: webhookRowId },
          data: {
            paymentId: payment.id,
            processedAt: new Date(),
            processingError: `Callback amount ${claimed.toFixed(4)} does not match payment amount ${payment.amount.toFixed(4)}.`,
          },
        });
        this.logger.error('Payment webhook amount mismatch; not applied', undefined, {
          paymentId: payment.id,
          claimed: claimed.toFixed(4),
          expected: payment.amount.toFixed(4),
        });
        return {
          processed: false,
          duplicate: false,
          paymentId: payment.id,
          reason: 'AMOUNT_MISMATCH',
        };
      }
    }

    /* --- Apply -------------------------------------------------------- */
    await this.prisma.transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });

      // Terminal already: a later callback for the same payment is
      // informational, not actionable.
      if (
        current.status === PaymentStatus.SUCCESS ||
        current.status === PaymentStatus.REFUNDED
      ) {
        await tx.paymentWebhookEvent.update({
          where: { id: webhookRowId },
          data: {
            paymentId: current.id,
            processedAt: new Date(),
            processingError: `Payment was already ${current.status}; callback ignored.`,
          },
        });
        return;
      }

      const nextStatus =
        normalised.outcome === 'SUCCESS'
          ? PaymentStatus.SUCCESS
          : normalised.outcome === 'FAILED'
            ? PaymentStatus.FAILED
            : normalised.outcome === 'REFUNDED'
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PENDING;

      if (nextStatus !== current.status) {
        PaymentStateMachine.assert(current.status, nextStatus);
      }

      await tx.payment.update({
        where: { id: current.id },
        data: {
          status: nextStatus,
          completedAt: nextStatus === PaymentStatus.SUCCESS ? new Date() : current.completedAt,
          failureReason:
            nextStatus === PaymentStatus.FAILED
              ? (normalised.failureReason ?? 'The gateway reported a failure.').slice(0, 512)
              : null,
          providerTransactionId:
            normalised.providerTransactionId ?? current.providerTransactionId,
          version: { increment: 1 },
        },
      });

      // The invoice is only credited on genuine success.
      if (nextStatus === PaymentStatus.SUCCESS) {
        const applied = await this.invoices.applyPayment(tx, current.invoiceId, current.amount);

        await this.outbox.record(tx, {
          eventType: DomainEventType.PAYMENT_RECORDED,
          aggregateType: 'Payment',
          aggregateId: current.id,
          payload: {
            paymentId: current.id,
            invoiceId: current.invoiceId,
            organizationId: current.organizationId,
            amount: current.amount.toFixed(4),
            currency: current.currency,
            method: current.method,
            invoiceStatusAfter: applied.status,
          },
        });
      }

      await tx.paymentWebhookEvent.update({
        where: { id: webhookRowId },
        data: { paymentId: current.id, processedAt: new Date() },
      });

      await this.audit.record(tx, {
        action: AuditAction.PAYMENT_WEBHOOK_PROCESSED,
        entityType: 'Payment',
        entityId: current.id,
        organizationId: current.organizationId,
        actor: { type: ActorType.INTEGRATION, label: `payment:${this.provider.name}` },
        beforeState: { status: current.status },
        afterState: {
          status: nextStatus,
          providerEventId: normalised.providerEventId,
          eventType: normalised.eventType,
        },
      });
    });

    return { processed: true, duplicate: false, paymentId: payment.id };
  }

  /* ---------------------------------------------------------------- */
  /* Queries                                                           */
  /* ---------------------------------------------------------------- */

  async list(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
    filters: { invoiceId?: string; status?: PaymentStatus; method?: PaymentMethod },
  ): Promise<Paginated<PaymentListItem>> {
    const siteFilter = AccessScope.siteFilter(actor);

    const where: Prisma.PaymentWhereInput = {
      organizationId: actor.organizationId,
      ...(filters.invoiceId ? { invoiceId: filters.invoiceId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.method ? { method: filters.method } : {}),
      invoice: {
        ...(actor.financierId ? { financierId: actor.financierId } : {}),
        ...(siteFilter ? { siteId: siteFilter } : {}),
      },
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: { initiatedAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return paginate(rows.map(toPaymentItem), totalItems, query);
  }

  async findById(actor: AuthenticatedUser, paymentId: string): Promise<PaymentDetail> {
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        organizationId: actor.organizationId,
        invoice: actor.financierId ? { financierId: actor.financierId } : undefined,
      },
      include: paymentInclude,
    });
    if (!payment) throw notFound('Payment', paymentId);

    return {
      ...toPaymentItem(payment),
      provider: payment.provider,
      providerOrderId: payment.providerOrderId,
      providerTransactionId: payment.providerTransactionId,
      failureReason: payment.failureReason,
      invoiceBalanceAfter: payment.invoice.balance.toFixed(4),
      invoiceStatus: payment.invoice.status,
    };
  }

  /**
   * Correlates a callback to a payment.
   *
   * Tries the strongest identifier first. Our own idempotency key is the most
   * reliable when the gateway echoes it, because it is the one value we
   * generated ourselves.
   */
  private async findPaymentForWebhook(normalised: {
    idempotencyKey: string | null;
    providerOrderId: string | null;
    providerTransactionId: string | null;
  }) {
    if (normalised.idempotencyKey) {
      const byKey = await this.prisma.payment.findUnique({
        where: { idempotencyKey: normalised.idempotencyKey },
      });
      if (byKey) return byKey;
    }
    if (normalised.providerOrderId) {
      const byOrder = await this.prisma.payment.findFirst({
        where: { provider: this.provider.name, providerOrderId: normalised.providerOrderId },
      });
      if (byOrder) return byOrder;
    }
    if (normalised.providerTransactionId) {
      return this.prisma.payment.findFirst({
        where: {
          provider: this.provider.name,
          providerTransactionId: normalised.providerTransactionId,
        },
      });
    }
    return null;
  }

  /** Deterministic idempotency key for a manual receipt. */
  static manualIdempotencyKey(invoiceId: string, amount: string, reference: string | null): string {
    return `manual:${sha256(`${invoiceId}|${amount}|${reference ?? ''}`).slice(0, 48)}`;
  }
}

/* ------------------------------------------------------------------ */

const paymentInclude = {
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      balance: true,
      total: true,
      billingPartyName: true,
      siteId: true,
    },
  },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export interface PaymentListItem {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  billingPartyName: string;
  amount: string;
  currency: string;
  method: string;
  status: string;
  reference: string | null;
  initiatedAt: string;
  completedAt: string | null;
}

export interface PaymentDetail extends PaymentListItem {
  provider: string;
  providerOrderId: string | null;
  providerTransactionId: string | null;
  failureReason: string | null;
  invoiceBalanceAfter: string;
  invoiceStatus: string;
}

function toPaymentItem(row: PaymentRow): PaymentListItem {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoice.invoiceNumber,
    billingPartyName: row.invoice.billingPartyName,
    amount: row.amount.toFixed(4),
    currency: row.currency,
    method: row.method,
    status: row.status,
    reference: row.reference,
    initiatedAt: row.initiatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
