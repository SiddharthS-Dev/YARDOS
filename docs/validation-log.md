# Validation Log

Evidence that the implemented parts of the platform actually work. Everything
below was executed against a running system — PostgreSQL 16, Redis 7 and MinIO
in Docker, the API built and started from `dist/`, the database migrated and
seeded.

Nothing here is a claim about code that was merely written. Where a workflow is
not yet implemented it is absent from this log, not asserted.

---

## 1. Environment

```
Node        24.9.0
PostgreSQL  16 (docker, host port 5442)
Redis       7  (docker, host port 6380)
MinIO       latest (docker, host ports 9000/9001)
```

Host port 5442 rather than 5432/5433: a pre-existing PostgreSQL was found
listening on 5433 during setup, which silently intercepted connections and
produced an authentication failure. The compose file now defaults to 5442 and
documents `POSTGRES_PORT` as the override.

---

## 2. Schema and integrity guarantees

```
tables                60
check constraints     58
triggers              10
partial unique idx    11
GIN (trigram) idx      5
```

### The audit trail is genuinely append-only

Not asserted — tested. Inserting an audit row and then attempting to alter it:

```sql
INSERT INTO audit_logs (action, "entityType", "correlationId", "actorRoles", "changedFields")
VALUES ('TEST.GUARD','Test','corr-guard-1', ARRAY['X'], ARRAY['y']);
-- INSERT 0 1

UPDATE audit_logs SET action='TAMPERED' WHERE "correlationId"='corr-guard-1';
-- ERROR:  Table "audit_logs" is append-only: UPDATE is not permitted
-- HINT:   Insert a compensating record instead of altering history.

DELETE FROM audit_logs WHERE "correlationId"='corr-guard-1';
-- ERROR:  Table "audit_logs" is append-only: DELETE is not permitted
```

The same guard protects `vehicle_timeline_events`, `release_approvals`,
`bid_events` and `login_attempts`. Separate triggers make bids immutable except
for `status`, freeze issued invoices, and freeze FINAL charge calculations.

---

## 3. Application boot and health

```
GET /health/live   → {"status":"ok","uptimeSeconds":0}
GET /health/ready  → {"status":"ok","database":"up"}
GET /health        → {"status":"ok","version":"1.0.0","components":[
                        {"name":"database","status":"up","latencyMs":9},
                        {"name":"redis","status":"up","latencyMs":3},
                        {"name":"object-storage","status":"up"},
                        {"name":"outbox","status":"up",
                         "detail":"pending=0 deadLetter=0 oldestPendingAgeSeconds=0"}]}
```

Health endpoints are version-neutral (`/health`, not `/v1/health`) so probes do
not have to be reconfigured when the API version changes.

### Fail-fast on a missing dependency

When the database container was stopped, the API refused to start and said why,
rather than starting in a broken state:

```json
{"level":"fatal","msg":"API failed to start",
 "error":"Can't reach database server at `localhost:5442`"}
```

---

## 4. Authentication and authorisation

```
POST /api/v1/auth/login   → 200, access + refresh token
GET  /api/v1/users        → 401 UNAUTHENTICATED   (no token)
```

The 401 response carried the standard error envelope and the full security
header set (CSP `default-src 'none'`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, no `X-Powered-By`).

---

## 5. Walkthrough A — vehicle arrival at the gate

Simulated an ANPR capture of a plate never seen before, as the Chennai yard
supervisor:

```
POST /api/v1/anpr/simulate
{"deviceCode":"YRD-CHN-01-CAM-IN","plateNumber":"TN 09 QQ 7788",
 "confidence":0.98,"vehicleClassHint":"CAR"}
```

Response:

```
outcome : ADMITTED
message : Admitted on stay SES-20260908-LQRZ77.
trace   :
  - Capture at Chennai Yard - Ambattur (YRD-CHN-01), direction ENTRY.
  - New vehicle record created for TN09QQ7788.
  - No financier matched for this vehicle, so no contract could be selected.
  - UNRESOLVED: The vehicle has no matched financier, so no contract rate applies.
  - Allocated Zone B - Cars and SUVs / B-008.
```

Confirmed:

- the plate `TN 09 QQ 7788` normalised to `TN09QQ7788`;
- a canonical vehicle record was created;
- a bay was allocated;
- **the vehicle was admitted despite having no resolvable rate** — requirement
  S9's "the gate must never block" — and the operator was told so explicitly
  rather than the problem being hidden.

### Async registry enrichment then completed

Four seconds later the same vehicle:

```json
{"reg":"TN09QQ7788","status":"PARKED",
 "make":"Bajaj","model":"RE Compact",
 "vahanStatus":"UNAVAILABLE","ownershipSource":"MOCK","simulated":true,
 "financier":"Northbridge Vehicle Finance",
 "matchMethod":"VAHAN_ALIAS","confidence":"1.0000",
 "zone":"Zone B - Cars and SUVs","space":"B-008","rateUnresolved":true}
```

Two things to note, both deliberate:

- The financier was matched from free text by the alias matcher at confidence
  1.0 — not hard-coded.
- `vahanStatus` is **`UNAVAILABLE`**, not `VERIFIED`, and `simulated` is `true`,
  because the mock provider declares itself non-authoritative. Simulated
  ownership data can never present as registry-verified anywhere in the
  platform.

### Immutable timeline

```
06:15:32 | VEHICLE_CREATED          | Vehicle first seen
06:15:32 | VEHICLE_STATUS_CHANGED   | Status: CAPTURED to IDENTIFIED
06:15:32 | VEHICLE_STATUS_CHANGED   | Status: IDENTIFIED to YARD_ADMITTED
06:15:32 | VEHICLE_STATUS_CHANGED   | Status: YARD_ADMITTED to PARKED
06:15:32 | SESSION_OPENED           | Entered Chennai Yard - Ambattur
```

Every hop was validated by the state machine; none was written directly.

---

## 6. Finance follow-up on an unrated stay

Signed in as the finance officer and attached the contract rate that could not
be resolved at admission:

```
POST /api/v1/parking-sessions/{id}/attach-rate
{"reason":"Financier confirmed after registry enrichment; applying the contract rate."}
```

```
total: INR 0.0000 | units: 0.000000
plan : Northbridge Vehicle Finance standard yard rate
explanation:
  - Stay: 0 minutes (2026-09-08T06:17:45Z to 2026-09-08T06:18:07Z, Asia/Kolkata).
  - Billable duration: 1.000000 calendar days (CALENDAR_DAY, rounded CEIL).
  - Free allowance: 1.000000 calendar days at no charge (policy SKIP_LADDER).
  - Entire stay is covered by the free allowance. Nothing to charge.
```

Correct: the vehicle had just arrived and the contract grants a free period.

---

## 7. Walkthrough B — charges accruing on a long stay

An aged seeded stay:

```
duration    : 564903 minutes
total units : 393.000000 | free: 0.000000 | chargeable: 393.000000

lines:
   1  SLAB   1..393  x 393.000000 @ 100.0000 = 39300.0000  Flat per day (placeholder rate)
tax:
   CGST (placeholder rate) @ 9.00% = 3537.0000
   SGST (placeholder rate) @ 9.00% = 3537.0000

SUBTOTAL 39300.0000   TAX 7074.0000   TOTAL 46374.0000 INR
inputsHash a04e0294abeeab2e...
```

Requirement S14 satisfied: the calculation is not a bare number. Every line
records its ladder positions, units and rate; the narrative is human-readable;
and `inputsHash` makes the result reproducible and therefore defensible to a
financier years later.

---

## 8. Walkthrough E — financier portal isolation

Two financier portal logins against the same estate:

```
portal A (Northbridge): total=3  distinctFinanciers=["Northbridge Vehicle Finance"]
portal B (Sundara)    : total=2  distinctFinanciers=["Sundara Capital Finance"]
```

Cross-tenant and privilege probes:

| Attempt | Result |
|---|---|
| Portal A requests portal B's vehicle by id | **HTTP 404** |
| Portal B requests its own vehicle | HTTP 200 |
| Finance officer requests the same vehicle | HTTP 200 |
| Portal A calls a finance-only endpoint | **HTTP 403** |

The 404 (rather than 403) on the cross-financier read is intentional: it denies
access without confirming that the record exists.

### PII masking varies by permission, on the same record

```
portal user  → registeredOwnerName: "I***** S*****"
finance user → registeredOwnerName: (full name)
```

Portal users lack `vehicle:pii:read`, so owner names are masked — requirement
S36's "do not make ownership information globally visible merely because it
exists".

---

## 9. Automated tests

```
Test Suites: 4 passed, 4 total
Tests:       117 passed, 117 total
```

| Suite | Tests | Covers |
|---|---|---|
| `charge-engine.spec.ts` | 41 | Slab ladders, both free-unit policies, grace, daily caps, minimum charges, tax (simple/compounding/fixed), calendar-day vs elapsed-day, timezone correctness, determinism, decimal precision, ladder validation |
| `state-machine.spec.ts` | 32 | Every lifecycle, and specifically the transitions that must be **impossible** |
| `billing-rule-evaluator.spec.ts` | 22 | Scope precedence, priority, deterministic tie-breaks, all operators, rule validation |
| `financier-matcher.service.spec.ts` | 22 | Exact/containment/token matching, and that fuzzy matches never auto-accept |

Two of these caught real defects during development (§10).

---

## 10. Defects found and fixed during validation

Recorded because they show the tests and walkthroughs doing their job.

**1. Returning vehicles could not be re-admitted.**
`EXITED` was modelled as terminal, so a vehicle repossessed a second time — or
simply entering a public car park months later — could not be admitted at all.
Fixed by allowing `EXITED → CAPTURED`, so a returning vehicle starts a fresh
visit on the *same* canonical record (which is what makes the financier
intelligence service work). Jumping straight back to `PARKED` remains
forbidden, so a returning vehicle is always re-identified and re-rated.

**2. Unknown-class vehicles could not be allocated a bay.**
Zones carry a vehicle-class allow-list. A vehicle whose class is not yet known
(the registry has not responded) matched no zone, and the operator was told
"every eligible zone is at capacity" — which was also misleading, since the
zones were not full. Fixed: `UNKNOWN` now matches any zone, and the three
distinct failure cases (no zones configured / no zone accepts this class / all
accepting zones full) now produce three distinct messages.

**3. Registry enrichment never ran.**
The gate enqueued the job correctly, but no handler was registered, so vehicles
stayed permanently unenriched. Fixed by adding `JobsService`, which registers
the queue handler and adds reconciliation sweeps — including a backfill that
finds vehicles whose enqueue was lost, because a queue is best-effort and the
database is the real source of truth about outstanding work.

**4. Financier alias seeding violated a unique constraint.**
Both the legal and display names normalise to the same alias once corporate
suffixes are stripped ("Northbridge Vehicle Finance Limited" and "Northbridge
Vehicle Finance" both become `NORTHBRIDGEVEHICLEFINANCE`). The constraint was
right; the seed was wrong. Fixed by de-duplicating before insert.

**5. A test asserted the wrong thing.** A calendar-day test used 23:30 IST plus
30 minutes and expected one day. That genuinely crosses midnight, so two
calendar days was correct. The engine was right and the fixture was wrong.

---

## 11. Not validated

Because it is not implemented. Listed so the gaps are unambiguous:

- Walkthrough C (release → invoice → payment → exit) — release and invoice
  services are not written.
- Walkthrough D (auction → bid → winner → settlement → sale invoice) — the
  schema, immutability triggers and seed data exist and are exercised, but
  there is no service layer.
- Walkthrough F (public parking entry → tariff → payment → receipt) — rating is
  implemented and unit-tested; the exit-and-pay flow is not.
- Notification delivery, invoice PDFs, reporting endpoints.
- The operations console — no UI exists.
