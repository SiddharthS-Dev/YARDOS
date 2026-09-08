import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { APP_CONFIG, AppConfig } from '@/config/configuration';

/**
 * Application-level encryption for the few fields that must be recoverable but
 * must not sit in the database as plaintext.
 *
 * Used for: notification recipient addresses (a phone number or email is
 * personal data, and the notifications table is one of the largest and most
 * widely read), and TOTP secrets.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt rather
 * than yielding attacker-chosen plaintext.
 *
 * Format: v1:<base64 iv>:<base64 authTag>:<base64 ciphertext>
 * The version prefix exists so the key can be rotated and old values can still
 * be read by a future multi-key decryptor.
 *
 * This complements, and does not replace, encryption at rest on the storage
 * volume (see docs/security.md).
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;
  private static readonly VERSION = 'v1';
  private static readonly IV_LENGTH = 12; // 96-bit nonce, the GCM standard.

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(config.encryptionKey, 'base64');
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to 32 bytes for AES-256-GCM.');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(EncryptionService.IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      EncryptionService.VERSION,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /**
   * @throws Error when the value is malformed or has been tampered with.
   *         Callers that can tolerate a bad row should use `tryDecrypt`.
   */
  decrypt(encoded: string): string {
    const parts = encoded.split(':');
    if (parts.length !== 4 || parts[0] !== EncryptionService.VERSION) {
      throw new Error('Unrecognised ciphertext format.');
    }
    const iv = Buffer.from(parts[1] as string, 'base64');
    const authTag = Buffer.from(parts[2] as string, 'base64');
    const ciphertext = Buffer.from(parts[3] as string, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** Returns null instead of throwing. Used when rendering lists. */
  tryDecrypt(encoded: string | null | undefined): string | null {
    if (!encoded) return null;
    try {
      return this.decrypt(encoded);
    } catch {
      return null;
    }
  }
}
