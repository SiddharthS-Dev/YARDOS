import { Injectable } from '@nestjs/common';
import { FinancierMatchMethod } from '@prisma/client';

import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { PrismaExecutor } from '@/infrastructure/prisma/prisma.service';

export interface FinancierMatch {
  financierId: string | null;
  financierName: string | null;
  method: FinancierMatchMethod;
  /** 0..1. Below the review threshold the match is advisory, not applied. */
  confidence: number;
  /** How the match was reached. Persisted for audit. */
  explanation: string;
}

/**
 * Threshold below which a match is recorded but not acted on automatically.
 *
 * ASSUMPTION / PROPOSED DESIGN: 0.80. Attaching a vehicle to the wrong lender
 * means invoicing the wrong company and exposing one financier's asset to
 * another in the portal, so the bar is deliberately high. Configurable via
 * `financier.match.autoAcceptConfidence` in system settings.
 */
export const DEFAULT_AUTO_ACCEPT_CONFIDENCE = 0.8;

/**
 * Resolves the free-text hypothecation holder from the registry to a financier
 * master record.
 *
 * The registry returns whatever the RTO clerk typed. The same lender appears as
 * "HDFC BANK LTD", "H.D.F.C. Bank Limited", "HDFC BANK LIMITED, CHENNAI" and so
 * on. Matching is therefore a three-stage ladder, most reliable first:
 *
 *   1. EXACT on the normalised alias     confidence 1.00
 *   2. PREFIX/CONTAINS on a known alias  confidence 0.85-0.95
 *   3. TOKEN OVERLAP                     confidence proportional to overlap
 *
 * Stage 3 is where false positives come from, so its confidence is capped below
 * the auto-accept threshold: it produces a suggestion for a human, never an
 * automatic assignment. Requirement S12 wants financier matching; it does not
 * want a guess billed to a real company.
 *
 * Every successful match teaches the system: the raw string is added as an
 * alias, so the next vehicle from the same RTO matches at stage 1.
 */
@Injectable()
export class FinancierMatcherService {
  private readonly logger: ScopedLogger;

  constructor(logger: AppLogger) {
    this.logger = logger.forContext('FinancierMatcher');
  }

  async match(
    tx: PrismaExecutor,
    organizationId: string,
    rawFinancierName: string | null,
  ): Promise<FinancierMatch> {
    if (!rawFinancierName || rawFinancierName.trim().length === 0) {
      return {
        financierId: null,
        financierName: null,
        method: FinancierMatchMethod.UNMATCHED,
        confidence: 0,
        explanation: 'The registry returned no hypothecation holder.',
      };
    }

    const normalized = normalizeCompanyName(rawFinancierName);
    if (normalized.length < 3) {
      return unmatched(rawFinancierName, 'The hypothecation holder was too short to match.');
    }

    /* --- Stage 1: exact alias ------------------------------------- */
    const exact = await tx.financierAlias.findFirst({
      where: { normalizedAlias: normalized, financier: { organizationId, isActive: true } },
      include: { financier: { select: { id: true, displayName: true } } },
    });
    if (exact) {
      return {
        financierId: exact.financier.id,
        financierName: exact.financier.displayName,
        method: FinancierMatchMethod.VAHAN_ALIAS,
        confidence: 1,
        explanation: `Exact alias match on "${exact.alias}".`,
      };
    }

    /* --- Stage 2: containment ------------------------------------- */
    const aliases = await tx.financierAlias.findMany({
      where: { financier: { organizationId, isActive: true } },
      include: { financier: { select: { id: true, displayName: true } } },
    });

    let best: { match: FinancierMatch; score: number } | null = null;

    for (const alias of aliases) {
      const candidate = alias.normalizedAlias;
      if (candidate.length < 4) continue;

      if (normalized.startsWith(candidate) || candidate.startsWith(normalized)) {
        // A prefix relationship is strong: "NORTHBRIDGEVEHICLEFINANCE" against
        // "NORTHBRIDGEVEHICLEFINANCELIMITED".
        const score = 0.95;
        if (!best || score > best.score) {
          best = {
            score,
            match: {
              financierId: alias.financier.id,
              financierName: alias.financier.displayName,
              method: FinancierMatchMethod.VAHAN_ALIAS,
              confidence: score,
              explanation: `Prefix match against alias "${alias.alias}".`,
            },
          };
        }
      } else if (normalized.includes(candidate)) {
        const score = 0.85;
        if (!best || score > best.score) {
          best = {
            score,
            match: {
              financierId: alias.financier.id,
              financierName: alias.financier.displayName,
              method: FinancierMatchMethod.VAHAN_ALIAS,
              confidence: score,
              explanation: `The registry value contains the known alias "${alias.alias}".`,
            },
          };
        }
      }
    }

    if (best) return best.match;

    /* --- Stage 3: token overlap (advisory only) ------------------- */
    const financiers = await tx.financier.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, displayName: true, legalName: true },
    });

    const inputTokens = significantTokens(rawFinancierName);
    if (inputTokens.size === 0) {
      return unmatched(rawFinancierName, 'No distinctive words to match on.');
    }

    let bestOverlap: { id: string; name: string; score: number; shared: string[] } | null = null;

    for (const financier of financiers) {
      for (const candidateName of [financier.legalName, financier.displayName]) {
        const candidateTokens = significantTokens(candidateName);
        if (candidateTokens.size === 0) continue;

        const shared = [...inputTokens].filter((token) => candidateTokens.has(token));
        if (shared.length === 0) continue;

        // Jaccard-style similarity against the smaller set, so a long legal
        // name does not dilute a genuine match.
        const score = shared.length / Math.min(inputTokens.size, candidateTokens.size);
        if (!bestOverlap || score > bestOverlap.score) {
          bestOverlap = { id: financier.id, name: financier.displayName, score, shared };
        }
      }
    }

    if (bestOverlap && bestOverlap.score >= 0.6) {
      // Capped at 0.75, below the auto-accept threshold: a suggestion, never an
      // automatic assignment.
      const confidence = Math.min(0.75, 0.5 + bestOverlap.score * 0.25);
      this.logger.debug('Token-overlap financier suggestion (requires review)', {
        raw: rawFinancierName,
        suggested: bestOverlap.name,
        confidence,
      });
      return {
        financierId: bestOverlap.id,
        financierName: bestOverlap.name,
        method: FinancierMatchMethod.VAHAN_ALIAS,
        confidence,
        explanation:
          `Partial name match on [${bestOverlap.shared.join(', ')}]. ` +
          'Below the auto-accept threshold: needs human confirmation.',
      };
    }

    return unmatched(
      rawFinancierName,
      'No financier master record resembles the registry hypothecation holder.',
    );
  }

  /**
   * Records the raw registry string as an alias of a confirmed financier, so
   * the next identical value matches exactly.
   *
   * Idempotent: a duplicate alias is ignored.
   */
  async learnAlias(
    tx: PrismaExecutor,
    financierId: string,
    rawName: string,
    createdById: string | null,
    source = 'VAHAN_LEARNED',
  ): Promise<void> {
    const normalizedAlias = normalizeCompanyName(rawName);
    if (normalizedAlias.length < 3) return;

    await tx.financierAlias.upsert({
      where: { financierId_normalizedAlias: { financierId, normalizedAlias } },
      create: { financierId, alias: rawName.trim().slice(0, 256), normalizedAlias, source, createdById },
      update: {},
    });
  }

  autoAcceptThreshold(configured?: number | null): number {
    return typeof configured === 'number' && configured > 0 && configured <= 1
      ? configured
      : DEFAULT_AUTO_ACCEPT_CONFIDENCE;
  }
}

/* ------------------------------------------------------------------ */

/**
 * Uppercase, alphanumeric only, with corporate suffixes removed.
 *
 * "HDFC Bank Ltd." and "H.D.F.C. BANK LIMITED" both become "HDFCBANK", which is
 * what makes stage 1 hit as often as it does.
 */
export function normalizeCompanyName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\b(PRIVATE|PVT|LIMITED|LTD|LLP|INC|CORPORATION|CORP|COMPANY|CO)\b/g, ' ')
    .replace(/\s+/g, '');
}

/** Words too common to distinguish one lender from another. */
const STOP_WORDS = new Set([
  'THE', 'AND', 'OF', 'FOR', 'PRIVATE', 'PVT', 'LIMITED', 'LTD', 'LLP', 'INC',
  'CORPORATION', 'CORP', 'COMPANY', 'CO', 'INDIA', 'INDIAN', 'BANK', 'FINANCE',
  'FINANCIAL', 'SERVICES', 'CAPITAL', 'CREDIT', 'LOANS', 'LOAN', 'MOTORS',
  'AUTO', 'VEHICLE', 'VEHICLES',
]);

function significantTokens(value: string): Set<string> {
  return new Set(
    value
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function unmatched(rawName: string, explanation: string): FinancierMatch {
  return {
    financierId: null,
    financierName: rawName,
    method: FinancierMatchMethod.UNMATCHED,
    confidence: 0,
    explanation,
  };
}
