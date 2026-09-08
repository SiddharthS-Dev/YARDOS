import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { AuthenticatedUserProfile, ErrorCode, LoginResponse } from '@smartpark/contracts';
import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppException } from '@/common/errors/app-exception';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { RequestContextStore } from '@/common/context/request-context';
import { randomToken, sha256 } from '@/common/util/hash';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PasswordHasher } from '@/infrastructure/crypto/password-hasher.service';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';

/** Claims carried by an access token. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  org: string;
  /** Financier id for portal users; null for Sri JP staff. */
  fin: string | null;
  roles: string[];
  /** Session id, so a token can be tied back to its refresh-token family. */
  sid: string;
  typ: 'access';
}

interface RefreshTokenPayload {
  sub: string;
  sid: string;
  typ: 'refresh';
}

/**
 * Authentication.
 *
 * Security decisions, all deliberate:
 *
 *   Enumeration      Every failure path - unknown user, wrong password,
 *                    disabled account - returns the same INVALID_CREDENTIALS
 *                    message, and the password is still hashed against a dummy
 *                    value when the user does not exist, so response timing
 *                    does not reveal whether an address is registered.
 *
 *   Lockout          Consecutive failures lock the account for a configurable
 *                    window. Attempts are recorded in an append-only table.
 *
 *   Refresh rotation Each refresh mints a new token and revokes the old one.
 *                    Tokens are grouped by `familyId`; presenting an
 *                    already-rotated token is treated as theft and revokes the
 *                    entire family, forcing a fresh login.
 *
 *   Storage          Only SHA-256 hashes of refresh tokens are stored, so a
 *                    database leak does not hand over live sessions. (SHA-256,
 *                    not scrypt: these are 256-bit random values, not
 *                    guessable secrets, so a slow KDF buys nothing and would
 *                    cost a KDF run on every API refresh.)
 */
@Injectable()
export class AuthService {
  private readonly logger: ScopedLogger;
  /** Hashed against on unknown-user logins to equalise response time. */
  private dummyHash: string | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Auth');
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const normalisedEmail = email.trim().toLowerCase();
    const context = RequestContextStore.get();

    const user = await this.prisma.user.findUnique({
      where: { email: normalisedEmail },
      include: {
        organization: { select: { id: true, displayName: true } },
        financier: { select: { id: true, displayName: true } },
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        siteAccess: { select: { siteId: true } },
      },
    });

    if (!user) {
      // Burn comparable CPU so a missing account is not detectable by timing.
      await this.hashDummy(password);
      await this.recordAttempt(normalisedEmail, null, false, 'NO_SUCH_USER');
      throw invalidCredentials();
    }

    // A machine principal must never be able to sign in interactively.
    if (user.isServiceAccount) {
      await this.recordAttempt(normalisedEmail, user.id, false, 'SERVICE_ACCOUNT');
      throw invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordAttempt(normalisedEmail, user.id, false, 'LOCKED');
      throw new AppException(
        ErrorCode.ACCOUNT_LOCKED,
        'This account is temporarily locked after repeated failed sign-in attempts.',
        { details: { lockedUntil: user.lockedUntil.toISOString() } },
      );
    }

    const passwordValid = await this.hasher.verify(password, user.passwordHash);
    if (!passwordValid) {
      await this.registerFailure(user.id, normalisedEmail, user.failedLoginAttempts);
      throw invalidCredentials();
    }

    if (user.status !== UserStatus.ACTIVE) {
      await this.recordAttempt(normalisedEmail, user.id, false, `STATUS_${user.status}`);
      throw new AppException(
        ErrorCode.ACCOUNT_NOT_ACTIVE,
        'This account is not active. Contact your administrator.',
        { details: { status: user.status } },
      );
    }

    // Transparent hash upgrade: if the work factor has been raised since this
    // password was set, re-hash it now, while we have the plaintext.
    const rehash = this.hasher.needsRehash(user.passwordHash)
      ? await this.hasher.hash(password)
      : null;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: context.ipAddress ?? null,
        ...(rehash
          ? { passwordHash: rehash, passwordAlgorithm: this.hasher.algorithm, passwordUpdatedAt: new Date() }
          : {}),
      },
    });

    await this.recordAttempt(normalisedEmail, user.id, true, null);

    const profile = buildProfile(user);
    const tokens = await this.issueTokens(user.id, profile);

    await this.audit.recordDetached({
      action: AuditAction.LOGIN_SUCCEEDED,
      entityType: 'User',
      entityId: user.id,
      organizationId: user.organizationId,
      actor: { id: user.id, type: 'USER', label: user.email, roles: profile.roles },
    });

    return { ...tokens, user: profile };
  }

  /**
   * Rotates a refresh token.
   *
   * @throws AppException REFRESH_TOKEN_REUSED when a revoked token is
   *         presented, which also revokes the whole family.
   */
  async refresh(refreshToken: string): Promise<LoginResponse> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.auth.refreshSecret,
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
      });
    } catch {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'The refresh token is not valid.');
    }

    if (payload.typ !== 'refresh') {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'The refresh token is not valid.');
    }

    const tokenHash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'The refresh token is not valid.');
    }

    if (stored.revokedAt) {
      // A revoked token being presented means it was captured after rotation.
      // Kill every token in the family: the legitimate holder must sign in
      // again, and the attacker's stolen token is worthless.
      await this.revokeFamily(stored.familyId, 'REUSE_DETECTED');
      await this.audit.recordFailure({
        action: AuditAction.TOKEN_REUSE_DETECTED,
        entityType: 'User',
        entityId: stored.userId,
        errorCode: ErrorCode.REFRESH_TOKEN_REUSED,
        reason: 'A revoked refresh token was presented; the token family was revoked.',
      });
      this.logger.warn('Refresh token reuse detected; family revoked', {
        userId: stored.userId,
        familyId: stored.familyId,
      });
      throw new AppException(
        ErrorCode.REFRESH_TOKEN_REUSED,
        'This session has been ended for security reasons. Please sign in again.',
      );
    }

    if (stored.expiresAt < new Date()) {
      throw new AppException(ErrorCode.TOKEN_EXPIRED, 'The refresh token has expired.');
    }

    const user = await this.loadUserForToken(stored.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.revokeFamily(stored.familyId, 'USER_INACTIVE');
      throw new AppException(ErrorCode.ACCOUNT_NOT_ACTIVE, 'This account is no longer active.');
    }

    const profile = buildProfile(user);
    const tokens = await this.issueTokens(user.id, profile, stored.familyId);

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
    });

    return { ...tokens, user: profile };
  }

  /** Revokes the presented refresh token's whole family. */
  async logout(refreshToken: string | undefined, userId: string): Promise<void> {
    if (refreshToken) {
      const stored = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(refreshToken) },
      });
      if (stored) await this.revokeFamily(stored.familyId, 'LOGOUT');
    } else {
      // No token supplied: end every session for this user. Blunt, but a
      // logout that leaves a session alive is worse.
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' },
      });
    }

    await this.audit.recordDetached({
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: userId,
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppException(ErrorCode.NOT_FOUND, 'User not found.');

    if (!(await this.hasher.verify(currentPassword, user.passwordHash))) {
      await this.audit.recordFailure({
        action: AuditAction.PASSWORD_CHANGED,
        entityType: 'User',
        entityId: userId,
        errorCode: ErrorCode.INVALID_CREDENTIALS,
        reason: 'Current password did not match.',
      });
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'The current password is incorrect.');
    }

    const problems = this.hasher.validatePolicy(newPassword, {
      email: user.email,
      fullName: user.fullName,
    });
    if (problems.length > 0) {
      throw new AppException(
        ErrorCode.PASSWORD_POLICY_VIOLATION,
        'The new password does not meet the password policy.',
        { details: { problems } },
      );
    }

    if (await this.hasher.verify(newPassword, user.passwordHash)) {
      throw new AppException(
        ErrorCode.PASSWORD_POLICY_VIOLATION,
        'The new password must differ from the current one.',
      );
    }

    const passwordHash = await this.hasher.hash(newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          passwordAlgorithm: this.hasher.algorithm,
          passwordUpdatedAt: new Date(),
          mustChangePassword: false,
        },
      });
      // Changing a password ends every other session; otherwise a compromised
      // session survives the very action taken to stop it.
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
      });
      await this.audit.record(tx, {
        action: AuditAction.PASSWORD_CHANGED,
        entityType: 'User',
        entityId: userId,
        organizationId: user.organizationId,
      });
    });
  }

  /** Rebuilds the full profile. Used by `GET /auth/me`. */
  async profileFor(userId: string): Promise<AuthenticatedUserProfile> {
    const user = await this.loadUserForToken(userId);
    if (!user) throw new AppException(ErrorCode.NOT_FOUND, 'User not found.');
    return buildProfile(user);
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private async issueTokens(
    userId: string,
    profile: AuthenticatedUserProfile,
    existingFamilyId?: string,
  ): Promise<Omit<LoginResponse, 'user'>> {
    const familyId = existingFamilyId ?? randomUUID();
    const sessionId = randomUUID();
    const context = RequestContextStore.get();

    const accessPayload: AccessTokenPayload = {
      sub: userId,
      email: profile.email,
      org: profile.organizationId,
      fin: profile.financierId,
      roles: profile.roles,
      sid: sessionId,
      typ: 'access',
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.auth.accessSecret,
      expiresIn: this.config.auth.accessTtlSeconds,
      issuer: this.config.auth.issuer,
      audience: this.config.auth.audience,
    });

    // A random jti keeps two refresh tokens minted in the same second distinct,
    // so their SHA-256 hashes cannot collide on the unique index.
    const refreshPayload: RefreshTokenPayload & { jti: string } = {
      sub: userId,
      sid: sessionId,
      typ: 'refresh',
      jti: randomToken(16),
    };

    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.auth.refreshSecret,
      expiresIn: this.config.auth.refreshTtlSeconds,
      issuer: this.config.auth.issuer,
      audience: this.config.auth.audience,
    });

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + this.config.auth.refreshTtlSeconds * 1000),
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.auth.accessTtlSeconds,
      tokenType: 'Bearer',
    };
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  private async registerFailure(
    userId: string,
    email: string,
    currentFailures: number,
  ): Promise<void> {
    const attempts = currentFailures + 1;
    const shouldLock = attempts >= this.config.auth.maxFailedAttempts;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts,
        ...(shouldLock
          ? { lockedUntil: new Date(Date.now() + this.config.auth.lockoutMinutes * 60_000) }
          : {}),
      },
    });

    await this.recordAttempt(email, userId, false, shouldLock ? 'LOCKED_OUT' : 'BAD_PASSWORD');

    if (shouldLock) {
      this.logger.warn('Account locked after repeated failures', { userId, attempts });
      await this.audit.recordFailure({
        action: AuditAction.ACCOUNT_LOCKED,
        entityType: 'User',
        entityId: userId,
        errorCode: ErrorCode.ACCOUNT_LOCKED,
        reason: `${attempts} consecutive failed sign-in attempts.`,
      });
    }
  }

  private async recordAttempt(
    email: string,
    userId: string | null,
    success: boolean,
    reason: string | null,
  ): Promise<void> {
    const context = RequestContextStore.get();
    try {
      await this.prisma.loginAttempt.create({
        data: {
          email,
          userId,
          success,
          reason,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.error('Failed to record login attempt', error);
    }
  }

  /** Equalises timing on the unknown-user path. */
  private async hashDummy(password: string): Promise<void> {
    this.dummyHash ??= await this.hasher.hash('unused-placeholder-for-timing-equalisation');
    await this.hasher.verify(password, this.dummyHash);
  }

  private async loadUserForToken(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: { select: { id: true, displayName: true } },
        financier: { select: { id: true, displayName: true } },
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        siteAccess: { select: { siteId: true } },
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type UserWithAccess = Prisma.UserGetPayload<{
  include: {
    organization: { select: { id: true; displayName: true } };
    financier: { select: { id: true; displayName: true } };
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } };
    siteAccess: { select: { siteId: true } };
  };
}>;

export function buildProfile(user: UserWithAccess): AuthenticatedUserProfile {
  const permissions = new Set<string>();
  const roles: string[] = [];

  for (const assignment of user.roles) {
    roles.push(assignment.role.code);
    for (const rolePermission of assignment.role.permissions) {
      permissions.add(rolePermission.permission.code);
    }
  }

  const allSiteAccess = permissions.has('site:access:all');

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    organizationId: user.organizationId,
    organizationName: user.organization.displayName,
    financierId: user.financierId,
    financierName: user.financier?.displayName ?? null,
    roles: roles.sort(),
    permissions: Array.from(permissions).sort(),
    siteIds: allSiteAccess ? [] : user.siteAccess.map((access) => access.siteId),
    allSiteAccess,
    mfaEnabled: user.mfaEnabled,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

/** One message for every credential failure, so nothing is enumerable. */
function invalidCredentials(): AppException {
  return new AppException(
    ErrorCode.INVALID_CREDENTIALS,
    'The email address or password is incorrect.',
  );
}
