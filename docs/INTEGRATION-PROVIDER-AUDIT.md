# YARDOS Integration Provider Audit

Audit date: 2026-09-12

Scope: existing provider architecture, configuration, startup behavior, health,
gate/enrichment workflow, persistence, auditability, deployment, and tests.
This document records the current repository state. It does not claim that a
camera vendor or VAHAN route has been integrated.

## Executive Summary

YARDOS already has provider boundaries for ANPR and vehicle registry data.
Development defaults are deliberately mock, while `NODE_ENV=production` rejects
mock ANPR, mock registry, mock payment, unsafe secrets, permissive CORS,
non-durable storage, and inline queues before the API starts. The current
startup warning is therefore a development signal; it is not the production
safety mechanism.

No actual camera-vendor protocol or authorised VAHAN/licensed-aggregator
contract is present in the repository. The available non-mock adapters are
integration boundaries, not verified live integrations.

| Integration | Current implementation | Production status | External dependency |
|---|---|---|---|
| ANPR | `MockAnprProvider` or `GenericWebhookAnprProvider` | Blocked until a real camera/gateway is selected, configured, and verified | Camera/gateway protocol, device inventory, HMAC credentials, network path, operational acceptance |
| Vehicle registry / VAHAN | `MockVehicleRegistryProvider` or provisional `AggregatorVehicleRegistryProvider` | Blocked until an authorised route and exact provider contract are approved and tested | Government authorisation or licensed aggregator, endpoint, schema, credentials, quota, legal/commercial approval |
| Payment | Manual records by default; mock gateway exists for development | Manual for Phase 1; real gateway not implemented | Payment-provider selection, contract, credentials, webhook and reconciliation requirements |

## Provider Inventory

| Provider | Interface | Current implementation | Configuration | Mock behavior | Production status | External dependency | Security implications |
|---|---|---|---|---|---|---|---|
| ANPR | `AnprProvider` in `apps/api/src/modules/anpr/anpr.provider.ts` | `MockAnprProvider`; `GenericWebhookAnprProvider` | `ANPR_PROVIDER`, confidence, clock-skew, dedupe, signature settings | Generates deterministic captures through `simulate()`, skips hardware signing, and identifies itself as `mock` | Boundary ready; live vendor integration not verified | Camera/gateway payload and signature contract, registered devices, per-device secrets | Device lookup, HMAC verification, timestamp freshness, confidence review, duplicate protection, image handling |
| Vehicle registry | `VehicleRegistryProvider` in `apps/api/src/modules/registry/vehicle-registry.provider.ts` | `MockVehicleRegistryProvider`; `AggregatorVehicleRegistryProvider` | `VEHICLE_REGISTRY_PROVIDER`, base URL, API key, timeout, retries, breaker, rate limit, cache TTL | Deterministic fictional owner/vehicle data with `source: MOCK` and `authoritative: false`; failures and not-found outcomes are simulated | Boundary and resilience path ready; live VAHAN/aggregator integration blocked | Authorised route, exact endpoint/auth/request/response schema, legal approval, quota and pricing | Owner and financier data is sensitive; response reduction, PII masking, tenant scoping, provenance, redaction and audit are required |
| Payment | `PaymentProvider` in `apps/api/src/modules/payment/payment.provider.ts` | Manual provider plus development mock gateway | `PAYMENT_PROVIDER` and payment secrets/callback settings | Simulates pending checkout and signed webhook paths; never represents an unsourced success | Manual is intentional Phase 1 behavior; real gateway absent | Chosen gateway, credentials, callback URL, reconciliation and settlement policy | Signature verification, idempotent event IDs, server-side invoice amount, no credentials in logs |

## ANPR Architecture

The domain depends on the abstract `AnprProvider`, not on a camera vendor. The
module factory in `apps/api/src/modules/anpr/anpr.module.ts` selects `mock` or
`generic-webhook` from configuration. `GenericWebhookAnprProvider` normalizes
common field spellings into `NormalizedAnprEvent`; it does not identify a real
vendor and its liberal mapping must be validated against the selected vendor's
actual specification.

The normalized contract currently includes provider event and device IDs,
capture time, raw plate text, confidence, direction, optional vehicle-class
hint, optional images, and a reduced raw payload. Ingestion then validates the
device, optional HMAC signature, timestamp freshness, event ID and physical
deduplication window before confidence review or gate processing. Low-confidence
captures go to review; they are not guessed into an admission.

The gate path is asynchronous with respect to registry enrichment:

```text
ANPR capture -> normalize/validate -> deduplicate -> gate admission
                                      |
                                      +-> registry enrichment job
```

`apps/api/src/modules/parking/gate.service.ts` keeps the external registry off
the barrier-critical path. Vehicle/session/timeline/outbox changes are
transactional, and registry work is queued after admission.

## Vehicle Registry Architecture

`VehicleRegistryProvider` returns a normalized `RegistryLookupResult` and
`VehicleRegistryRecord`, including only the fields currently used by the
vehicle and financier workflows. The provider exposes both `configured` and
`authoritative`, so a simulator cannot be treated as verified data.

The aggregator adapter has real transport concerns implemented: timeout,
HTTP status mapping, bounded retry-compatible errors, response normalization,
field absence as `null`, and redaction of full chassis/engine numbers and
identity/contact fields from the retained payload. However, its URL path,
header name, and defensive field mapping are explicitly provisional. It must
not be described as a VAHAN integration until the authorized provider and
schema are supplied.

`VehicleRegistryService` queues lookups, skips fresh records and duplicate
in-flight requests, applies rate limiting/circuit breaking, retries transient
failures with bounded attempts, records integration outcomes, and updates
vehicle ownership only through normalized data. A registry timeout or outage
does not block gate admission. The database lookup state remains the source of
truth for retry sweeps.

## Configuration and Startup

Configuration is centralized in
`apps/api/src/config/configuration.ts`; no second provider configuration
system was found.

| Area | Variables | Current rule |
|---|---|---|
| ANPR | `ANPR_PROVIDER=mock|generic-webhook`, confidence threshold, dedupe window, clock skew, signature requirement, mock interval | Mock is the local default; production rejects `mock`. The generic webhook still requires real device registration and secrets where signature enforcement is enabled. |
| Registry | `VEHICLE_REGISTRY_PROVIDER=mock|aggregator`, base URL, API key, timeout, attempts, breaker, rate limit, cache TTL | Mock is the local default; production rejects `mock`. Aggregator requires a non-empty base URL and API key, but those values alone do not prove authorization or schema compatibility. |
| Payment | `PAYMENT_PROVIDER=manual|mock` plus webhook/key/callback settings | Manual is the default. Production rejects the mock provider. |
| Runtime safety | `NODE_ENV`, secrets, CORS, storage driver, queue driver, logging | Production rejects template/shared secrets, wildcard or empty CORS, plaintext non-localhost origins, filesystem storage, inline queues, and pretty logging. |

`loadConfiguration()` throws when schema validation or
`productionSafetyChecks()` fails. `main.ts` catches the error, writes a
structured fatal message, and exits with status 1. The API therefore does not
listen with production mock ANPR or registry configuration. The post-listen
mock warning remains useful for development observability but is not relied on
for production enforcement.

The root `.env.example` contains placeholders only. It documents the local
mock setup and states that staging/production secrets must come from a secret
store. No production credentials were found in the audited files.

## Health and Readiness

`apps/api/src/infrastructure/health/health.controller.ts` exposes:

- `/health/live`: process liveness only.
- `/health/ready`: currently checks database connectivity only.
- `/health`: database, Redis, object storage, and outbox component detail.

Provider identity and provider readiness are logged at startup, but provider
readiness is not currently included in `/health/ready` or `/health`. This is a
known follow-up for the provider-readiness commit. Any future health response
must expose only provider name/status/configured state and never credentials,
tokens, raw payloads, or connection strings.

## Persistence, Provenance, and Privacy

The Prisma schema contains ANPR events, devices, vehicle ownership records,
registry lookup state, integration logs, outbox events, audit logs, and timeline
events. Audit and timeline tables are append-only through database triggers.

The registry path preserves provenance through provider/source fields and
`authoritative` behavior. Mock data is stored as `MOCK` and cannot set
`VAHAN_VERIFIED`; seeded data follows the same rule. The audit service redacts
before/after state snapshots and records organization, actor, site,
correlation, outcome, and error information. Tenant and financier scoping plus
owner-field masking are covered by integration tests.

The registry adapter deliberately retains only chassis/engine suffixes and
redacts full identity/contact values from the stored reduced payload. Raw
provider responses must not be added to logs or exposed through public health
endpoints.

## Queue, Retry, and Idempotency Findings

Registry enrichment uses `JobName.REGISTRY_ENRICHMENT` and BullMQ with bounded
attempts and exponential backoff. Database retry sweeps recover work if queue
enqueue fails. Job IDs, provider event IDs, a device/plate/direction dedupe
window, unique database indexes, and in-flight lookup checks provide duplicate
protection. The transactional outbox is at-least-once, so consumers must remain
idempotent.

The gate explicitly does not wait for registry lookup. Registry outcomes
include success, not found, unavailable, configuration failure, timeout,
authorization failure, rate limiting, and retryable upstream failure through
the provider error model. No fictional vehicle details are used to replace a
failure.

## Existing Test Strategy

The repository uses Jest with unit, integration, and E2E suites. Relevant
coverage includes:

- `apps/api/src/config/configuration.spec.ts`: production rejects mock ANPR,
  mock registry, mock payment, missing aggregator settings, unsafe secrets,
  and unsafe runtime defaults; development/test mock configuration remains
  allowed; secret values are absent from errors.
- `apps/api/test/e2e/recovery-lifecycle.e2e.spec.ts`: ANPR-to-gate flow,
  asynchronous registry behavior, mock provenance, and audit/timeline effects.
- `apps/api/test/integration/idempotency-and-concurrency.spec.ts`: duplicate
  camera frames, concurrent admissions, unique business constraints, and
  idempotency invariants.
- `apps/api/test/integration/tenant-isolation.spec.ts`: financier scoping and
  owner PII masking.
- `apps/api/test/setup/harness.ts`: deterministic simulator fixtures and seeded
  device/site resolution.

The audit found no real government API calls or production credentials in CI.
The remaining test gap is provider-readiness behavior in health endpoints and
more isolated contract tests for adapter timeout, malformed payload, not-found,
authorization, rate-limit, and retry outcomes.

## Deployment and CI

`docker/api.Dockerfile` sets `NODE_ENV=production`, runs as a non-root user,
injects secrets at runtime, and provides a liveness healthcheck. The local
`docker/docker-compose.yml` is explicitly development infrastructure. The CI
workflow runs API/web typechecks, API lint, unit tests, migrations, schema-drift
checks, integration tests, E2E tests, and the web build using throwaway
credentials and no external provider calls.

## Decisions and External Blockers

1. Preserve mock adapters for development, tests, CI, and local demos.
2. Keep production fail-closed for mock ANPR and registry providers.
3. Do not invent a camera protocol, VAHAN endpoint, credential, response
   schema, quota, price, or government authorization.
4. Before enabling `generic-webhook` in production, obtain the selected
   camera/gateway specification, device inventory, signature scheme, and
   acceptance test evidence.
5. Before enabling `aggregator` in production, obtain the authorized route,
   contract, exact request/response specification, credentials, legal approval,
   quota, pricing, and field-availability confirmation. Then replace only the
   provisional adapter mapping and run provider contract tests.

**Conclusion:** provider architecture and production mock rejection are
implemented. Live ANPR and VAHAN/registry integrations remain externally
blocked and must not be claimed complete until their real specifications,
credentials, and operational verification exist.