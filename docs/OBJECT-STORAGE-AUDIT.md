# YARDOS Object Storage Audit

Audit date: 2026-09-12
Commit audited: `281efb6`

Scope: existing object-storage architecture, configuration, MinIO setup,
health/readiness behavior, consumers, tests, and CI. This is an audit only;
no storage implementation was changed in this step.

## Executive Summary

YARDOS has a real S3-compatible storage adapter based on the AWS SDK v3. The
local development stack uses MinIO, while a filesystem adapter is available
for tests and local development. The API health endpoint performs a real
`HeadBucket` request rather than checking only a TCP port.

The current known failure is:

```text
/health -> object-storage: degraded, detail: UnknownError
```

Docker reports the MinIO container healthy. The audit found a separate
application/container boundary issue to reproduce in the next step:

- The host API is configured with `OBJECT_STORAGE_ENDPOINT=http://localhost:9000`.
- The Docker bucket initializer uses the internal endpoint `http://minio:9000`.
- The `minio-init` container has exited with code 1 on its latest run.
- Its logs show earlier successful bucket creation, followed by a Docker DNS
  failure resolving `minio`.
- The exact AWS SDK exception seen by the API has not yet been reduced beyond
  `UnknownError`; this must be reproduced in Step 2 before changing code.

No credentials are recorded in this document.

## Architecture

### Provider and module wiring

`apps/api/src/infrastructure/storage/storage.module.ts` globally binds the
abstract `ObjectStorageService` token to one of two implementations:

- `S3ObjectStorageService` when `OBJECT_STORAGE_DRIVER=s3`.
- `FilesystemObjectStorageService` otherwise.

The domain does not depend directly on AWS SDK or MinIO APIs. Consumers use the
storage abstraction for `put`, `get`, `delete`, `presignedUrl`, and
`healthCheck`.

### S3 adapter

`apps/api/src/infrastructure/storage/object-storage.ts` constructs an AWS SDK
v3 `S3Client` using:

- configured region
- optional configured endpoint
- configured `forcePathStyle` value
- configured access key and secret when both are present
- configured bucket for every operation

The S3 implementation currently supports:

| Operation | Implementation | Current behavior |
|---|---|---|
| PUT | `PutObjectCommand` | Generates a UUID-based key, sets content type and redacted metadata, returns size/checksum/key |
| GET | `GetObjectCommand` | Reads and buffers the object; maps failures to `DOCUMENT_NOT_AVAILABLE` |
| HEAD/readiness | `HeadBucketCommand` | Returns `{ healthy: true }` on success and a detail string on failure |
| DELETE | `DeleteObjectCommand` | Attempts deletion and logs failure without propagating it |
| Presigned download | `getSignedUrl` with `GetObjectCommand` | Uses configured expiry; URL is generated from the S3 client endpoint |

Object keys are generated internally from a UUID. Caller filenames contribute
only a sanitized extension, which prevents path traversal and key collision.

### Filesystem adapter

The filesystem implementation writes beneath a resolved local root, rejects
path traversal, and provides an authorization-checked API content path instead
of a true presigned URL. Production configuration rejects filesystem storage as
non-durable.

## Configuration

Configuration is centralized in
`apps/api/src/config/configuration.ts`. The relevant variables are:

| Variable | Current local value/status | Purpose |
|---|---|---|
| `OBJECT_STORAGE_DRIVER` | `s3` | Selects the MinIO/S3 adapter |
| `OBJECT_STORAGE_BUCKET` | `smartpark-dev` | Bucket used by the API and initializer |
| `OBJECT_STORAGE_REGION` | `us-east-1` | AWS SDK signing/region value |
| `OBJECT_STORAGE_ENDPOINT` | `http://localhost:9000` | Host API endpoint for local MinIO |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | `true` | Required for local MinIO and non-AWS S3 endpoints |
| `OBJECT_STORAGE_ACCESS_KEY` | configured, redacted | API S3 credentials |
| `OBJECT_STORAGE_SECRET_KEY` | configured, redacted | API S3 credentials |
| `OBJECT_STORAGE_URL_TTL_SECONDS` | `300` | Presigned download lifetime |
| `OBJECT_STORAGE_LOCAL_PATH` | configured path | Filesystem-driver root only |

The root `.env.example` contains placeholders and local development values
only. Production safety rejects filesystem storage in production. It does not
print or expose configured credentials in health responses.

## Docker and Bucket Initialization

`docker/docker-compose.yml` defines:

- MinIO on container port `9000`, published to the host through
  `MINIO_PORT` (default `9000`).
- MinIO console on container port `9001`.
- A persistent `minio-data` volume.
- A MinIO healthcheck using `mc ready local`.
- A one-shot `minio-init` service that waits for MinIO health, creates the
  configured bucket idempotently with `mc mb --ignore-existing`, and sets the
  bucket private.

The API and web applications run on the host in the documented local setup, so
`localhost:9000` is the expected host-side endpoint. A future fully
containerized API must use `http://minio:9000` instead; these endpoints must not
be conflated.

Observed initializer state during this audit:

- MinIO container: healthy.
- `minio-init`: exited with code 1.
- Logs: several successful `local/smartpark-dev` bucket creation attempts,
  followed by `dial tcp: lookup minio ... server misbehaving`.

This indicates initialization is not currently a clean deterministic run,
even though the bucket was reportedly created during earlier attempts. Step 2
must determine whether the API failure is caused by stale startup timing,
credential mismatch, endpoint reachability, bucket visibility, or another SDK
compatibility issue.

## Health and Readiness

`apps/api/src/infrastructure/health/health.controller.ts` exposes:

- `/health/live`: process liveness only; it does not touch storage.
- `/health/ready`: currently checks database connectivity only.
- `/health`: checks database, Redis, object storage, and outbox.

The detailed health endpoint calls `ObjectStorageService.healthCheck()`, which
for S3 performs `HeadBucket`. Therefore the degraded object-storage status is
based on a real bucket-level operation. The health detail currently returns the
raw SDK error message, which is not sufficient for operations and may need
sanitized error classification during the implementation step.

Object storage is not currently a `/health/ready` dependency. That preserves
gate availability during a storage outage but means readiness can be `ok` while
document storage is unavailable. Whether readiness should include storage must
be decided from actual application criticality after Step 2 reproduces the
failure; liveness must remain storage-independent.

Startup calls the same storage health check through `S3ObjectStorageService`
`onModuleInit`, but logs a warning and allows the API to boot when storage is
unavailable. This is intentional in the current architecture and is not yet a
production-readiness guarantee.

## Consumers and Current Workflow Coverage

The abstraction is intended for ANPR captures, vehicle photographs, invoice
PDFs, auction documents, release documents, and other documents. The current
repository contains the storage service and document-related schema/metadata,
but storage consumers are not uniformly exposed as complete end-to-end
workflows.

Verified current capabilities:

- Storage abstraction and both drivers exist.
- S3 put/get/delete/presigned methods exist.
- Document metadata and object-key concepts exist in the Prisma schema.
- ANPR and invoice domains reference document/storage concepts.
- Object key generation and filesystem traversal protection are implemented.

Not yet verified in this audit:

- A real API PUT into MinIO.
- A real API GET/HEAD round trip.
- A real API DELETE round trip.
- A browser-usable presigned URL.
- Every ANPR image, invoice PDF, or document workflow end to end.

These are Step 5/9/10 verification items and must not be claimed complete from
the existence of adapter methods alone.

## Tests and CI

The existing test suite covers storage indirectly through application modules,
but no dedicated deterministic S3/MinIO integration test was found for the
complete PUT, GET, HEAD, DELETE, presigned URL, missing-object, invalid
credential, and provider-unavailable matrix.

CI integration tests use filesystem storage and therefore do not verify MinIO
or S3 behavior. The local Docker Compose stack provides MinIO, but the CI
workflow does not currently provision a MinIO service for storage integration
tests.

This leaves a meaningful gap: a green CI run can coexist with a broken
application-level S3 configuration.

## Security Findings

Positive controls already present:

- Credentials come from environment configuration and are not hard-coded in
  the adapter.
- The example file contains placeholders/local development values only.
- The bucket initializer sets the bucket private.
- Object keys are UUID-based and do not expose the original filename beyond a
  sanitized extension.
- Presigned URLs have bounded expiration.
- Production rejects filesystem storage.

Items to verify or improve in later storage steps:

- Do not expose raw SDK details through public health endpoints.
- Confirm MinIO and API credentials are identical without logging them.
- Confirm the browser can reach the endpoint embedded in presigned URLs.
- Confirm object keys do not leak tenant or personal information.
- Confirm delete failure semantics are acceptable for document lifecycle and
  audit requirements.
- Add CI coverage using a fresh, private bucket rather than relying on local
  Docker state.

## Step 1 Findings and Required Next Step

The storage architecture is present and reasonably isolated. The immediate
failure is not proven to be an S3 code defect yet. The strongest verified lead
is an unreliable bucket-initializer run combined with an application-level
`HeadBucket` failure. The next step must reproduce `/health` while collecting
the underlying SDK error and must perform safe real operations using the
configured endpoint, credentials, and bucket.

No application code, Docker configuration, environment file, or test was
changed for this audit.