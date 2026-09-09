# YARDOS — Continuation

**Read this first.** It is the handover between sessions and is written so a new
session can pick up without any conversation history.

Last updated: **2026-09-09**
Repository state: **all work committed and pushed to `origin/main`**

---

## 1. What this repository actually is

An **npm-workspaces monorepo** running a **NestJS 11 + Prisma 6 + PostgreSQL 16
modular monolith**, a **Next.js 15** operations console, and a shared
`@smartpark/contracts` package.

```
apps/api        NestJS modular monolith        ~26k LOC
apps/web        Next.js 15 console, 11 routes   ~7k LOC
packages/contracts  shared types, 86 permissions
docker/         compose stack + two production Dockerfiles
docs/           assumptions, open items, traceability, validation log
```

### Discrepancies with the briefing documents — read before planning

Session briefs have described a stack this repository does not have. Verified
absent on 2026-09-09 by direct search:

| Briefed as existing | Reality |
|---|---|
| Supabase, Edge Functions, `pg_cron` | **Not present.** NestJS + Prisma against plain PostgreSQL. |
| Driver PWA, booking engine, slot grid, QR passes, "I'm Here" flow | **Not present.** No booking model, no QR, no PWA. |
| Supabase Realtime | **Not present.** No realtime layer of any kind. |
| MapLibre, shadcn/ui, Radix | **Not present.** Tailwind + hand-written primitives. |
| PostgreSQL **RLS** | **Not present.** Zero `ROW LEVEL SECURITY` statements. |
| Exclusion constraints (`EXCLUDE USING`) | **Not present.** Partial unique indexes are used instead. |
| Docs `01 Vision` … `12 Brand` | **Not present.** Four docs exist, listed above. |

Instructions to "not break the existing Parking domain" have nothing to break:
Phase 2 parking exists only as three seeded sites and the shared session model.

**Tenant and financier isolation is real, but it is enforced by mandatory SQL
predicates in the service layer, not by RLS.** That is effective for the current
API-only access path and is verified by 12 integration tests. It would not
protect a direct database connection. See Open Questions.

---

## 2. Architecture

```
Vehicle (identity, normalised plate)
  → ParkingSession  (the shared "visit" concept: recovery AND Phase-2 parking)
    → ParkingSpace / ParkingZone / Site
    → Contract → RatePlan → ChargeCalculation → ChargeLine
      → Invoice → Payment
      → ReleaseRequest → exit
      or
      → AuctionLot → Bid → Settlement
  → AuditLog, VehicleTimelineEvent, Outbox   (all append-only)
```

`ParkingSession` **is** the Visit concept from the brief. Recovery does not go
through a booking model, and there is no booking model to force it into.

### Load-bearing invariants

- **Money** is `NUMERIC(18,4)` in the database, `decimal.js` in the domain, and
  a **decimal string** on the wire. No float ever touches a rupee figure. The
  console never computes a monetary value.
- **Charges** are deterministic and explainable: `inputsHash`, per-line ladder
  positions, a narrative, and a rate-plan snapshot frozen at admission.
- **The gate never waits for the registry.** `gate.service.ts:122` queues
  enrichment *after* the transaction commits.
- **Correctness lives in the database**: 58 CHECK constraints, 11 partial unique
  indexes, 10 immutability triggers, 5 trigram indexes.
- **Authorization fails closed**: global `JwtAuthGuard` + `PermissionsGuard`. Of
  73 routes, 9 carry no permission decorator and all 9 are deliberate (3 health
  probes, login, refresh, logout, me, change-password, and the HMAC-authenticated
  payment webhook).

---

## 3. Completed features

| Area | State |
|---|---|
| Identity, RBAC (86 permissions), site scoping | Complete, tested |
| Vehicle repository, plate normalisation | Complete, tested |
| ANPR ingestion + simulator | Complete, tested |
| Registry provider abstraction (mock / aggregator) | Complete, tested |
| Financier matching with confidence | Complete, unit tested |
| Contract, rate plan, tax profile | Complete, unit tested |
| Charge engine | Complete, heavily unit tested |
| Gate: admission, allocation, async enrichment | Complete, tested |
| Release (6 eligibility checks, segregation of duty) | Complete, tested |
| Invoice (gap-free numbering, idempotent) | Complete, tested |
| Payment (manual + gateway, idempotent, signed webhooks) | Complete, tested |
| Auction (immutable bid ladder, settlement) | Complete, tested |
| Reporting (6 endpoints, SQL-scoped) | Complete, integration tested |
| Web console (11 routes) | Complete, no automated tests |
| Audit + outbox | Complete, immutability tested |
| Docker images (API 765MB, web 368MB, non-root) | Complete, manually verified |
| CI pipeline (6 jobs) | Complete, **not yet observed green on GitHub** |

## 4. Partial features

- **Console has no automated tests.** No Playwright, no component tests.
- **Reporting** has endpoints and integration coverage but no dedicated suite.
- **Documentation is stale**: `README.md` still says "no web console has been
  built"; `docs/requirements-traceability.md` still shows 18 Partial / 10 Not
  started. Both predate the last three sessions.

## 5. Missing features

| Missing | Notes |
|---|---|
| **Notification module** | Directory empty. Schema, templates and seeded rows exist; no service, no controller. |
| **Document module** | Directory empty. `ObjectStorageService` exists and works. |
| **Intelligence module** | Directory empty. Nothing depends on it yet. |
| Phase-2 parking workflows | Sites seeded; no booking, QR or driver-facing surface. Out of Phase-1 scope. |
| RLS | See Open Questions. |

## 6. Known bugs

None open. Fixed and verified this session:

1. **Webhook HMAC verified against a re-serialised body** (`0b8e145`). Both the
   payment and ANPR signed endpoints hashed `JSON.stringify(parsedBody)` instead
   of the transmitted bytes. Now covered by tests that go red if reverted.
2. **8 high-severity advisories** from `multer <=2.2.0` (`e117a32`), plus four
   earlier from postcss and deepmerge-ts (`b62beaa`). `npm audit` now reports
   **0 vulnerabilities**.

Fixed in earlier sessions: `closeSession` CHECK violation, bid-endpoint
permission, unknown-class zone allocation, EXITED re-admission, registry queue
handler.

## 7. Database state

- 59 tables, 59 enums, 2 migrations, replayable from empty, **no drift**.
- 58 CHECK constraints, 60 unique indexes (11 partial), 127 foreign keys,
  5 trigram indexes, 10 triggers backed by 6 guard functions.
- Append-only: `audit_logs`, `vehicle_timeline_events`, `release_approvals`,
  `bid_events`, `login_attempts`. Frozen once final: issued invoices, invoice
  lines, FINAL charge calculations, bids, settlements.

## 8. API state

73 routes across 11 controllers, URI-versioned under `/api/v1`, OpenAPI served
outside production only.

## 9. UI state

11 Next.js routes: login, gate, dashboard, vehicles, vehicle detail, yard, yard
detail, billing, auctions, portal. Dark navy base, cyan accent, semantic colour
only where it carries meaning. Permission-filtered navigation, single-flight
token refresh, always-visible focus rings.

## 10. Test state — **236 passing, 0 failing**

| Project | Suites | Tests | Command |
|---|---|---|---|
| unit | 5 | 142 | `npm run test:unit -w @smartpark/api` |
| integration | 4 | 49 | `npm run test:integration -w @smartpark/api` |
| e2e | 2 | 45 | `npm run test:e2e -w @smartpark/api` |

Integration and E2E need the stack running (`npm run stack:up`) and a seeded
database (`npm run db:seed`).

Also verified: `tsc --noEmit` clean for API, seed and console; ESLint clean at
`--max-warnings=0`; `npm audit` reports 0 vulnerabilities.

## 11. Deployment state

Two production Dockerfiles, both verified running: non-root (uid 1000), tini as
PID 1, healthcheck passing, no `.env` in either image. **Not yet deployed
anywhere.** Set `APP_VERSION` in deployment config — the container currently
reports `0.0.0`.

CI (`.github/workflows/ci.yml`) has six jobs and uses throwaway service
containers with generated credentials. It has **not yet been observed green on
GitHub Actions** — that is the first thing to check next session.

## 12. Business decisions

See `docs/BUSINESS_DECISIONS.md`. Nothing has been silently decided; every
placeholder rate, tax and fee is marked as such in `docs/assumptions.md`.

## 13. Open questions

1. **Is Postgres RLS required?** Briefs assert it exists; it does not. App-layer
   predicates may be a deliberate and acceptable choice — but it should be a
   decision, not a surprise. *Needs: Sri JP / security sign-off.*
2. **OI-01 VAHAN route** — authorised government API, licensed aggregator, or
   neither. Blocks production. *Needs: Sri JP + legal.*
3. **OI-05 free-days vs ladder** — both implemented, configurable per rate plan
   via `freeUnitPolicy`. The seed uses `SKIP_LADDER` because it matches the
   worked example in the requirements, not because it is confirmed correct; the
   two readings differ by ~₹420 on a 47-day stay. *Needs: Sri JP finance.*
4. **OI-06 invoicing party matrix** — rule engine exists; the rules do not.
   *Needs: Sri JP finance.*
5. **Phase-2 timelines** — three sites seeded, no committed dates.

## 14. Current task

**Complete.** This session: cleared all dependency advisories, fixed the webhook
signature defect, and built the integration and E2E suites (117 → 236 tests).

## 15. Next task

In order:

1. **Watch the first CI run on GitHub Actions and fix what it finds.** Every job
   passes locally, but CI has never actually run. Its Postgres is empty where
   the local database is seeded, so the seed step is load-bearing and untested.
2. **Notification module.** The last empty directory with a real dependency:
   release, invoice and auction all have events that should notify. Schema,
   templates and seeded rows already exist.
3. **Refresh `README.md` and `docs/requirements-traceability.md`**, which
   describe a repository three sessions out of date.
4. **Decide the RLS question** before anything is deployed.

Do **not** start by rewriting architecture. Do not rebuild the charge engine.
Do not make the gate wait on the registry.
