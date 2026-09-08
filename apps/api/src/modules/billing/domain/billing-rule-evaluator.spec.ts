import {
  BillingFacts,
  BillingRuleEvaluator,
  EvaluableRule,
  KNOWN_BILLING_FACTS,
} from './billing-rule-evaluator';

/**
 * Billing-party resolution specification.
 *
 * The rules used here are TEST FIXTURES, not Sri JP policy: the real matrix is
 * an unresolved business item (docs/open-items.md OI-06). What these tests pin
 * down is the ENGINE - precedence, matching and determinism - so that whatever
 * matrix Sri JP supplies behaves predictably.
 */

function facts(overrides: Partial<BillingFacts> = {}): BillingFacts {
  return {
    parkingMode: 'REPOSSESSION_YARD',
    siteType: 'REPOSSESSION_YARD',
    siteId: 'site-1',
    financierId: 'fin-1',
    contractVersionId: 'cv-1',
    vehicleClass: 'CAR',
    vehicleStatus: 'RELEASE_APPROVED',
    stayDays: 30,
    chargeSubtotal: '3000.0000',
    financierMatched: true,
    hypothecationStatus: 'HYPOTHECATED',
    soldAtAuction: false,
    releaseRequestedForPartyType: null,
    ...overrides,
  };
}

function rule(overrides: Partial<EvaluableRule> = {}): EvaluableRule {
  return {
    id: 'rule-1',
    code: 'R1',
    name: 'Rule 1',
    scopeType: 'GLOBAL',
    priority: 100,
    conditions: {},
    outcomePartyType: 'FINANCIER',
    ...overrides,
  };
}

describe('BillingRuleEvaluator', () => {
  describe('matching', () => {
    it('matches a catch-all rule with no conditions', () => {
      const decision = BillingRuleEvaluator.evaluate([rule()], facts());
      expect(decision?.partyType).toBe('FINANCIER');
      expect(decision?.reasoning).toContain('catch-all');
    });

    it('returns null when nothing matches rather than guessing', () => {
      const decision = BillingRuleEvaluator.evaluate(
        [rule({ conditions: { all: [{ fact: 'parkingMode', op: 'eq', value: 'PUBLIC_PARKING' }] } })],
        facts(),
      );
      expect(decision).toBeNull();
    });

    it('requires every condition in an "all" group', () => {
      const r = rule({
        conditions: {
          all: [
            { fact: 'parkingMode', op: 'eq', value: 'REPOSSESSION_YARD' },
            { fact: 'financierMatched', op: 'eq', value: true },
          ],
        },
      });
      expect(BillingRuleEvaluator.evaluate([r], facts())).not.toBeNull();
      expect(BillingRuleEvaluator.evaluate([r], facts({ financierMatched: false }))).toBeNull();
    });

    it('requires at least one condition in an "any" group', () => {
      const r = rule({
        conditions: {
          any: [
            { fact: 'vehicleClass', op: 'eq', value: 'BUS' },
            { fact: 'vehicleClass', op: 'eq', value: 'CAR' },
          ],
        },
      });
      expect(BillingRuleEvaluator.evaluate([r], facts())).not.toBeNull();
      expect(BillingRuleEvaluator.evaluate([r], facts({ vehicleClass: 'HCV' }))).toBeNull();
    });

    it('excludes matches listed in a "not" group', () => {
      const r = rule({ conditions: { not: [{ fact: 'soldAtAuction', op: 'eq', value: true }] } });
      expect(BillingRuleEvaluator.evaluate([r], facts())).not.toBeNull();
      expect(BillingRuleEvaluator.evaluate([r], facts({ soldAtAuction: true }))).toBeNull();
    });

    it('supports numeric comparison on stay length', () => {
      const r = rule({ conditions: { all: [{ fact: 'stayDays', op: 'gt', value: 90 }] } });
      expect(BillingRuleEvaluator.evaluate([r], facts({ stayDays: 120 }))).not.toBeNull();
      expect(BillingRuleEvaluator.evaluate([r], facts({ stayDays: 90 }))).toBeNull();
    });

    it('compares decimal-string amounts numerically', () => {
      // chargeSubtotal is a decimal string; "9000.0000" > 5000 must hold.
      const r = rule({ conditions: { all: [{ fact: 'chargeSubtotal', op: 'gte', value: 5000 }] } });
      expect(BillingRuleEvaluator.evaluate([r], facts({ chargeSubtotal: '9000.0000' }))).not.toBeNull();
      expect(BillingRuleEvaluator.evaluate([r], facts({ chargeSubtotal: '4999.9999' }))).toBeNull();
    });

    it('supports set membership', () => {
      const r = rule({
        conditions: { all: [{ fact: 'vehicleClass', op: 'in', value: ['CAR', 'SUV'] }] },
      });
      expect(BillingRuleEvaluator.evaluate([r], facts({ vehicleClass: 'SUV' }))).not.toBeNull();
      expect(BillingRuleEvaluator.evaluate([r], facts({ vehicleClass: 'BUS' }))).toBeNull();
    });

    it('supports existence checks on nullable facts', () => {
      const r = rule({ conditions: { all: [{ fact: 'financierId', op: 'notExists' }] } });
      expect(BillingRuleEvaluator.evaluate([r], facts({ financierId: null }))).not.toBeNull();
      expect(BillingRuleEvaluator.evaluate([r], facts())).toBeNull();
    });
  });

  describe('precedence', () => {
    it('prefers a contract-scoped rule over a global one', () => {
      const decision = BillingRuleEvaluator.evaluate(
        [
          rule({ id: 'g', code: 'GLOBAL', scopeType: 'GLOBAL', outcomePartyType: 'FINANCIER' }),
          rule({
            id: 'c',
            code: 'CONTRACT',
            scopeType: 'CONTRACT_VERSION',
            outcomePartyType: 'CUSTOMER',
          }),
        ],
        facts(),
      );
      expect(decision?.ruleCode).toBe('CONTRACT');
      expect(decision?.partyType).toBe('CUSTOMER');
    });

    it('orders scopes contract, financier, site, global', () => {
      const all: EvaluableRule[] = [
        rule({ id: '1', code: 'G', scopeType: 'GLOBAL' }),
        rule({ id: '2', code: 'S', scopeType: 'SITE' }),
        rule({ id: '3', code: 'F', scopeType: 'FINANCIER' }),
        rule({ id: '4', code: 'C', scopeType: 'CONTRACT_VERSION' }),
      ];
      expect(BillingRuleEvaluator.evaluate(all, facts())?.ruleCode).toBe('C');
      expect(BillingRuleEvaluator.evaluate(all.slice(0, 3), facts())?.ruleCode).toBe('F');
      expect(BillingRuleEvaluator.evaluate(all.slice(0, 2), facts())?.ruleCode).toBe('S');
    });

    it('prefers higher priority within the same scope', () => {
      const decision = BillingRuleEvaluator.evaluate(
        [
          rule({ id: 'a', code: 'LOW', priority: 10, outcomePartyType: 'FINANCIER' }),
          rule({ id: 'b', code: 'HIGH', priority: 900, outcomePartyType: 'CUSTOMER' }),
        ],
        facts(),
      );
      expect(decision?.ruleCode).toBe('HIGH');
    });

    it('breaks ties deterministically by rule code', () => {
      const rules = [
        rule({ id: 'z', code: 'ZEBRA', outcomePartyType: 'CUSTOMER' }),
        rule({ id: 'a', code: 'ALPHA', outcomePartyType: 'FINANCIER' }),
      ];
      // Same result regardless of the order the rules arrive in.
      expect(BillingRuleEvaluator.evaluate(rules, facts())?.ruleCode).toBe('ALPHA');
      expect(BillingRuleEvaluator.evaluate([...rules].reverse(), facts())?.ruleCode).toBe('ALPHA');
    });

    it('skips a more specific rule whose conditions do not match', () => {
      const decision = BillingRuleEvaluator.evaluate(
        [
          rule({ id: 'g', code: 'FALLBACK', scopeType: 'GLOBAL', outcomePartyType: 'FINANCIER' }),
          rule({
            id: 'c',
            code: 'SPECIFIC',
            scopeType: 'CONTRACT_VERSION',
            outcomePartyType: 'CUSTOMER',
            conditions: { all: [{ fact: 'stayDays', op: 'gt', value: 365 }] },
          }),
        ],
        facts({ stayDays: 12 }),
      );
      expect(decision?.ruleCode).toBe('FALLBACK');
    });
  });

  describe('auditability', () => {
    it('explains which rule fired and why', () => {
      const decision = BillingRuleEvaluator.evaluate(
        [
          rule({
            code: 'AUCTION-SALE',
            conditions: { all: [{ fact: 'soldAtAuction', op: 'eq', value: true }] },
            outcomePartyType: 'BIDDER',
          }),
        ],
        facts({ soldAtAuction: true }),
      );

      expect(decision?.partyType).toBe('BIDDER');
      expect(decision?.reasoning).toContain('AUCTION-SALE');
      expect(decision?.reasoning).toContain('soldAtAuction');
      expect(decision?.reasoning).toContain('bill BIDDER');
    });
  });

  describe('validateConditions', () => {
    it('accepts a catch-all', () => {
      expect(BillingRuleEvaluator.validateConditions({}, KNOWN_BILLING_FACTS)).toEqual([]);
    });

    it('accepts a well-formed predicate', () => {
      const problems = BillingRuleEvaluator.validateConditions(
        { all: [{ fact: 'parkingMode', op: 'eq', value: 'PUBLIC_PARKING' }] },
        KNOWN_BILLING_FACTS,
      );
      expect(problems).toEqual([]);
    });

    it('rejects an unknown fact, which would otherwise never match', () => {
      const problems = BillingRuleEvaluator.validateConditions(
        { all: [{ fact: 'nonsense', op: 'eq', value: 1 }] },
        KNOWN_BILLING_FACTS,
      );
      expect(problems.join(' ')).toMatch(/unknown fact/i);
    });

    it('rejects an unknown operator', () => {
      const problems = BillingRuleEvaluator.validateConditions(
        { all: [{ fact: 'stayDays', op: 'approximately', value: 1 }] },
        KNOWN_BILLING_FACTS,
      );
      expect(problems.join(' ')).toMatch(/unknown operator/i);
    });

    it('requires an array for set operators', () => {
      const problems = BillingRuleEvaluator.validateConditions(
        { all: [{ fact: 'vehicleClass', op: 'in', value: 'CAR' }] },
        KNOWN_BILLING_FACTS,
      );
      expect(problems.join(' ')).toMatch(/requires an array/i);
    });

    it('rejects an unknown condition group', () => {
      const problems = BillingRuleEvaluator.validateConditions(
        { some: [] },
        KNOWN_BILLING_FACTS,
      );
      expect(problems.join(' ')).toMatch(/unknown condition group/i);
    });

    it('rejects a non-object', () => {
      expect(BillingRuleEvaluator.validateConditions('nope', KNOWN_BILLING_FACTS)).toHaveLength(1);
    });
  });
});
