import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { ErrorCode } from '@smartpark/contracts';
import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { AppException } from '@/common/errors/app-exception';

export interface StoredObject {
  objectKey: string;
  sizeBytes: number;
  checksumSha256: string;
  contentType: string;
}

export interface PutObjectInput {
  /** Logical folder, e.g. `anpr/2025/09/08`. Never taken from user input. */
  prefix: string;
  fileName: string;
  contentType: string;
  body: Buffer;
  metadata?: Record<string, string>;
}

/**
 * Object storage abstraction.
 *
 * Binary content - ANPR captures, vehicle photographs, invoice PDFs, auction
 * documents - never goes into PostgreSQL (requirement S37). Only metadata does.
 *
 * Two drivers:
 *   s3         - any S3-compatible endpoint. MinIO locally, S3/equivalent in
 *                production. This is the real implementation.
 *   filesystem - a local directory. For tests and for a developer who does not
 *                want to run MinIO. Refused in production by the config guard.
 *
 * Object keys are always generated here from a UUID; a caller-supplied filename
 * only contributes a sanitised extension. That closes path traversal and key
 * collision in one move.
 */
export abstract class ObjectStorageService {
  abstract put(input: PutObjectInput): Promise<StoredObject>;
  abstract get(objectKey: string): Promise<Buffer>;
  abstract delete(objectKey: string): Promise<void>;
  /** Time-limited download URL handed to the browser. */
  abstract presignedUrl(objectKey: string, expiresInSeconds?: number): Promise<string>;
  abstract healthCheck(): Promise<{ healthy: boolean; detail?: string }>;

  /**
   * Builds a safe object key.
   *
   * The original filename is preserved only as a sanitised extension, so
   * `../../etc/passwd` and `report.pdf.exe` cannot become a key.
   */
  protected buildKey(prefix: string, fileName: string): string {
    const safePrefix = prefix
      .split('/')
      .map((segment) => segment.replace(/[^A-Za-z0-9_-]/g, ''))
      .filter((segment) => segment.length > 0)
      .join('/');

    const extension = path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    return `${safePrefix}/${randomUUID()}${extension}`;
  }

  protected checksum(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex');
  }
}

/* ------------------------------------------------------------------ */
/* S3-compatible driver                                                */
/* ------------------------------------------------------------------ */

@Injectable()
export class S3ObjectStorageService extends ObjectStorageService implements OnModuleInit {
  private readonly logger: ScopedLogger;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    logger: AppLogger,
  ) {
    super();
    this.logger = logger.forContext('S3ObjectStorage');
    this.bucket = config.storage.bucket;
    this.client = new S3Client({
      region: config.storage.region,
      ...(config.storage.endpoint ? { endpoint: config.storage.endpoint } : {}),
      forcePathStyle: config.storage.forcePathStyle,
      ...(config.storage.accessKey && config.storage.secretKey
        ? {
            credentials: {
              accessKeyId: config.storage.accessKey,
              secretAccessKey: config.storage.secretKey,
            },
          }
        : {}),
    });
  }

  async onModuleInit(): Promise<void> {
    const health = await this.healthCheck();
    if (!health.healthy) {
      // Not fatal: the API is useful without document upload, and failing to
      // boot would take down gate operations over a storage outage.
      this.logger.warn('Object storage is not reachable at startup', {
        bucket: this.bucket,
        detail: health.detail,
      });
    } else {
      this.logger.info('Object storage ready', { bucket: this.bucket });
    }
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const objectKey = this.buildKey(input.prefix, input.fileName);
    const checksumSha256 = this.checksum(input.body);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: {
            ...input.metadata,
            'original-filename': sanitiseMetadataValue(input.fileName),
            'sha256': checksumSha256,
          },
        }),
      );
    } catch (error) {
      throw new AppException(
        ErrorCode.OBJECT_STORAGE_UNAVAILABLE,
        'Could not store the file. Try again shortly.',
        { cause: error, details: { operation: 'put' } },
      );
    }

    return {
      objectKey,
      sizeBytes: input.body.length,
      checksumSha256,
      contentType: input.contentType,
    };
  }

  async get(objectKey: string): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) {
        throw new AppException(ErrorCode.DOCUMENT_NOT_AVAILABLE, 'The stored file is empty.');
      }
      return Buffer.from(bytes);
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        ErrorCode.DOCUMENT_NOT_AVAILABLE,
        'The requested file could not be retrieved.',
        { cause: error },
      );
    }
  }

  async delete(objectKey: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch (error) {
      this.logger.warn('Failed to delete object', {
        objectKey,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async presignedUrl(objectKey: string, expiresInSeconds?: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: expiresInSeconds ?? this.config.storage.urlTtlSeconds },
    );
  }

  async healthCheck(): Promise<{ healthy: boolean; detail?: string }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Filesystem driver (development and tests)                           */
/* ------------------------------------------------------------------ */

@Injectable()
export class FilesystemObjectStorageService extends ObjectStorageService {
  private readonly root: string;
  private readonly logger: ScopedLogger;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    logger: AppLogger,
  ) {
    super();
    this.root = path.resolve(config.storage.localPath);
    this.logger = logger.forContext('FilesystemObjectStorage');
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const objectKey = this.buildKey(input.prefix, input.fileName);
    const target = this.resolveSafe(objectKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.body);
    return {
      objectKey,
      sizeBytes: input.body.length,
      checksumSha256: this.checksum(input.body),
      contentType: input.contentType,
    };
  }

  async get(objectKey: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolveSafe(objectKey));
    } catch (error) {
      throw new AppException(
        ErrorCode.DOCUMENT_NOT_AVAILABLE,
        'The requested file could not be retrieved.',
        { cause: error },
      );
    }
  }

  async delete(objectKey: string): Promise<void> {
    await fs.rm(this.resolveSafe(objectKey), { force: true });
  }

  /**
   * The filesystem driver has no signing capability, so it returns an API path
   * that the document controller serves after re-checking authorisation. That
   * is strictly safer than a pre-signed URL, just less scalable.
   */
  async presignedUrl(objectKey: string): Promise<string> {
    return `/${this.config.apiPrefix}/v1/documents/content/${encodeURIComponent(objectKey)}`;
  }

  async healthCheck(): Promise<{ healthy: boolean; detail?: string }> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.access(this.root);
      return { healthy: true };
    } catch (error) {
      return { healthy: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Refuses any key that would escape the storage root. */
  private resolveSafe(objectKey: string): string {
    const resolved = path.resolve(this.root, objectKey);
    if (!resolved.startsWith(this.root + path.sep) && resolved !== this.root) {
      this.logger.error('Blocked path traversal attempt in object key', undefined, { objectKey });
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Invalid object key.');
    }
    return resolved;
  }
}

/** S3 object metadata must be ASCII and header-safe. */
function sanitiseMetadataValue(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '').slice(0, 200);
}
