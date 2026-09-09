import { Injectable } from '@nestjs/common';
import { BillingPartyType, ParkingSession, Prisma } from '@prisma/client';

import { ErrorCode } from '@smartpark/contracts';
import { AppException } from '@/common/errors/app-exception';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { PrismaExecutor } from '@/infrastructure/prisma/prisma.service';
import { ageingDays } from '@/modules/billing/domain/duration';
import {
  BillingDecision,
  BillingFacts,
  BillingRuleEvaluator,
  EvaluableRule,
} from '@/modules/billing/domain/billing-rule-evaluator';

/** The bill-to party, resolved and snapshotted for an invoice. */
export interface ResolvedBillingParty {
  partyType: BillingPartyType;
  financierId: string | null;
  bidderId: string | null;
  name: string;
  address: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  paymentTermsDays: number;
  /** The rule that decided this. Stored on the invoice for audit. */
  decision: BillingDecision;
}

export interface BillingPartyContext {
  session: ParkingSession & {
    site: { siteType: string };
    vehicle: { vehicleClass: string; status: string; hypothecationStatus: string };
  };
  chargeSubtotal: string;
  soldAtAuction?: boolean;
  releaseRequestedForPartyType?: string | null;
  /** Supplied when the collecting party is a walk-in customer, not a financier. */
  customerOverride?: {
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  } | null;
  /** Supplied for an auction sale invoice. */
  bidderId?: string | null;
}

/**
 * Decides who receives an invoice, and snapshots their details onto it.
 *
 * Requirement S15 asks for a `BillingPartyResolver`. The requirements also
 * record that the actual decision matrix is an unresolved business item
 * (OI-03 in the source numbering / OI-06 in `docs/open-items.md`), so the
 * decision is DATA: rows in `billing_rules`, evaluated by the already-tested
 * `BillingRuleEvaluator`. This service's job is only to load the rules, gather
 * the facts, and snapshot the resulting party.
 *
 * Two things it deliberately will not do:
 *
 *   - **Guess.** If no rule matches, it raises BILLING_PARTY_UNRESOLVED rather
 *     than defaulting. Putting an invoice in front of the wrong company is
 *     worse than failing loudly.
 *   - **Read the party live at issue time.** Details are copied onto the
 *     invoice at generation, so a later change to a financier's registered
 *     address cannot silently alter an issued document.
 */
@Injectable()
export class BillingPartyService {
  private readonly logger: ScopedLogger;

  constructor(logger: AppLogger) {
    this.logger = logger.forContext('BillingParty');
  }

  /**
   * @throws AppException BILLING_PARTY_UNRESOLVED when no rule matches,
   *         BILLING_PARTY_DETAILS_MISSING when the chosen party cannot be
   *         identified concretely.
   */
  async resolve(
    tx: PrismaExecutor,
    context: BillingPartyContext,
  ): Promise<ResolvedBillingParty> {
    const { session } = context;

    const rules = await this.loadRules(tx, session.organizationId, {
      siteId: session.siteId,
      financierId: session.financierId,
      contractVersionId: session.contractVersionId,
    });

    if (rules.length === 0) {
      throw new AppException(
        ErrorCode.BILLING_PARTY_UNRESOLVED,
        'No billing rules are configured, so there is no way to decide who to invoice.',
        {
          details: {
            hint: 'Configure at least one billing rule under Administration > Billing rules.',
            openItem: 'OI-03 (invoicing party matrix) - see docs/open-items.md',
          },
        },
      );
    }

    const facts = this.buildFacts(context);
    const decision = BillingRuleEvaluator.evaluate(rules, facts);

    if (!decision) {
      throw new AppException(
        ErrorCode.BILLING_PARTY_UNRESOLVED,
        'No billing rule matched this stay, so the bill-to party could not be determined.',
        {
          details: {
            facts: facts as unknown as Record<string, unknown>,
            evaluatedRules: rules.map((rule) => rule.code),
            openItem: 'OI-03 (invoicing party matrix) - see docs/open-items.md',
          },
        },
      );
    }

    this.logger.debug('Billing party resolved', {
      sessionId: session.id,
      partyType: decision.partyType,
      rule: decision.ruleCode,
    });

    return this.snapshotParty(tx, decision, context);
  }

  /**
   * Loads the rules that could apply.
   *
   * Narrowed in SQL to this organisation and to scopes relevant to this stay,
   * so a rule written for a different site or financier is never even
   * considered. `BillingRuleEvaluator` then applies precedence.
   */
  private async loadRules(
    tx: PrismaExecutor,
    organizationId: string,
    scope: { siteId: string; financierId: string | null; contractVersionId: string | null },
  ): Promise<EvaluableRule[]> {
    const now = new Date();

    const rows = await tx.billingRule.findMany({
      where: {
        organizationId,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        AND: [
          {
            OR: [
              { scopeType: 'GLOBAL' },
              { scopeType: 'SITE', siteId: scope.siteId },
              ...(scope.financierId
                ? [{ scopeType: 'FINANCIER' as const, financierId: scope.financierId }]
                : []),
              ...(scope.contractVersionId
                ? [
                    {
                      scopeType: 'CONTRACT_VERSION' as const,
                      contractVersionId: scope.contractVersionId,
                    },
                  ]
                : []),
            ],
          },
        ],
      },
    });

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      scopeType: row.scopeType,
      priority: row.priority,
      conditions: (row.conditions ?? {}) as EvaluableRule['conditions'],
      outcomePartyType: row.outcomePartyType,
      outcomeNote: row.outcomeNote,
    }));
  }

  private buildFacts(context: BillingPartyContext): BillingFacts {
    const { session } = context;
    return {
      parkingMode: session.parkingMode,
      siteType: session.site.siteType,
      siteId: session.siteId,
      financierId: session.financierId,
      contractVersionId: session.contractVersionId,
      vehicleClass: session.vehicle.vehicleClass,
      vehicleStatus: session.vehicle.status,
      stayDays: ageingDays(session.entryAt, session.exitAt ?? new Date()),
      chargeSubtotal: context.chargeSubtotal,
      // "Matched" means an actual financier record, not merely a name string.
      financierMatched: session.financierId !== null,
      hypothecationStatus: session.vehicle.hypothecationStatus,
      soldAtAuction: context.soldAtAuction ?? false,
      releaseRequestedForPartyType: context.releaseRequestedForPartyType ?? null,
    };
  }

  /**
   * Turns a rule outcome into concrete, frozen party details.
   *
   * @throws AppException BILLING_PARTY_DETAILS_MISSING when the rule chose a
   *         party the context cannot identify - for example CUSTOMER with no
   *         collecting party recorded on the release request.
   */
  private async snapshotParty(
    tx: PrismaExecutor,
    decision: BillingDecision,
    context: BillingPartyContext,
  ): Promise<ResolvedBillingParty> {
    switch (decision.partyType) {
      case BillingPartyType.FINANCIER: {
        if (!context.session.financierId) {
          throw new AppException(
            ErrorCode.BILLING_PARTY_DETAILS_MISSING,
            `Rule "${decision.ruleCode}" selected the financier, but this stay has no matched financier.`,
            { details: { ruleCode: decision.ruleCode } },
          );
        }
        const financier = await tx.financier.findUnique({
          where: { id: context.session.financierId },
        });
        if (!financier) {
          throw new AppException(
            ErrorCode.BILLING_PARTY_DETAILS_MISSING,
            'The financier on this stay no longer exists.',
          );
        }
        if (!financier.isActive) {
          throw new AppException(
            ErrorCode.FINANCIER_INACTIVE,
            `${financier.displayName} is not active, so an invoice cannot be raised against them.`,
            { details: { financierId: financier.id } },
          );
        }
        return {
          partyType: BillingPartyType.FINANCIER,
          financierId: financier.id,
          bidderId: null,
          name: financier.legalName,
          address: joinAddress([
            financier.addressLine1,
            financier.addressLine2,
            financier.city,
            financier.state,
            financier.postalCode,
          ]),
          gstin: financier.gstin,
          email: financier.billingEmail,
          phone: financier.billingPhone,
          paymentTermsDays: financier.paymentTermsDays,
          decision,
        };
      }

      case BillingPartyType.BIDDER: {
        const bidderId = context.bidderId;
        if (!bidderId) {
          throw new AppException(
            ErrorCode.BILLING_PARTY_DETAILS_MISSING,
            `Rule "${decision.ruleCode}" selected the winning bidder, but no bidder was supplied.`,
            { details: { ruleCode: decision.ruleCode } },
          );
        }
        const bidder = await tx.bidder.findUnique({ where: { id: bidderId } });
        if (!bidder) {
          throw new AppException(ErrorCode.BILLING_PARTY_DETAILS_MISSING, 'Bidder not found.');
        }
        return {
          partyType: BillingPartyType.BIDDER,
          financierId: null,
          bidderId: bidder.id,
          name: bidder.legalName,
          address: joinAddress([bidder.addressLine1, bidder.city, bidder.state, bidder.postalCode]),
          gstin: bidder.gstin,
          email: bidder.email,
          phone: bidder.phone,
          // Auction settlement terms are a separate configured value; a bidder
          // has no standing credit arrangement.
          paymentTermsDays: 0,
          decision,
        };
      }

      case BillingPartyType.CUSTOMER:
      case BillingPartyType.OTHER: {
        const customer = context.customerOverride;
        if (!customer?.name) {
          throw new AppException(
            ErrorCode.BILLING_PARTY_DETAILS_MISSING,
            `Rule "${decision.ruleCode}" selected the customer, but no collecting party has been ` +
              'recorded. Capture their name on the release request first.',
            { details: { ruleCode: decision.ruleCode, partyType: decision.partyType } },
          );
        }
        return {
          partyType: decision.partyType,
          financierId: null,
          bidderId: null,
          name: customer.name,
          address: customer.address ?? null,
          gstin: null,
          email: customer.email ?? null,
          phone: customer.phone ?? null,
          // A walk-in customer pays on the spot.
          paymentTermsDays: 0,
          decision,
        };
      }

      default: {
        const unreachable: never = decision.partyType;
        throw new AppException(
          ErrorCode.BILLING_PARTY_UNRESOLVED,
          `Unsupported billing party type: ${String(unreachable)}`,
        );
      }
    }
  }
}

function joinAddress(parts: Array<string | null | undefined>): string | null {
  const joined = parts.filter((part) => part && part.trim().length > 0).join(', ');
  return joined.length > 0 ? joined : null;
}

/** Prisma include needed to build the billing facts. */
export const BILLING_CONTEXT_INCLUDE = {
  site: { select: { siteType: true } },
  vehicle: { select: { vehicleClass: true, status: true, hypothecationStatus: true } },
} satisfies Prisma.ParkingSessionInclude;
