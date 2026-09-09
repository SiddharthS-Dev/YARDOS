# YARDOS — Business Decisions

Every business question this implementation has met, and what was done about it.

The rule this file exists to enforce: **no business rule is decided silently.**
Where the answer is genuinely a Sri JP decision, the platform implements *both*
readings behind configuration and refuses to pick one on the customer's behalf.
Where a value had to exist for the system to run, it is a placeholder that says
so in its own description field.

`docs/open-items.md` holds the full detail for OI-01 … OI-09. This file is the
decision register: what is decided, what is deferred, and what the code does in
the meantime.

Last reviewed: **2026-09-09**

---

## Status summary

| # | Question | Status | Blocks production? | Owner |
|---|---|---|---|---|
| BD-01 | Free days vs ladder position (OI-05) | **Deferred — configurable** | No | Sri JP finance |
| BD-02 | Who is invoiced on release (OI-06) | **Deferred — rule engine, no rules** | No | Sri JP finance |
| BD-03 | Payment required before release | **Deferred — configurable** | No | Sri JP finance |
| BD-04 | Approval required for release | **Decided — two-person rule** | No | Platform |
| BD-05 | VAHAN / registry access route (OI-01) | **Blocked** | **Yes** | Sri JP + legal |
| BD-06 | Auction eligibility threshold | **Deferred — configurable** | No | Sri JP business |
| BD-07 | Commercial rates, taxes, fees | **Placeholder — clearly marked** | **Yes** | Sri JP finance |
| BD-08 | Financier master list (OI-04) | **Placeholder — invented names** | **Yes** | Sri JP business |
| BD-09 | Phase-2 rollout and timelines (OI-07/08) | **Deferred** | No | Sri JP business |
| BD-10 | Row-Level Security | **Open — needs a decision** | Possibly | Sri JP + security |
| BD-11 | Mock providers in production | **Decided — refused at boot** | No | Platform |
| BD-12 | Money representation | **Decided — no floats, ever** | No | Platform |

---

## BD-01 — Free days: do they consume ladder positions? (OI-05)

**The question.** A 47-day stay with 7 free days. Does charging start at ladder
position 1, or at position 8?

The requirements' worked example (`30 + 10 = 40` chargeable days) implies free
days are removed and the counter restarts. The common contractual reading is
that the counter runs from entry.

On a 47-day stay at ₹100 / ₹60 / ₹40 the two differ by **₹420 per vehicle** —
material across a yard.

**Decision: deferred, and made configurable.** `RatePlan.freeUnitPolicy` takes
`SKIP_LADDER` or `CONSUME_LADDER`. Both are implemented in
[`charge-engine.ts:173-181`](../apps/api/src/modules/billing/domain/charge-engine.ts)
and both are unit-tested. The seed uses `SKIP_LADDER` **because it matches the
supplied example**, not because it is correct.

**Needed:** written confirmation per contract from Sri JP finance.

## BD-02 — Who is invoiced on release? (OI-06)

**Decision: deferred.** A `BillingRule` engine exists and is unit-tested; the
rules themselves are Sri JP's to define. When no rule matches, invoice
generation fails with `BILLING_PARTY_UNRESOLVED` naming OI-03 — it does not
guess a bill-to party.

**Needed:** the financier-vs-customer matrix, including the exception cases.

## BD-03 — Must an invoice be settled before the vehicle leaves?

**Decision: deferred, and made configurable.** The setting
`release.requireInvoiceSettled` controls whether an outstanding balance is a
*blocking* eligibility failure or an advisory one. Both paths are exercised by
the release E2E suite.

Neither answer is universal: some financiers settle monthly on account, some
customers pay at the gate.

**Needed:** the default, and whether it varies by financier.

## BD-04 — Who may approve a release?

**Decision: made, deliberately, by the platform.** A release cannot be approved
by the person who requested it. This is not configurable, and should not be:
allowing one person to authorise the removal of a repossessed vehicle they
themselves requested is the single highest-value fraud in this business.

Enforced in `release.service.ts`, not in the console, so it holds however the
endpoint is reached. Covered by `recovery-lifecycle.e2e.spec.ts` step 9b, with a
separate test (9a) confirming the permission guard refuses roles that lack
`release:approve` at all.

The gate authorisation code is generated once, displayed once, and stored only
as a SHA-256 hash.

**If Sri JP needs single-person release for a specific site**, that is a change
to make explicitly and audibly, not by relaxing a default.

## BD-05 — How is registry data obtained? (OI-01)

**Status: blocked, and blocking.** Three routes are possible: an authorised
government API, a licensed aggregator, or neither. The platform does not assume
any of them. `VehicleRegistryProvider` abstracts the choice; a `mock` and an
`aggregator` adapter both exist.

**Mock data is never presented as verified ownership.** A vehicle enriched from
the simulator cannot reach `vahanVerificationStatus = VERIFIED`, and
`productionSafetyChecks` refuses to boot production with
`VEHICLE_REGISTRY_PROVIDER=mock` — naming OI-01 in the error.

**Needed:** the commercial and legal route, before any production deployment.

## BD-06 — When does a vehicle become auction-eligible?

**Decision: deferred, and made configurable.** Ageing thresholds are system
settings with site-level override, not constants. No default is claimed to be
the business rule.

**Needed:** the threshold, and who authorises disposal.

## BD-07 — Rates, taxes and fees

**Status: every commercial value in this repository is a placeholder.** Each
seeded contract carries the literal string
`PLACEHOLDER VALUE - not a Sri JP commercial term` in its own description field,
so a placeholder cannot be mistaken for a negotiated term by reading the data.

Tax profiles use a plausible GST structure. **No tax rate here has been
confirmed against Indian GST law for this service category.**

**Needed:** the real rate cards, tax treatment and fee schedule.

## BD-08 — The financier list (OI-04)

**Status: invented, deliberately.** The six seeded financiers — Northbridge,
Sundara, Meridian, Kaveri, Everest, Palmgrove — are **not real institutions**.
Seeding real financier names would imply commercial relationships Sri JP may not
have.

**Needed:** the actual list, with aliases as they appear in registry data.

## BD-09 — Phase-2 parking (OI-07, OI-08)

**Status: deferred.** Three Phase-2 sites are seeded so the multi-site and
tariff models are exercised. No booking, QR pass or driver-facing surface has
been built, and none is in Phase-1 scope.

The architectural commitment is that Phase 2 reuses `ParkingSession`, the rating
engine and reporting rather than forking them.

## BD-10 — Row-Level Security

**Status: open, and needs an explicit answer.**

Briefing documents state that RLS exists. **It does not** — there are zero
`ROW LEVEL SECURITY` statements in either migration.

Isolation is instead enforced by mandatory SQL predicates in the service layer,
verified by 12 integration tests including the non-disclosure property (a
cross-financier read returns a 404 byte-identical to the 404 for a nonexistent
id). For the current API-only access path this is effective.

It would **not** protect a direct database connection, a BI tool, or a future
service that bypasses the API.

**Needed:** a decision. Either accept app-layer enforcement and record why, or
schedule RLS. Adding it later is materially harder than adding it now.

## BD-11 — Can a mock provider reach production?

**Decision: no, and it is enforced at boot.** `productionSafetyChecks` refuses
to start production with a mock ANPR, registry, payment or notification
provider, a template secret from `.env.example`, one secret reused for both
token types, the development database password, wildcard or plaintext CORS,
pretty logging, filesystem object storage, or the inline queue driver.

All 12 refusals are pinned by tests in `configuration.spec.ts`, so removing one
fails the build rather than production.

## BD-12 — How is money represented?

**Decision: made, and non-negotiable.** `NUMERIC(18,4)` in the database,
`decimal.js` in the domain, decimal **strings** on the wire. No JSON number ever
carries an amount.

The console never computes a monetary value — it formats what the API sends. A
total the user sees is a total the server stands behind.

---

## What "deferred" means here

A deferred decision is **not** an unimplemented one. In every case above the
platform either implements both readings behind a flag, or fails loudly with an
error naming the open item. What it never does is pick an answer quietly and
present the result as though it were authoritative.
