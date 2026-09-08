import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { APP_CONFIG, AppConfig } from '@/config/configuration';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * Algorithm: scrypt, from Node's built-in crypto.
 *
 * Why scrypt rather than Argon2id or bcrypt: it is a memory-hard KDF that
 * OWASP accepts as an Argon2id alternative, and it ships with the runtime. Both
 * Argon2 and bcrypt require a native addon, which means a compiler on every
 * build agent and a supply-chain dependency on a binary artefact - for a
 * platform holding vehicle-ownership and financier data, "no native crypto
 * dependency" is worth more than the marginal advantage of Argon2id here.
 *
 * The stored format carries its own parameters:
 *
 *     scrypt$N$r$p$<base64 salt>$<base64 hash>
 *
 * so the work factor can be raised later and existing hashes are transparently
 * upgraded on the owner's next successful login (`needsRehash`). The `algorithm`
 * column on `users` records which scheme produced the hash, leaving the door
 * open to swapping in Argon2id without a forced password reset.
 */
@Injectable()
export class PasswordHasher {
  private readonly N: number;
  private readonly r: number;
  private readonly p: number;
  private readonly keyLength = 64;
  private readonly saltLength = 16;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.N = 2 ** config.auth.scrypt.logN;
    this.r = config.auth.scrypt.r;
    this.p = config.auth.scrypt.p;
  }

  get algorithm(): string {
    return 'scrypt';
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(this.saltLength);
    const derived = await scrypt(password, salt, this.keyLength, {
      N: this.N,
      r: this.r,
      p: this.p,
      maxmem: this.maxmem(this.N, this.r),
    });
    return [
      'scrypt',
      this.N,
      this.r,
      this.p,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  /**
   * Verifies a password against a stored hash.
   *
   * Returns false rather than throwing on a malformed stored value: a corrupt
   * row must read as "wrong password", not as a 500 that tells an attacker the
   * account exists.
   */
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = this.parse(stored);
    if (!parsed) return false;

    try {
      const derived = await scrypt(password, parsed.salt, parsed.hash.length, {
        N: parsed.N,
        r: parsed.r,
        p: parsed.p,
        maxmem: this.maxmem(parsed.N, parsed.r),
      });
      if (derived.length !== parsed.hash.length) return false;
      return timingSafeEqual(derived, parsed.hash);
    } catch {
      return false;
    }
  }

  /**
   * True when the stored hash used weaker parameters than the current policy,
   * so it should be re-hashed after a successful login.
   */
  needsRehash(stored: string): boolean {
    const parsed = this.parse(stored);
    if (!parsed) return true;
    return parsed.N < this.N || parsed.r < this.r || parsed.p < this.p;
  }

  /**
   * Password policy.
   *
   * ASSUMPTION / PROPOSED DESIGN: length plus character-class variety, with a
   * block-list of obvious values. Sri JP has not supplied a password standard;
   * these defaults follow NIST SP 800-63B (length over rotation) and the
   * minimum length is configurable via AUTH_PASSWORD_MIN_LENGTH.
   */
  validatePolicy(password: string, context: { email?: string; fullName?: string } = {}): string[] {
    const problems: string[] = [];
    const min = this.config.auth.passwordMinLength;

    if (password.length < min) {
      problems.push(`Password must be at least ${min} characters long.`);
    }
    if (password.length > 256) {
      problems.push('Password must be at most 256 characters long.');
    }
    if (!/[a-z]/.test(password)) problems.push('Password must contain a lowercase letter.');
    if (!/[A-Z]/.test(password)) problems.push('Password must contain an uppercase letter.');
    if (!/[0-9]/.test(password)) problems.push('Password must contain a digit.');
    if (!/[^A-Za-z0-9]/.test(password)) {
      problems.push('Password must contain a symbol.');
    }

    const lower = password.toLowerCase();
    if (COMMON_PASSWORDS.has(lower)) {
      problems.push('That password is too common. Choose something less predictable.');
    }
    if (/^(.)\1+$/.test(password)) {
      problems.push('Password must not be a single repeated character.');
    }

    // A password containing the account identity is trivially guessable.
    const localPart = context.email?.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
      problems.push('Password must not contain your email address.');
    }
    if (context.fullName) {
      for (const part of context.fullName.toLowerCase().split(/\s+/)) {
        if (part.length >= 4 && lower.includes(part)) {
          problems.push('Password must not contain your name.');
          break;
        }
      }
    }

    return problems;
  }

  private parse(
    stored: string,
  ): { N: number; r: number; p: number; salt: Buffer; hash: Buffer } | null {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return null;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
    // Guard against a hostile stored value forcing an enormous allocation.
    if (N < 1024 || N > 2 ** 22 || r < 1 || r > 64 || p < 1 || p > 32) return null;

    try {
      return {
        N,
        r,
        p,
        salt: Buffer.from(parts[4] as string, 'base64'),
        hash: Buffer.from(parts[5] as string, 'base64'),
      };
    } catch {
      return null;
    }
  }

  /** scrypt needs roughly 128 * N * r bytes; add headroom. */
  private maxmem(N: number, r: number): number {
    return 256 * N * r;
  }
}

/**
 * A deliberately short block-list of values that appear at the top of every
 * breach corpus. A full breach-corpus check (Have I Been Pwned k-anonymity)
 * is the right production answer and is noted in docs/security.md.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'password@123',
  'qwerty123',
  'welcome123',
  'admin@123',
  'admin123',
  '12345678',
  '123456789',
  '1234567890',
  'letmein123',
  'changeme123',
  'iloveyou123',
  'smartpark123',
  'srijp@123',
]);
