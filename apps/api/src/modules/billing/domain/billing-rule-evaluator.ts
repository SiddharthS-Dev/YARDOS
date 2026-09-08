import { BillingPartyType, BillingRuleScope } from '@smartpark/contracts';

/**
 * The configurable "who gets billed" rule engine.
 *
 * Requirement S15 asks for a `BillingPartyResolver` whose outcomes are
 * FINANCIER, CUSTOMER or another configured party. Requirement S61 records that
 * the actual decision matrix is an OPEN ITEM (OI-06) that Sri JP has not
 * supplied.
 *
 * The resolution is therefore data, not code. Rules live in the `billing_rules`
 * table and are edited in the console; this module only evaluates them. Nothing
 * here encodes a commercial policy - change the rows, change the behaviour, no
 * deploy.
 *
 * Evaluation order:
 *   1. Most specific scope first: CONTRACT_VERSION, then FINANCIER, then SITE,
 *      then GLOBAL. A rule written for one contract must beat a general one.
 *   2. Within a scope, highest `priority` first.
 *   3. Ties broken by rule code, so evaluation is deterministic and a rule
 *      change is reviewable.
 *
 * The first matching rule wins and its id is stored on the invoice, so any
 * invoice can be traced back to the rule that chose its bill-to party.
 */

/** Facts a rule can test. Extend here, not in individual rules. */
export interface BillingFacts {
  parkingMode: string;
  siteType: string;
  siteId: string;
  financierId: string | null;
  contractVersionId: string | null;
  vehicleClass: string;
  vehicleStatus: string;
  /** Whole days between entry and exit. */
  stayDays: number;
  /** Charge total before tax, as a decimal string. */
  chargeSubtotal: string;
  /** True when the financier is matched with acceptable confidence. */
  financierMatched: boolean;
  hypothecationStatus: string;
  /** True when the stay ends because the vehicle was auctioned. */
  soldAtAuction: boolean;
  /** Set when the release names who is collecting the vehicle. */
  releaseRequestedForPartyType: string | null;
}

export type ComparisonOperator =
  | 'eq'
  | 'ne'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'
  | 'notExists';

export interface Condition {
  fact: keyof BillingFacts;
  op: ComparisonOperator;
  value?: unknown;
}

/**
 * A rule predicate. `all` and `any` may be combined; both must be satisfied
 * when both are present. An empty or absent predicate always matches, which is
 * how a catch-all default rule is written.
 */
export interface ConditionGroup {
  all?: Condition[];
  any?: Condition[];
  not?: Condition[];
}

export interface EvaluableRule {
  id: string;
  code: string;
  name: string;
  scopeType: BillingRuleScope;
  priority: number;
  conditions: ConditionGroup | Record<string, never>;
  outcomePartyType: BillingPartyType;
  outcomeNote?: string | null;
}

export interface BillingDecision {
  partyType: BillingPartyType;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  note?: string | null;
  /** Human-readable trace, stored on the invoice for audit. */
  reasoning: string;
}

/** Most-specific scope first. */
const SCOPE_RANK: Record<BillingRuleScope, number> = {
  CONTRACT_VERSION: 0,
  FINANCIER: 1,
  SITE: 2,
  GLOBAL: 3,
};

/** Unknown scopes sort last rather than throwing, so one bad row cannot
 *  break resolution for every other rule. */
function scopeRank(scope: BillingRuleScope): number {
  return SCOPE_RANK[scope] ?? 99;
}

export class BillingRuleEvaluator {
  /**
   * Picks the first matching rule.
   *
   * Returns null when nothing matches. The caller raises
   * BILLING_PARTY_UNRESOLVED rather than guessing - inventing a bill-to party
   * would put an invoice in front of the wrong company.
   */
  static evaluate(rules: EvaluableRule[], facts: BillingFacts): BillingDecision | null {
    const ordered = [...rules].sort((a, b) => {
      const scope = scopeRank(a.scopeType) - scopeRank(b.scopeType);
      if (scope !== 0) return scope;
      const priority = b.priority - a.priority;
      if (priority !== 0) return priority;
      return a.code.localeCompare(b.code);
    });

    for (const rule of ordered) {
      if (this.matches(rule.conditions as ConditionGroup, facts)) {
        return {
          partyType: rule.outcomePartyType,
          ruleId: rule.id,
          ruleCode: rule.code,
          ruleName: rule.name,
          note: rule.outcomeNote ?? null,
          reasoning: describeMatch(rule, facts),
        };
      }
    }
    return null;
  }

  static matches(group: ConditionGroup | undefined | null, facts: BillingFacts): boolean {
    if (!group || Object.keys(group).length === 0) return true;

    if (group.all && group.all.length > 0) {
      if (!group.all.every((condition) => evaluateCondition(condition, facts))) return false;
    }
    if (group.any && group.any.length > 0) {
      if (!group.any.some((condition) => evaluateCondition(condition, facts))) return false;
    }
    if (group.not && group.not.length > 0) {
      if (group.not.some((condition) => evaluateCondition(condition, facts))) return false;
    }
    return true;
  }

  /**
   * Validates a rule predicate at authoring time.
   *
   * An unknown fact name would silently never match, quietly sending invoices
   * to the fallback party. Catching it in the editor is far cheaper than
   * discovering it in a month-end reconciliation.
   */
  static validateConditions(
    conditions: unknown,
    knownFacts: ReadonlyArray<keyof BillingFacts>,
  ): string[] {
    const problems: string[] = [];

    if (conditions === null || typeof conditions !== 'object') {
      return ['Conditions must be an object. Use {} for a catch-all rule.'];
    }

    const group = conditions as ConditionGroup;
    for (const key of Object.keys(group)) {
      if (!['all', 'any', 'not'].includes(key)) {
        problems.push(`Unknown condition group "${key}". Use "all", "any" or "not".`);
      }
    }

    for (const bucket of ['all', 'any', 'not'] as const) {
      const list = group[bucket];
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        problems.push(`"${bucket}" must be an array of conditions.`);
        continue;
      }
      list.forEach((condition, index) => {
        const label = `${bucket}[${index}]`;
        if (!condition || typeof condition !== 'object') {
          problems.push(`${label} must be an object.`);
          return;
        }
        const { fact, op, value } = condition as Condition;
        if (!knownFacts.includes(fact)) {
          problems.push(`${label}: unknown fact "${String(fact)}".`);
        }
        const operators: ComparisonOperator[] = [
          'eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'exists', 'notExists',
        ];
        if (!operators.includes(op)) {
          problems.push(`${label}: unknown operator "${String(op)}".`);
        }
        if ((op === 'in' || op === 'nin') && !Array.isArray(value)) {
          problems.push(`${label}: operator "${op}" requires an array value.`);
        }
        if (
          op !== 'exists' &&
          op !== 'notExists' &&
          value === undefined
        ) {
          problems.push(`${label}: operator "${op}" requires a value.`);
        }
      });
    }

    return problems;
  }
}

function evaluateCondition(condition: Condition, facts: BillingFacts): boolean {
  const actual = facts[condition.fact];
  const expected = condition.value;

  switch (condition.op) {
    case 'exists':
      return actual !== null && actual !== undefined;
    case 'notExists':
      return actual === null || actual === undefined;
    case 'eq':
      return looseEquals(actual, expected);
    case 'ne':
      return !looseEquals(actual, expected);
    case 'in':
      return Array.isArray(expected) && expected.some((item) => looseEquals(actual, item));
    case 'nin':
      return Array.isArray(expected) && !expected.some((item) => looseEquals(actual, item));
    case 'gt':
      return compareNumeric(actual, expected) > 0;
    case 'gte':
      return compareNumeric(actual, expected) >= 0;
    case 'lt':
      return compareNumeric(actual, expected) < 0;
    case 'lte':
      return compareNumeric(actual, expected) <= 0;
    default:
      return false;
  }
}

/**
 * Compares by value, tolerating the string/number mismatch that arises because
 * conditions are authored as JSON while amounts are decimal strings.
 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return toBoolean(a) === toBoolean(b);
  }
  return String(a) === String(b);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase());
  return Boolean(value);
}

/** Returns 0 when either side is not numeric, so a bad rule never matches. */
function compareNumeric(a: unknown, b: unknown): number {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return NaN;
  return left === right ? 0 : left < right ? -1 : 1;
}

function describeMatch(rule: EvaluableRule, facts: BillingFacts): string {
  const conditions = rule.conditions as ConditionGroup;
  const parts: string[] = [
    `Rule "${rule.code}" (${rule.scopeType}, priority ${rule.priority}) matched`,
  ];

  const described: string[] = [];
  for (const bucket of ['all', 'any', 'not'] as const) {
    for (const condition of conditions?.[bucket] ?? []) {
      described.push(
        `${String(condition.fact)}=${JSON.stringify(facts[condition.fact])} ` +
          `${condition.op} ${JSON.stringify(condition.value ?? null)}`,
      );
    }
  }

  if (described.length === 0) {
    parts.push('(catch-all rule with no conditions)');
  } else {
    parts.push(`on: ${described.join('; ')}`);
  }
  parts.push(`-> bill ${rule.outcomePartyType}`);
  return parts.join(' ');
}

/** Every fact name, for validation and for the console's rule editor. */
export const KNOWN_BILLING_FACTS: ReadonlyArray<keyof BillingFacts> = [
  'parkingMode',
  'siteType',
  'siteId',
  'financierId',
  'contractVersionId',
  'vehicleClass',
  'vehicleStatus',
  'stayDays',
  'chargeSubtotal',
  'financierMatched',
  'hypothecationStatus',
  'soldAtAuction',
  'releaseRequestedForPartyType',
];
