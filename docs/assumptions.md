# Assumptions and Proposed Design

Every decision on this list was **made by the implementation team, not supplied
by Sri JP**. None of it came from the requirements one-pager.

They are separated from the requirements deliberately. A requirement is a
commitment somebody made; an assumption is a gap somebody filled. Confusing the
two is how a platform ends up enforcing rules nobody agreed to.

Each entry states what was assumed, why, what it costs to change, and who needs
to confirm it. Where an assumption affects money or access, it is configurable
rather than compiled in.

---

## A. Assumptions that affect money

These need finance sign-off before go-live.

### A-1 · Free days are removed from the ladder, not consumed by it

**Assumed:** `freeUnitPolicy = SKIP_LADDER` as the default on every seeded rate
plan.

**Why:** it is the only reading consistent with the worked example in the
requirements (47 days − 7 free = 40 chargeable, billed as days 1–30 then 31–40).

**But:** the common contractual reading is the opposite — the day counter runs
from entry, so day 8 is priced at the day-8 slab. On the example figures the two
differ by ₹420 on a single vehicle.

**Cost to change:** one field per rate plan. Both behaviours are implemented and
unit-tested.

**Confirm with:** Sri JP finance, per contract. Tracked as OI-05.

---

### A-2 · Yard stays are billed in calendar days, rounded up

**Assumed:** `billingUnit = CALENDAR_DAY`, `roundingMode = CEIL` on seeded yard
plans — the entry date counts as day 1, and any part of a day is a full day.

**Why:** it is the prevailing convention for yard storage, and it is what a
financier querying an invoice will expect to be able to reproduce by counting
dates on a calendar.

**But:** `DAY` (elapsed 24-hour periods from the entry instant) is materially
different. A vehicle in at 23:00 and out at 01:00 the next night is 1 calendar
day under one reading and 2 under the other.

**Cost to change:** one field per rate plan. Six billing units are implemented.

---

### A-3 · Calendar arithmetic uses the site's timezone

**Assumed:** day boundaries are computed in the **site's** IANA timezone
(`sites.timezone`), never the server's.

**Why:** a yard must not bill a different number of days because the
application was deployed in a different region. This is a correctness decision
rather than a business one, but it is visible on invoices, so it is stated.

**Cost to change:** none anticipated. Covered by a unit test that shows the same
two instants producing 1 day in UTC and 2 in Asia/Kolkata.

---

### A-4 · Tax structure is modelled; tax rates are placeholders

**Assumed:** a two-component profile shaped as CGST/SGST would be, at 9% each.

**Why:** the invoice layout and the engine's tax handling had to be exercised
against *something*. The structure is almost certainly right; the rates are a
guess.

**Guard:** every seeded tax row carries the literal string
`PLACEHOLDER VALUE - not a Sri JP commercial term` in its description.

**Confirm with:** Sri JP's accountant — and note the answer may differ across
yard parking, public parking, and an auction sale. Tracked as OI-06.

---

### A-5 · Default billing party is the financier for yard stays

**Assumed:** four seeded billing rules — public parking bills the driver, an
auction sale bills the winning bidder, a yard stay with a matched financier
bills the financier, and an unmatched vehicle falls to whoever collects it.

**Why:** the requirements frame the yard business as financiers parking
repossessed vehicles. That makes the financier the obvious default, but "obvious
default" is not the same as "agreed matrix".

**Cost to change:** these are rows in `billing_rules`, editable in the console.
The rule that decided each invoice is recorded on the invoice with a
human-readable reason, so a wrong rule is traceable after the fact.

**Confirm with:** Sri JP finance. Tracked as OI-06.

---

### A-6 · An outstanding balance does not block release

**Assumed:** `release.requireInvoiceSettled = false`.

**Why:** it is unknown whether financiers settle monthly on account or per
vehicle. Blocking releases by default would be the more disruptive guess — it
would strand vehicles over an accounting arrangement that may not exist.

**Cost to change:** one system setting.

---

### A-7 · Auction settlement figures

**Assumed:** a 2% buyer's premium and a 7-day settlement window in the seed.

**Why:** purely so the settlement flow has plausible numbers. There is no basis
for either figure.

**Guard:** both are labelled placeholders; the settlement window is a system
setting.

---

## B. Assumptions that affect access and security

### B-1 · Two roles beyond the five named in the requirements

**Assumed:** the requirements name Sri JP management, yard staff, finance
company users, auction administrators and system administrators. Two more were
added:

- **`FINANCE_OFFICER`** — owns contracts, rates, invoicing and payments.
- **`DEVICE_SERVICE_ACCOUNT`** — the machine principal ANPR gateways
  authenticate as.

**Why:** billing duties should not be carried out under a management login
(management approves; it should not also execute), and cameras should not post
captures using a human's credentials.

**Consequence, deliberately:** the device account holds exactly one permission,
`anpr:event:ingest`, and is barred from every other route. A leaked camera
credential cannot enumerate the yard.

**Cost to change:** role bundles are seeded data.

---

### B-2 · Segregation of duty in the permission bundles

**Assumed:** management can approve a release but cannot issue an invoice; the
auction administrator can select a winner but cannot raise the sale invoice or
record its payment; yard staff can request a release but not approve one.

**Why:** these are the standard separations for a business handling third-party
assets and cash. Nobody asked for them, but their absence would be a finding in
any audit.

**Cost to change:** edit the role's permission set.

---

### B-3 · scrypt rather than Argon2id for passwords

**Assumed:** scrypt from Node's built-in `crypto`, N=2^15, r=8, p=2.

**Why:** it is a memory-hard KDF that OWASP accepts as an Argon2id alternative,
and it ships with the runtime. Argon2 and bcrypt both need a native addon — a
compiler on every build agent and a supply-chain dependency on a binary. For a
platform holding vehicle-ownership and financier data, "no native crypto
dependency" was judged worth more than the marginal advantage of Argon2id.

**Migration path built in:** the stored format carries its own parameters
(`scrypt$N$r$p$salt$hash`), the `users.passwordAlgorithm` column records the
scheme, and `needsRehash()` upgrades a hash transparently on the owner's next
successful login. Swapping to Argon2id later needs no password reset.

---

### B-4 · Financier match confidence threshold of 0.80

**Assumed:** a registry financier match is applied automatically at ≥0.80
confidence; below that it is recorded as a suggestion needing human
confirmation. Fuzzy token-overlap matches are **capped at 0.75**, so they can
never auto-accept.

**Why:** attaching a vehicle to the wrong lender means invoicing the wrong
company *and* exposing one financier's asset to another in the portal. The
asymmetry justifies a high bar and a hard cap on the least reliable method.

**Cost to change:** the system setting
`financier.match.autoAcceptConfidence`.

---

### B-5 · Only the last four characters of chassis and engine numbers are stored

**Assumed:** even when the registry returns them in full, only the tail is
retained, and the full values are stripped from the stored raw payload.

**Why:** no workflow in this platform needs them. Storing personal data with no
purpose is exposure without benefit.

**Cost to change:** widening it later is a schema change; it was judged easier
to justify adding data than to justify having kept it.

---

## C. Assumptions about operations

### C-1 · The gate never blocks, and unrated stays are a work queue

**Assumed:** when no contract rate can be resolved at admission, the vehicle is
**still admitted**. The stay is flagged `rateUnresolved` and appears in a finance
work queue with an `attach-rate` action.

**Why:** the requirements are explicit that the gate must not bottleneck on
external systems. A vehicle stuck at a barrier is a worse outcome than a stay
that needs its rate attached an hour later. The alternative — guessing a rate —
would be far worse than either.

**Consequence:** somebody must work that queue. It is a business process, not
just a screen.

---

### C-2 · An ANPR exit capture does not release a repossessed vehicle

**Assumed:** in a yard, an exit capture with no approved release request is
recorded, audited and raised as an **unauthorised exit attempt**; the barrier is
not opened. Public parking behaves differently — exit computes the charge and
settles at the barrier.

**Why:** these are third-party assets under repossession. Automating their
departure on a camera read would be indefensible.

---

### C-3 · Low-confidence captures go to a human, and overrides are audited

**Assumed:** a default confidence threshold of 0.85, per-device overridable.
Below it, the capture is queued for review rather than admitting a guess. Every
manual resolution records the operator, the original reading and the corrected
one.

**Why:** a mis-read plate attaches a stay — and eventually an invoice — to the
wrong vehicle and the wrong financier. The audit record exists so that an
operator systematically "correcting" plates is detectable.

---

### C-4 · Registry data is considered fresh for 30 days

**Assumed:** `VEHICLE_REGISTRY_CACHE_TTL_HOURS = 720`. A vehicle whose ownership
was retrieved inside that window is not re-enriched.

**Why:** aggregator calls are charged per request and the cost is unknown
(OI-02). Hypothecation changes slowly. The window is deliberately generous and
trivially tunable once the real cost is known.

---

### C-5 · ANPR de-duplication window of 120 seconds

**Assumed:** captures of the same plate, at the same device, in the same
direction, inside 120 seconds are one physical arrival.

**Why:** cameras fire multiple frames per vehicle. Without a window, one arrival
becomes several stays.

**Belt and braces:** Redis provides a fast short-circuit, but the actual
guarantee is a unique index on `dedupeKey`. Correctness does not depend on the
cache being up.

---

### C-6 · Individual bays are modelled for yards, not for public car parks

**Assumed:** yards get numbered bays (`parking_spaces`); public sites are
capacity-counted only.

**Why:** a yard needs to know where a specific vehicle physically is, in order
to retrieve it. A commuter car park does not assign bays.

---

## D. Assumptions about architecture

### D-1 · Modular monolith, not microservices

**Assumed:** one deployable, with hard module boundaries and communication via a
transactional outbox rather than direct cross-module calls.

**Why:** the requirements ask for exactly this, and it is right for the scale.
The outbox means extracting a module later is a transport change, not a rewrite.

---

### D-2 · Money is `NUMERIC(18,4)` and travels as a decimal string

**Assumed:** never a JavaScript number, anywhere — not in the database, not in
JSON, not in the rate-plan snapshot.

**Why:** IEEE-754 cannot represent currency exactly. An invoice a paisa out is a
defect, and it is the kind that survives to production.

**Enforced by:** `decimal.js` throughout the engine, a unit test proving 3,650 ×
₹0.10 is exactly ₹365.00, and a CHECK constraint requiring
`total = subtotal + taxTotal` on every calculation and invoice.

---

### D-3 · The rate plan is snapshotted at admission

**Assumed:** a stay is priced against a frozen copy of its rate plan, taken when
the vehicle was admitted — not against the live rows.

**Why:** stays last months and contracts get renegotiated. Pricing from today's
rate card would silently re-price vehicles already in the yard, including stays
already invoiced.

---

### D-4 · The database enforces what the application cannot

**Assumed:** partial unique indexes, CHECK constraints and immutability triggers
carry rules that application code alone cannot guarantee under concurrency —
one live session per vehicle, one live auction lot per vehicle, immutable bids,
frozen issued invoices, append-only audit.

**Why:** two gates can fire simultaneously; two users can click release at once.
Application-level checks race. A unique index does not.

**Visible consequence:** the seed must use `TRUNCATE` rather than `DELETE`,
because the triggers correctly refuse to delete history.

---

### D-5 · Mock adapters exist, and cannot reach production

**Assumed:** mock providers for ANPR, the vehicle registry, payment and the
three notification channels — because development cannot wait for credentials
that do not exist yet.

**The rule that makes this safe:** `productionSafetyChecks()` refuses to start
the process when `NODE_ENV=production` and any mock provider is configured, or a
template secret is still in place, or the database URL still carries the
development password, or CORS is unset or wildcarded, or logs are not structured
JSON.

An abstraction with a mock behind it is only safe if something actively prevents
the mock reaching production. That check is the difference.
