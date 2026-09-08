# Requirements Traceability Matrix

Maps every requirement from the source one-pager (and the numbered sections of
the development brief, cited as **S*n***) to the code that implements it.

**This document is deliberately honest about what is not built.** A traceability
matrix that reports everything green is worthless. Status values mean:

| Status | Meaning |
|---|---|
| **Complete** | Domain logic + persistence + API + validation + authorisation + error handling + audit + tests |
| **Backend complete** | All of the above except the console screen |
| **Foundation** | Schema, constraints and seed data exist and are exercised; the service/API layer is not yet written |
| **Not started** | — |

Verification evidence is in [`validation-log.md`](./validation-log.md).

---

## 1. Summary

| Area | Status |
|---|---|
| Database, constraints, immutability guarantees | Complete |
| Identity, RBAC, financier isolation | Backend complete |
| ANPR capture and gate workflow | Backend complete |
| Vehicle repository, lifecycle, timeline | Backend complete |
| Vehicle registry (VAHAN) integration boundary | Backend complete |
| Financier matching | Backend complete |
| Contracts, rate resolution, rate snapshots | Backend complete |
| Charge engine and accrual | Backend complete |
| Billing-party rule engine | Backend complete (not yet wired to invoice generation) |
| Parking session operations | Backend complete |
| Release workflow | Foundation |
| Invoicing and payment | Foundation |
| Auction and settlement | Foundation |
| Notifications | Foundation |
| Documents | Foundation |
| Reporting | Foundation |
| Operations console (web) | Not started |
| CI/CD and container deployment | Not started |

---

## 2. Detailed matrix

### Platform foundations

| Requirement | Module | Domain | DB | API | UI | Test | Status |
|---|---|---|---|---|---|---|---|
| S4 Modular monolith, extractable modules | `app.module.ts`, per-module boundaries | Yes | — | — | — | — | Complete |
| S5 Node/TypeScript/NestJS/PostgreSQL stack | monorepo | Yes | Yes | Yes | — | Yes | Complete |
| S26 Normalised relational model (60 tables) | `prisma/schema.prisma` | Yes | Yes | — | — | Yes | Complete |
| S26 Constraints, referential integrity | migration `01_integrity_guards` (58 CHECKs) | Yes | Yes | — | — | Yes | Complete |
| S26 Index strategy incl. trigram search | same migration (5 GIN, 11 partial-unique) | Yes | Yes | — | — | Yes | Complete |
| S27 Audit trail, tamper-evident | `AuditService` + DB triggers | Yes | Yes | Partial | No | Yes | Backend complete |
| S34 Consistent error model | `GlobalExceptionFilter`, `ErrorCode` | Yes | — | Yes | — | Yes | Complete |
| S38 Structured logging + correlation IDs | `AppLogger`, `CorrelationMiddleware` | Yes | — | Yes | — | — | Complete |
| S38 Health / readiness / component health | `HealthController` | Yes | — | Yes | — | Yes | Complete |
| S39 Background jobs, idempotent, observable | `JobsService`, `job_runs` | Yes | Yes | — | — | — | Backend complete |
| S40 Concurrency: locks, partial-unique, versions | `PrismaService`, migration | Yes | Yes | — | — | Yes | Complete |
| S41 Business configuration outside code | `system_settings`, contract/rate tables | Yes | Yes | Partial | No | — | Backend complete |
| S55 Transactional consistency | `PrismaService.transaction`, outbox | Yes | Yes | — | — | Yes | Complete |
| S56 Idempotency | ANPR dedupe, `idempotency_records`, outbox | Yes | Yes | Yes | — | Yes | Complete |
| S5 Transactional outbox / event bus | `OutboxService` | Yes | Yes | — | — | — | Complete |

### Identity and access

| Requirement | Module | Domain | DB | API | UI | Test | Status |
|---|---|---|---|---|---|---|---|
| S28 RBAC, server-side enforcement | `PermissionsGuard`, 90-permission catalogue | Yes | Yes | Yes | No | Yes | Backend complete |
| S28 Roles: management, yard, finance, auction, admin, financier | `DEFAULT_ROLE_PERMISSIONS` | Yes | Yes | Yes | No | Yes | Backend complete |
| S35 Password hashing | `PasswordHasher` (scrypt, zero native deps) | Yes | Yes | Yes | No | — | Complete |
| S35 JWT + refresh rotation, theft detection | `AuthService` (token families) | Yes | Yes | Yes | No | Yes | Complete |
| S35 Account lockout, attempt log | `AuthService`, `login_attempts` | Yes | Yes | Yes | No | — | Complete |
| S35 MFA-ready | `users.mfaEnabled`, `mfaSecretEncrypted` | Partial | Yes | No | No | — | Foundation |
| S35 Rate limiting | `ThrottlerModule` (default/login/anpr tiers) | Yes | — | Yes | — | Yes | Complete |
| S35 Secure headers, CORS, body limits | `main.ts` (helmet, strict CSP) | Yes | — | Yes | — | Yes | Complete |
| S36 Object-level authorisation, site scope | `AccessScope` | Yes | Yes | Yes | No | Yes | Backend complete |
| S36 Financier tenant isolation | mandatory `financierId` predicates | Yes | Yes | Yes | No | Yes | Backend complete |
| S36 PII masking by permission | `maskName`, `vehicle:pii:read` | Yes | — | Yes | No | Yes | Backend complete |

### Sites and topology

| Requirement | Module | Domain | DB | API | UI | Test | Status |
|---|---|---|---|---|---|---|---|
| S6 Organisation → site → gate → lane → zone → bay | schema + seed | Yes | Yes | Read only | No | Yes | Backend complete |
| S6 Multi-site, no hardcoded yard | every record carries `siteId` | Yes | Yes | Yes | No | Yes | Complete |
| S6 Site-specific rates and config | `RatePlan.siteId`, `system_settings` | Yes | Yes | Partial | No | Yes | Backend complete |
| S42 Site/gate/zone admin screens | — | — | Yes | **No** | **No** | — | **Foundation** |

### Vehicle and capture

| Requirement | Module | Domain | DB | API | UI | Test | Status |
|---|---|---|---|---|---|---|---|
| S7 Central canonical vehicle record | `VehicleService` | Yes | Yes | Yes | No | Yes | Backend complete |
| S8 Vehicle lifecycle state machine | `VehicleStateMachine` | Yes | Yes | Yes | No | Yes | Complete |
| S8 No arbitrary status writes from UI | only `VehicleService.transition` writes status | Yes | Yes | Yes | — | Yes | Complete |
| S9 Full gate entry workflow | `GateService.handleEntry` | Yes | Yes | Yes | No | Yes | Backend complete |
| S9 Gate never blocks on external API | enrichment queued post-commit | Yes | Yes | Yes | — | Yes | Complete |
| S10 `ANPRProvider` abstraction | `AnprProvider` + 2 adapters | Yes | Yes | Yes | No | Yes | Complete |
| S10 Duplicate protection, idempotency | `providerEventId` + windowed `dedupeKey` | Yes | Yes | Yes | — | Yes | Complete |
| S10 Signature verification, replay window | HMAC + clock-skew check | Yes | Yes | Yes | — | — | Complete |
| S10 Device health | `anpr_devices`, `appearsStale` | Yes | Yes | Yes | No | — | Backend complete |
| S10 Mock ANPR provider | `MockAnprProvider` | Yes | — | Yes | No | Yes | Complete |
| S30 Low-confidence manual review, audited | review queue + `resolveReview` | Yes | Yes | Yes | No | — | Backend complete |
| S25 Immutable location/event timeline | `vehicle_timeline_events` + trigger | Yes | Yes | Yes | No | Yes | Backend complete |
| S31 Registration-number normalisation | `normalizeRegistrationNumber` (shared) | Yes | Yes | Yes | No | Yes | Complete |
| S31 Global search | trigram indexes + `/vehicles/search` | Yes | Yes | Partial | No | — | Backend complete |

### Vehicle registry (VAHAN)

| Requirement | Module | Domain | DB | API | UI | Test | Status |
|---|---|---|---|---|---|---|---|
| S11 `VehicleRegistrationProvider` abstraction | `VehicleRegistryProvider` | Yes | Yes | Yes | No | Yes | Complete |
| S11 Timeout, retry, circuit breaker, rate limit | `VehicleRegistryService` | Yes | Yes | Yes | No | — | Complete |
| S11 Caching to control per-call cost | freshness window | Yes | Yes | — | — | — | Complete |
| S11 Audit logging of every call | `integration_logs` | Yes | Yes | — | No | — | Complete |
| S11 Manual retry and manual verification | `retryLookup`, `recordManualVerification` | Yes | Yes | Yes | No | — | Backend complete |
| S11 Never fake a production government API | mock is non-authoritative + boot guard | Yes | Yes | Yes | — | Yes | Complete |
| S24 Ownership retained centrally, searchable | `vehicle_ownership_records` | Yes | Yes | Yes | No | Yes | Backend complete |

### Financier, contract and rating

| Requirement | Module | Domain | DB | API | UI | Test | Status |
|---|---|---|---|---|---|---|---|
| S12 Financier master, aliases, contacts | schema + `FinancierMatcherService` | Yes | Yes | **No** | **No** | Yes | Backend partial |
| S12 Match captured vehicle to financier | `FinancierMatcherService` (3-stage) | Yes | Yes | Yes | No | Yes | Complete |
| S13 Contract engine, versions, effective dates | `contracts` / `contract_versions` | Yes | Yes | **No** | **No** | Yes | Foundation |
| S13 No hardcoded rates | `RatePlan` + `RateSlab` rows | Yes | Yes | — | No | Yes | Complete |
| S13 Rate resolution with precedence | `RateResolutionService` | Yes | Yes | Yes | No | Yes | Backend complete |
| S14 Charge engine: deterministic, explainable | `ChargeEngine` | Yes | Yes | Yes | No | Yes (41) | Complete |
| S14 Automatic day-by-day accrual | `ChargeService.runAccrual` + cron | Yes | Yes | Yes | No | — | Backend complete |
| S14 Store the workings, not just a total | `charge_calculations` + `charge_lines` | Yes | Yes | Yes | No | Yes | Complete |
| S14 Version-aware / reproducible | rate-plan snapshot + `inputsHash` | Yes | Yes | Yes | — | Yes | Complete |
| S15 `BillingPartyResolver`, configurable | `BillingRuleEvaluator` | Yes | Yes | **No** | **No** | Yes (22) | Backend partial |
| S21 Public parking tariffs (Phase 2) | `RatePlan` scope `SITE_TARIFF` | Yes | Yes | Yes | No | Yes | Backend complete |

### Operations, billing, disposal

| Requirement | Module | Domain | DB | API | UI | Test | Status |
|---|---|---|---|---|---|---|---|
| S20 One generalised `ParkingSession` for both lines | `parking_sessions` + `parkingMode` | Yes | Yes | Yes | No | Yes | Complete |
| S20 Phase 2 supported without rewrite | same session/rate models | Yes | Yes | Yes | No | Yes | Complete |
| Session list / detail / hold / re-rate | `ParkingSessionService` | Yes | Yes | Yes | No | — | Backend complete |
| S17 Vehicle release workflow | schema + `closeSession`; **no release service** | Partial | Yes | **No** | **No** | — | **Foundation** |
| S17 Exit blocked without approved release | `GateService.handleExit` | Yes | Yes | Yes | No | — | Backend complete |
| S16 Invoice lifecycle | schema, state machine, seed; **no service** | Partial | Yes | **No** | **No** | Yes | **Foundation** |
| S16 Invoice PDF | — | **No** | Yes | **No** | **No** | — | **Not started** |
| S22 `PaymentProvider` abstraction | schema + webhook idempotency table | Partial | Yes | **No** | **No** | — | **Foundation** |
| S18 Auction, lots, bidders, bids, settlement | schema + seed; **no service** | Partial | Yes | **No** | **No** | Yes | **Foundation** |
| S19 Immutable bid history | DB trigger + `bid_events` | Yes | Yes | — | No | Yes | Complete |
| S19 Auction role separation | permission catalogue | Yes | Yes | — | No | Yes | Complete |
| S23 Notification providers (SMS/email/WhatsApp) | schema + templates; **no service** | **No** | Yes | **No** | **No** | — | **Foundation** |
| S37 Document management, object storage | `ObjectStorageService` (S3 + filesystem) | Yes | Yes | **No** | **No** | — | Backend partial |
| S32 Reporting dashboards | — | **No** | Yes | **No** | **No** | — | **Not started** |
| S24 Financier intelligence portal | financier-scoped vehicle search | Partial | Yes | Partial | **No** | Yes | Backend partial |

### Delivery

| Requirement | Status | Note |
|---|---|---|
| S29/S30 Operations console (all screens) | **Not started** | No web application has been built |
| S33 OpenAPI specification | Backend complete | Served at `/api/docs`; covers implemented endpoints only |
| S44 Unit tests | Complete | 117 passing; 90%+ on the money paths |
| S44 Integration tests | **Not started** | Jest project + global setup scaffolded |
| S44 End-to-end tests | **Not started** | Verified manually instead — see `validation-log.md` |
| S45 Seed / demo data | Complete | 5 sites, 6 financiers, 60 vehicles, 42 open stays, 14 invoices, 28 bids |
| S46 Local development stack | Complete | `docker-compose` for Postgres/Redis/MinIO; documented commands |
| S47 Production deployment | **Not started** | No Dockerfile for the app itself |
| S48 CI/CD pipeline | **Not started** | — |
| S50 Architecture documentation | Partial | This file, `open-items.md`, `assumptions.md`, `validation-log.md`, README |
| S60 Traceability matrix | Complete | This file |
| S61 Open items register | Complete | `open-items.md` |

---

## 3. What is genuinely missing

Stated plainly, so nobody has to infer it from the table:

1. **The web console does not exist.** No screen has been built. Every backend
   capability above is exercised over HTTP, and the OpenAPI spec is live, but
   there is no UI.
2. **Five domains are schema-and-seed only** — release, invoice, payment,
   auction and notification. Their tables, constraints, state machines and
   immutability triggers are complete and tested, and the seed populates
   realistic data through them, but the *service and controller layers* are not
   written. The `BillingRuleEvaluator` and `ChargeEngine` they depend on are
   finished and tested.
3. **Reporting has no implementation** beyond the underlying indexes.
4. **No integration or E2E test suites.** The workflows were verified by hand
   against the running system; that evidence is recorded, but it is not
   automated and will not catch a regression.
5. **No application Dockerfile and no CI pipeline.**

The proportion is roughly: platform foundations, security, capture, vehicle,
rating and charging are production-shaped and tested; the downstream financial
and disposal workflows have their data model and business rules in place but
need their service layer and UI.
