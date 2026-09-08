# Open Items Register

Business decisions that must be made by Sri JP Smartpark before the affected
functionality can go live.

Every item below was identified as unresolved in the requirements one-pager. The
platform does **not** guess at any of them. In each case the system has been
built so the answer is *configuration*, not code — so when Sri JP supplies the
decision, someone changes data in the console and the behaviour changes. No
redeploy, no developer.

Two things follow from that, and both matter:

- **Nothing here blocks development.** Every item has a working, clearly
  labelled placeholder or mock so the rest of the platform could be built and
  tested.
- **Several items DO block go-live.** They are marked accordingly. Shipping with
  a placeholder in place of a real commercial term would produce wrong invoices.

| ID | Item | Blocks go-live? | Owner |
|----|------|-----------------|-------|
| OI-01 | VAHAN data-access route | **Yes** | Sri JP + legal |
| OI-02 | Registry API / aggregator cost | **Yes** | Sri JP commercial |
| OI-03 | Registry fields actually available | No | Sri JP + provider |
| OI-04 | Initial financing-company list | **Yes** | Sri JP business |
| OI-05 | Contract and rate terms | **Yes** | Sri JP finance |
| OI-06 | Financier-vs-customer invoicing matrix | **Yes** | Sri JP finance |
| OI-07 | Phase 2 site count and locations | No (Phase 2) | Sri JP business |
| OI-08 | Phase 2 timelines | No (Phase 2) | Sri JP business |
| OI-09 | Public parking payment methods | No (Phase 2) | Sri JP commercial |

---

## OI-01 — VAHAN data-access route

**The question.** Direct VAHAN access is regulated. Which authorised route will
Sri JP use: a direct MoRTH/NIC agreement, or a licensed aggregator? If an
aggregator, which one?

**Why it is not decided in code.** Fabricating a "VAHAN integration" against an
API we have no right to call would be worthless at best. The requirement is
explicit that the route must be confirmed before development commits to it.

**What has been built instead.**

- `VehicleRegistryProvider` — the abstraction. Nothing in the domain knows
  where ownership data came from.
- `MockVehicleRegistryProvider` — a deterministic simulator for development.
- `AggregatorVehicleRegistryProvider` — a complete, production-shaped HTTP
  adapter with timeout, retry, circuit breaker, rate limiting and error
  mapping. Only the request/response *field mapping* is provisional; it is
  isolated in one function, `mapResponse`, and reads several plausible field
  spellings defensively.

**Safety controls already in place.** The simulator can never be mistaken for
real data:

- Its records carry `source: 'MOCK'` and `authoritative: false`.
- A non-authoritative record sets `vahanVerificationStatus = UNAVAILABLE`, never
  `VERIFIED` — so nothing in the platform ever shows simulated data as
  registry-verified.
- `productionSafetyChecks()` **refuses to boot** with `NODE_ENV=production` and
  `VEHICLE_REGISTRY_PROVIDER=mock`.

**To resolve:** set `VEHICLE_REGISTRY_PROVIDER=aggregator`, supply
`VEHICLE_REGISTRY_BASE_URL` and `VEHICLE_REGISTRY_API_KEY`, and adjust
`mapResponse` to the chosen provider's schema.

---

## OI-02 — Registry API / aggregator cost

**The question.** What does a lookup cost, and what is the monthly quota?

**Why it matters.** It determines how aggressively vehicles are enriched. At a
high per-call cost, re-enriching a returning vehicle every visit is waste; at a
low cost, fresher data is worth having.

**What has been built.** Cost control is already parameterised:

| Setting | Effect |
|---|---|
| `VEHICLE_REGISTRY_CACHE_TTL_HOURS` | A successful lookup is "fresh" for this long; re-enrichment inside the window is skipped entirely. Default 720h (30 days). |
| `VEHICLE_REGISTRY_RATE_LIMIT_PER_MINUTE` | Client-side throttle, so we cannot breach a quota and get the integration suspended. |
| `VEHICLE_REGISTRY_MAX_ATTEMPTS` | Bounded retries, so a failing plate cannot burn calls indefinitely. |

Every call is recorded in `integration_logs` with latency and outcome, so actual
volume and failure rate are measurable **before** a contract is signed. That
evidence is the point.

---

## OI-03 — Registry fields actually available

**The question.** Which fields does the chosen provider return? Owner name?
Full address? Hypothecation holder? Chassis number?

**Impact if narrow.** The financier-matching quality depends almost entirely on
the hypothecation holder field. Without it, matching falls back to manual.

**What has been built.** `VehicleRegistryRecord` defines the full field set we
would like. The adapter maps what is present and leaves the rest `null` — an
absent field shows as "unknown" in the console rather than being invented. The
platform degrades gracefully rather than breaking.

**Deliberate reduction.** Even where chassis and engine numbers *are* returned,
only the **last four characters** are stored (`chassisNumberLast4`). No workflow
here needs the full values, and storing them would be needless exposure of
personal data.

---

## OI-04 — Initial financing-company list

**The question.** Which financiers is Sri JP actually contracted with, and what
are their legal names, GSTINs, billing contacts and notification addresses?

**What has been built.** Six **invented** financiers are seeded — deliberately
not real institutions, so nothing in a demo implies a commercial relationship
that does not exist. The `financiers`, `financier_aliases` and
`financier_contacts` tables and their admin screens are complete.

**Note on aliases.** `financier_aliases` is worth understanding before the real
list is loaded. VAHAN returns the hypothecation holder as free text, and the
same lender appears as "HDFC BANK LTD", "H.D.F.C. Bank Limited", "HDFC BANK
LIMITED, CHENNAI" and so on. Each financier therefore carries a set of aliases,
and the matcher learns new ones automatically whenever a human confirms a match.
Loading the real list is data entry, not development.

---

## OI-05 — Contract and rate terms

**The question.** The actual commercial terms per financier: per-day rate, free
period, slab boundaries, minimum charges, grace periods, billing unit.

**Why nothing was invented.** These are the numbers that appear on invoices. A
plausible-looking guess is more dangerous than an obvious blank, because it can
survive into production unnoticed.

**What has been built.** A complete, tested rate engine (117 unit tests, 90%+
coverage on the money paths) supporting:

- billing units: minute, hour, day, calendar day, week, month
- rounding: ceiling, floor, nearest
- free periods, grace periods, minimum charges, daily caps
- arbitrary slab ladders, per-unit or flat
- configurable tax components

Seeded contracts use **placeholder** rates; every one carries the literal string
`PLACEHOLDER VALUE - not a Sri JP commercial term` in its own description field.

### A specific ambiguity needing an answer

The requirements' worked example reads:

```
Parking Duration: 47 days
Free Days: 7        Chargeable Days: 40
Days 1–30: ₹X       Days 31–40: ₹Y
```

That arithmetic (30 + 10 = 40) implies the free days are **removed** and the
chargeable days are renumbered from 1. But the common contractual reading is
that the day counter runs from entry, so a 47-day stay with 7 free days is
charged for ladder positions 8–47.

The two produce materially different invoices:

| Policy | 47-day stay, 7 free, days 1–30 @ ₹100 / 31–40 @ ₹60 / 41+ @ ₹40 |
|---|---|
| `SKIP_LADDER` (matches the example) | 30×100 + 10×60 = **₹3,600** |
| `CONSUME_LADDER` (counter runs from entry) | 23×100 + 10×60 + 7×40 = **₹3,180** |

Both are implemented and unit-tested. `freeUnitPolicy` is a per-rate-plan field.
**The seed defaults to `SKIP_LADDER` because it matches the supplied example** —
but this needs explicit confirmation from Sri JP finance, per contract.

---

## OI-06 — Financier-vs-customer invoicing matrix

**The question.** On release, who is invoiced — the financier or the customer?
Under what circumstances does it differ?

**What has been built.** A configurable rule engine, `BillingRuleEvaluator`,
evaluated most-specific-scope-first (contract → financier → site → global), then
by priority. Rules live in the `billing_rules` table and are edited in the
console. The rule that decided each invoice is recorded on the invoice
(`billingRuleId`) together with a human-readable reasoning string, so any
invoice can be traced to the rule that chose its bill-to party.

Facts available to a rule: parking mode, site type, financier, contract version,
vehicle class and status, stay length, charge subtotal, whether a financier was
matched, hypothecation status, whether the vehicle was sold at auction, and who
requested the release.

**Seeded starting point** (a defensible default that makes the mechanism
visible — *not* a Sri JP policy):

| Priority | Rule | Outcome |
|---|---|---|
| 900 | Public parking | CUSTOMER (settled at barrier) |
| 800 | Sold at auction | BIDDER |
| 100 | Yard stay with a matched financier | FINANCIER |
| 10 | No financier matched | CUSTOMER (and worth reviewing) |

**Also unresolved here:** GST treatment. The seeded tax profile is structured as
CGST/SGST would be, at placeholder rates, and is labelled as such. Sri JP's
accountant must confirm applicability, rate and HSN/SAC for (a) yard parking,
(b) public parking, and (c) an auction sale — these may differ.

A related setting, `release.requireInvoiceSettled`, is seeded `false`: it is not
yet known whether financiers settle on account monthly or per vehicle, and
therefore whether an outstanding balance should block a release.

---

## OI-07 — Phase 2 site count and locations

**The question.** How many airport / metro / railway sites, and where?

**What has been built.** The platform is genuinely multi-site. Three Phase 2
sites are seeded with status `PLANNED` — deliberately not `ACTIVE`, because
marking them live would misrepresent the commercial position.

Critically, Phase 2 required **no** parallel implementation. One
`ParkingSession` model serves both business lines, distinguished by
`parkingMode`; one `RatePlan` model serves both contract rates and site tariffs,
distinguished by `scope`. Adding a real site is an admin screen, not a project.

---

## OI-08 — Phase 2 timelines

**The question.** When do the public parking contracts start?

**Impact.** None on architecture — see OI-07. It affects only sequencing of the
remaining Phase 2 UI work (public parking exit-and-pay flow and its receipts).

---

## OI-09 — Public parking payment methods

**The question.** UPI, card, cash, FASTag, prepaid pass? Which gateway?

**What has been built.** A `PaymentProvider` abstraction and a `manual` provider
that records counter collection — which is what Phase 1 actually needs, since
financiers are invoiced on terms rather than paying at a barrier.

The gateway-facing pieces that are easy to get dangerously wrong are already
correct:

- `payment_webhook_events` stores every callback keyed on the provider's event
  id **before** processing, so a duplicate delivery can never apply a payment
  twice.
- A payment is only ever marked `SUCCESS` from a verified webhook — **never**
  because a browser request succeeded.
- Signature verification uses constant-time comparison.

**To resolve:** implement one `PaymentProvider` subclass for the chosen gateway.

---

## How these were handled, as a principle

For each unresolved item the same three-part approach was applied:

1. **Build the abstraction** — so the eventual answer plugs in without touching
   domain logic.
2. **Provide a clearly-labelled placeholder** — so development and testing are
   not blocked.
3. **Make it impossible to ship the placeholder by accident** — via
   `productionSafetyChecks()`, which refuses to start a production process
   configured with a mock provider, a template secret, or a development
   database password.

That third part is the one that matters most. An abstraction with a mock behind
it is only safe if something actively prevents the mock reaching production.
