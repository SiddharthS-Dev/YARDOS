import { AppLogger } from '@/common/logging/logger.service';
import { FinancierMatcherService, normalizeCompanyName } from './financier-matcher.service';

/**
 * Financier matching specification.
 *
 * This is where a mistake is expensive: attaching a vehicle to the wrong lender
 * means invoicing the wrong company AND showing one financier another's asset
 * in the portal. The tests below care as much about what must NOT match
 * automatically as about what must.
 */

/** Minimal Prisma stub: only the two delegates the matcher touches. */
function stubPrisma(options: {
  aliases?: Array<{ alias: string; normalizedAlias: string; financierId: string; displayName: string }>;
  financiers?: Array<{ id: string; displayName: string; legalName: string }>;
}) {
  const aliases = options.aliases ?? [];
  const financiers = options.financiers ?? [];

  return {
    financierAlias: {
      findFirst: async ({ where }: any) =>
        aliases
          .filter((a) => a.normalizedAlias === where.normalizedAlias)
          .map((a) => ({
            alias: a.alias,
            normalizedAlias: a.normalizedAlias,
            financier: { id: a.financierId, displayName: a.displayName },
          }))[0] ?? null,
      findMany: async () =>
        aliases.map((a) => ({
          alias: a.alias,
          normalizedAlias: a.normalizedAlias,
          financier: { id: a.financierId, displayName: a.displayName },
        })),
      upsert: async () => ({}),
    },
    financier: {
      findMany: async () => financiers,
    },
  } as any;
}

const logger = {
  forContext: () => ({
    trace: () => {}, debug: () => {}, info: () => {}, warn: () => {},
    error: () => {}, fatal: () => {},
  }),
} as unknown as AppLogger;

describe('FinancierMatcherService', () => {
  const matcher = new FinancierMatcherService(logger);

  describe('normalizeCompanyName', () => {
    it('collapses punctuation, case and corporate suffixes', () => {
      expect(normalizeCompanyName('Northbridge Vehicle Finance Limited')).toBe(
        normalizeCompanyName('NORTHBRIDGE VEHICLE FINANCE LTD.'),
      );
      expect(normalizeCompanyName('S.C.F. Pvt Ltd')).toBe('SCF');
    });

    it('is stable across spacing differences', () => {
      expect(normalizeCompanyName('Meridian  Auto   Loans')).toBe(
        normalizeCompanyName('Meridian Auto Loans'),
      );
    });
  });

  describe('exact alias matching', () => {
    it('matches with full confidence and names the alias', async () => {
      const tx = stubPrisma({
        aliases: [
          {
            alias: 'NORTHBRIDGE VEHICLE FINANCE LTD',
            normalizedAlias: normalizeCompanyName('NORTHBRIDGE VEHICLE FINANCE LTD'),
            financierId: 'fin-north',
            displayName: 'Northbridge',
          },
        ],
      });

      const result = await matcher.match(tx, 'org-1', 'Northbridge Vehicle Finance Limited');

      expect(result.financierId).toBe('fin-north');
      expect(result.confidence).toBe(1);
      expect(result.method).toBe('VAHAN_ALIAS');
      expect(result.confidence).toBeGreaterThanOrEqual(matcher.autoAcceptThreshold());
    });
  });

  describe('containment matching', () => {
    it('matches a registry value that appends a branch name', async () => {
      const tx = stubPrisma({
        aliases: [
          {
            alias: 'SUNDARA CAPITAL FINANCE',
            normalizedAlias: normalizeCompanyName('SUNDARA CAPITAL FINANCE'),
            financierId: 'fin-sundara',
            displayName: 'Sundara Capital',
          },
        ],
      });

      const result = await matcher.match(tx, 'org-1', 'SUNDARA CAPITAL FINANCE LTD, CHENNAI BRANCH');

      expect(result.financierId).toBe('fin-sundara');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      expect(result.confidence).toBeGreaterThanOrEqual(matcher.autoAcceptThreshold());
    });
  });

  describe('token-overlap suggestions', () => {
    it('suggests but never auto-accepts', async () => {
      const tx = stubPrisma({
        financiers: [
          {
            id: 'fin-kaveri',
            displayName: 'Kaveri Commercial',
            legalName: 'Kaveri Commercial Credit Ltd',
          },
        ],
      });

      const result = await matcher.match(tx, 'org-1', 'KAVERI COMMERCIAL CREDIT COMPANY');

      expect(result.financierId).toBe('fin-kaveri');
      // The crucial property: a fuzzy match must stay below auto-accept.
      expect(result.confidence).toBeLessThan(matcher.autoAcceptThreshold());
      expect(result.explanation).toMatch(/needs human confirmation/i);
    });

    it('does not match on generic industry words alone', async () => {
      // "Finance", "Capital", "India", "Ltd" are stop words - two unrelated
      // lenders sharing only those must not be matched to each other.
      const tx = stubPrisma({
        financiers: [
          {
            id: 'fin-a',
            displayName: 'Everest Retail',
            legalName: 'Everest Retail Finance Limited',
          },
        ],
      });

      const result = await matcher.match(tx, 'org-1', 'Palmgrove Asset Finance Private Limited');

      expect(result.financierId).toBeNull();
      expect(result.method).toBe('UNMATCHED');
    });
  });

  describe('no match', () => {
    it('returns UNMATCHED when the registry gave no financier', async () => {
      const result = await matcher.match(stubPrisma({}), 'org-1', null);
      expect(result.method).toBe('UNMATCHED');
      expect(result.confidence).toBe(0);
      expect(result.explanation).toMatch(/no hypothecation holder/i);
    });

    it('returns UNMATCHED for an unrecognisable value', async () => {
      const result = await matcher.match(stubPrisma({}), 'org-1', 'XZ');
      expect(result.financierId).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('returns UNMATCHED when there are no financiers at all', async () => {
      const result = await matcher.match(stubPrisma({}), 'org-1', 'Some Lender Limited');
      expect(result.financierId).toBeNull();
    });
  });

  describe('autoAcceptThreshold', () => {
    it('defaults to 0.8', () => {
      expect(matcher.autoAcceptThreshold()).toBe(0.8);
      expect(matcher.autoAcceptThreshold(null)).toBe(0.8);
    });

    it('honours a configured override', () => {
      expect(matcher.autoAcceptThreshold(0.95)).toBe(0.95);
    });

    it('ignores a nonsensical override', () => {
      expect(matcher.autoAcceptThreshold(0)).toBe(0.8);
      expect(matcher.autoAcceptThreshold(1.5)).toBe(0.8);
    });
  });
});
