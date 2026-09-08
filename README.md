# SmartPark Enterprise

Vehicle yard, parking, billing, auction and financier-intelligence platform for
**Sri JP Smartpark India Pvt Ltd**.

Financing companies park repossessed vehicles in Sri JP's yards. This platform
is the operational system for that business: it recognises a vehicle at the
gate, works out whose it is, prices the stay against the right contract, accrues
charges daily, controls release, and disposes of long-stay vehicles by auction —
with an audit trail behind every step.

It is built so the Phase 2 public-parking business (airport, metro, railway)
runs on the same session model, rating engine and reporting, rather than a
parallel implementation.

---

## Status

**This is a partial implementation.** The platform foundations, security model,
capture pipeline, vehicle repository, rating and charging are production-shaped
and tested. The downstream financial and disposal workflows have their complete
data model, business rules and constraints in place, but their service layer is
not yet written, and **no web console has been built**.

Read [`docs/requirements-traceability.md`](docs/requirements-traceability.md)
for a requirement-by-requirement account, and
[`docs/validation-log.md`](docs/validation-log.md) for evidence of what was
actually run.

| | |
|---|---|
| ✅ Working and verified | Database + integrity guarantees, auth/RBAC/tenant isolation, ANPR ingestion, gate entry & exit, vehicle repository & timeline, VAHAN integration boundary, financier matching, contracts & rate resolution, charge engine & accrual, billing-rule engine, parking operations, background jobs, health & observability |
| 🟨 Schema, rules and seed only | Release, invoicing, payment, auction, notifications, documents |
| ❌ Not started | Web console, reporting endpoints, integration/E2E suites, app Dockerfile, CI pipeline |

117 unit tests pass, with 90%+ coverage on the money paths.

---

## Quick start

**Prerequisites:** Node 20.11+ (24 tested), Docker Desktop running.

```bash
git clone <repo> && cd yardos
npm install

cp .env.example .env
# Generate real development secrets (the template values are rejected in production):
node -e "const c=require('crypto');const fs=require('fs');let s=fs.readFileSync('.env','utf8');
s=s.replace(/^JWT_ACCESS_SECRET=.*$/m,'JWT_ACCESS_SECRET='+c.randomBytes(48).toString('base64url'));
s=s.replace(/^JWT_REFRESH_SECRET=.*$/m,'JWT_REFRESH_SECRET='+c.randomBytes(48).toString('base64url'));
s=s.replace(/^ENCRYPTION_KEY=.*$/m,'ENCRYPTION_KEY='+c.randomBytes(32).toString('base64'));
fs.writeFileSync('.env',s);console.log('secrets generated')"

npm run stack:up        # PostgreSQL, Redis, MinIO
npm run db:deploy       # apply migrations
npm run db:seed         # fictional demo estate
npm run dev:api         # http://localhost:3000
```

Then:

- API docs — <http://localhost:3000/api/docs>
- Health — <http://localhost:3000/health>

### Port note

The compose stack publishes PostgreSQL on **5442**, not 5432 or 5433. During
development a pre-existing PostgreSQL was found on 5433, which silently
intercepted connections. Override with `POSTGRES_PORT` (and update
`DATABASE_URL` to match) if 5442 is taken on your machine.

---

## Demo logins

All seeded passwords are `ChangeMe!Demo2025` except the administrator
(`ChangeMe!Admin2025`).

| Role | Email | What it demonstrates |
|---|---|---|
| System administrator | `admin@srijpsmartpark.example` | Everything |
| Management | `management@srijpsmartpark.example` | Cross-site visibility; can approve a release but cannot issue an invoice |
| Yard staff (Chennai) | `yard.chennai@srijpsmartpark.example` | **Site scoping** — sees only the Chennai yard |
| Yard staff (Coimbatore) | `yard.coimbatore@srijpsmartpark.example` | The other site |
| Finance | `finance@srijpsmartpark.example` | Contracts, rates, billing; sees owner names unmasked |
| Auctions | `auctions@srijpsmartpark.example` | Auctions; deliberately cannot raise the sale invoice |
| Financier portal A | `portal@nvf.example` | **Tenant isolation** — only Northbridge's vehicles, owner names masked |
| Financier portal B | `portal@scf.example` | Only Sundara's vehicles |

Sign in as portal A and portal B in turn: each sees a different, non-overlapping
set of vehicles, and requesting the other's vehicle by id returns 404.

---

## Try the gate

```bash
API=http://localhost:3000/api/v1
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"yard.chennai@srijpsmartpark.example","password":"ChangeMe!Demo2025"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).accessToken")

# A vehicle arrives
curl -s -X POST $API/anpr/simulate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"deviceCode":"YRD-CHN-01-CAM-IN","plateNumber":"TN 09 QQ 7788","confidence":0.98}'
```

The response explains what the system decided and why. A few seconds later the
vehicle has been enriched asynchronously and matched to a financier — the gate
did not wait for it.

Send the same capture twice: the second is recognised as a duplicate rather than
opening a second stay. Send one with `"confidence": 0.4`: it goes to the manual
review queue instead of admitting a guess.

---

## Commands

| | |
|---|---|
| `npm run dev:api` | API with reload |
| `npm run build` | Build contracts, API and web |
| `npm run typecheck` | Typecheck every workspace |
| `npm test` | Unit tests |
| `npm run test:cov` | With coverage |
| `npm run db:migrate` | Create + apply a migration |
| `npm run db:reset` | Drop, re-migrate, re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run stack:up` / `stack:down` / `stack:reset` | Docker infrastructure |

---

## Architecture in brief

A **modular monolith**. Business modules have hard boundaries and communicate
through a transactional outbox rather than calling into each other, so any one
of them can be lifted into its own service later without rewriting the rest.

```
apps/api            NestJS · modular monolith
  config/           Environment, validated at boot; refuses unsafe production config
  common/           Errors, request context, logging + redaction, money, DTOs
  infrastructure/   Prisma · Redis · crypto · object storage · queue · outbox
  modules/
    identity/       Auth, RBAC, guards, users
    vehicle/        Central vehicle repository + lifecycle
    anpr/           Capture ingestion, dedupe, review queue
    registry/       VAHAN / aggregator boundary
    financier/      Financier matching
    contract/       Rate resolution
    billing/        Charge engine (pure) + charge service
    parking/        Gate workflow, sessions
    audit/          Append-only trail
    jobs/           Accrual, retries, sweeps
apps/web            Operations console — NOT YET BUILT
packages/contracts  Enums, state machines, permissions, error codes — shared
```

`packages/contracts` is what stops the two halves of the platform drifting: the
state machines the API enforces are the same ones the console will use to decide
which actions to offer.

### Decisions worth knowing before reading the code

**The gate never blocks.** Everything on the synchronous admission path is local
database work. The vehicle registry is queued. A vehicle with no resolvable rate
is still admitted, flagged, and surfaced in a finance work queue — a vehicle
stuck at a barrier is worse than a stay that needs its rate attached later.

**Money is never a JavaScript number.** `NUMERIC(18,4)` in PostgreSQL,
`decimal.js` in the engine, decimal strings on the wire.

**Rate plans are snapshotted at admission.** Renegotiating a contract must not
silently re-price vehicles already in the yard.

**Charges store their workings.** Every line records its ladder positions, units
and rate, plus a human-readable narrative and a hash of the inputs — so an
invoice can be defended to a financier years later.

**The database enforces what code cannot.** Partial unique indexes prevent a
second live session per vehicle. Triggers make bids immutable, freeze issued
invoices, and reject `UPDATE`/`DELETE` on the audit trail outright.

**Mocks cannot reach production.** `productionSafetyChecks()` refuses to boot
with a mock provider, a template secret, a development database password,
wildcard CORS, or unstructured logs.

---

## A note on the data

Everything the seed creates is **fictional**. The six financiers are invented
names, not real institutions. Owners and addresses are invented.

**Every rate, tax rate, fee and threshold is a placeholder** and says so in its
own description field. None of it is a Sri JP commercial term — those are
unresolved business decisions, catalogued in
[`docs/open-items.md`](docs/open-items.md).

Ownership data comes from a **simulator**, which declares itself
non-authoritative. Such records are stored as `UNAVAILABLE`, never `VERIFIED`,
so simulated data can never present as registry-verified anywhere in the
platform.

---

## Documentation

| | |
|---|---|
| [`docs/open-items.md`](docs/open-items.md) | The 9 unresolved business decisions, and how each is held as configuration |
| [`docs/assumptions.md`](docs/assumptions.md) | Every decision made by the team rather than supplied by Sri JP |
| [`docs/requirements-traceability.md`](docs/requirements-traceability.md) | Requirement-by-requirement status |
| [`docs/validation-log.md`](docs/validation-log.md) | What was executed, what it returned, and the defects it caught |
