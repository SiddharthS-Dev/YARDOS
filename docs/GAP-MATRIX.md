# YARDOS — Gap Matrix

Verified against the repository on **2026-09-09** by direct inspection and by
running the full test suite. This is not a restatement of a brief; where the two
disagree, this file follows the code.

Legend — **Tested**: `unit` pure domain, `int` database-backed integration,
`e2e` full HTTP lifecycle, `db` asserted via a constraint or trigger, `—` none.

| Domain | Exists | Partial | Missing | Broken | Tested | Priority |
|---|:---:|:---:|:---:|:---:|---|---|
| Identity / auth | ✅ | | | | int, e2e | — |
| Tenant (organisation) | ✅ | | | | int | — |
| RBAC (86 permissions) | ✅ | | | | int, e2e | — |
| ABAC / data scope (site, financier) | ✅ | | | | int ×12 | — |
| Vehicle | ✅ | | | | int, e2e | — |
| Vehicle 360 | ✅ | | | | e2e | — |
| Plate normalisation | ✅ | | | | int ×15 | — |
| ANPR | ✅ | | | | int, e2e | — |
| Registry provider abstraction | ✅ | | | | unit, e2e | — |
| VAHAN (authorised route) | | ⚠ | | | — | **Blocked — OI-01** |
| Financier | ✅ | | | | int | — |
| Financier matching | ✅ | | | | unit | — |
| Contract | ✅ | | | | unit, e2e | — |
| Rate card | ✅ | | | | unit, e2e | — |
| Yard / Site | ✅ | | | | int | — |
| Zone | ✅ | | | | int | — |
| Bay / Space | ✅ | | | | int, db | — |
| Admission | ✅ | | | | e2e | — |
| Visit (`ParkingSession`) | ✅ | | | | e2e, db | — |
| Allocation | ✅ | | | | int, db | — |
| Charge accrual | ✅ | | | | unit ×40+, e2e | — |
| Invoice | ✅ | | | | e2e, db | — |
| Payment | ✅ | | | | e2e, int, db | — |
| Release | ✅ | | | | e2e ×9 | — |
| Auction | ✅ | | | | e2e ×20 | — |
| Bidder | ✅ | | | | e2e | — |
| Bid (immutable ladder) | ✅ | | | | e2e, db | — |
| Settlement | ✅ | | | | e2e | — |
| **Notification** | | | ❌ | | — | **P1 — next task** |
| **Document** | | | ❌ | | — | P3 |
| **Intelligence** | | | ❌ | | — | P4 |
| Audit (append-only) | ✅ | | | | e2e, db | — |
| Outbox / eventing | ✅ | | | | int | — |
| Reporting | ✅ | | | | int | P3 — dedicated suite |
| Gate console | ✅ | | | | — | P2 — no UI tests |
| Financier portal | ✅ | | | | — | P2 — no UI tests |
| Management dashboard | ✅ | | | | — | P2 — no UI tests |
| **Parking (Phase 2)** | | ⚠ | | | — | Out of Phase-1 scope |
| **Booking** | | | ❌ | | — | Phase 2 |
| **QR pass** | | | ❌ | | — | Phase 2 |
| **Realtime** | | | ❌ | | — | Not required for Phase 1 |
| **RLS** | | | ❌ | | — | **Decision needed** |
| Deployment (Docker) | ✅ | | | | manual | — |
| CI | ✅ | | | | — | **P1 — never observed green** |
| E2E | ✅ | | | | 45 tests | — |

---

## Notes on the rows that are not a simple tick

**VAHAN.** The provider interface, aggregator adapter, retry, circuit breaker,
rate limiter and cache are all built and working. What is missing is a
commercial or legal route to real data (OI-01). `productionSafetyChecks` refuses
to boot production with `VEHICLE_REGISTRY_PROVIDER=mock`, so this cannot be
shipped by accident.

**Notification.** The highest-value gap. `apps/api/src/modules/notification/` is
empty, but the schema, the templates and the seeded template rows all exist, and
release, invoice and auction already emit the events that should drive it. It is
the shortest path from "nothing" to "working feature".

**RLS.** Zero `ROW LEVEL SECURITY` statements exist. Isolation is enforced by
mandatory SQL predicates in the service layer and is verified by 12 integration
tests, including that a cross-financier read returns a 404 byte-identical to the
404 for a nonexistent id. This is genuinely effective for the current API-only
access path. It would not protect a direct database connection, a BI tool, or a
future service that bypasses the API. Whether that matters is a decision for Sri
JP, not one to make silently.

**Parking / Booking / QR / Realtime.** Briefing documents describe these as
existing and warn against breaking them. They do not exist in this repository —
no booking model, no QR, no PWA, no realtime layer. Three Phase-2 sites are
seeded and share the session model, which is what keeps Phase 2 from needing a
rewrite. Nothing here is broken because nothing here was built.

**CI.** Six jobs, all of which pass locally. The pipeline has never actually run
on GitHub Actions. Its PostgreSQL starts empty where the local database is
seeded, so the seed step carries weight it has not yet been asked to bear.

**Console tests.** 7,138 lines of Next.js with no automated coverage. Every
route was exercised by hand in earlier sessions and the API beneath them has 94
database-backed tests, but a UI regression would currently be caught by nobody.
