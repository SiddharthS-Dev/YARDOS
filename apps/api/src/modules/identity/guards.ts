import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';

import { ErrorCode } from '@smartpark/contracts';
import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppException, permissionDenied } from '@/common/errors/app-exception';
import { RequestContextStore } from '@/common/context/request-context';
import {
  ALLOW_SERVICE_ACCOUNT_KEY,
  AuthenticatedUser,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  PERMISSIONS_MODE_KEY,
} from '@/common/decorators/auth.decorators';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AccessTokenPayload } from './auth.service';

/* ------------------------------------------------------------------ */
/* JWT strategy                                                        */
/* ------------------------------------------------------------------ */

/**
 * Validates the access token and rebuilds the principal.
 *
 * The token carries roles, but NOT permissions: permissions are re-read from
 * the database on every request. A role's permissions can be changed by an
 * administrator, and an already-issued 15-minute token must not keep granting
 * access that has just been revoked.
 *
 * The read is a single indexed query and is the natural place to cache later,
 * with explicit invalidation on role change.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.auth.accessSecret,
      issuer: config.auth.issuer,
      audience: config.auth.audience,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (payload.typ !== 'access') {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'A refresh token cannot be used here.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        organizationId: true,
        financierId: true,
        isServiceAccount: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
        siteAccess: { select: { siteId: true } },
      },
    });

    if (!user) {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'This session is no longer valid.');
    }
    if (user.status !== 'ACTIVE') {
      throw new AppException(
        ErrorCode.ACCOUNT_NOT_ACTIVE,
        'This account is not active.',
        { details: { status: user.status } },
      );
    }

    const permissions = new Set<string>();
    const roles: string[] = [];
    for (const assignment of user.roles) {
      roles.push(assignment.role.code);
      for (const rp of assignment.role.permissions) permissions.add(rp.permission.code);
    }

    const principal: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      organizationId: user.organizationId,
      financierId: user.financierId,
      roles,
      permissions,
      siteIds: user.siteAccess.map((access) => access.siteId),
      allSiteAccess: permissions.has('site:access:all'),
      isServiceAccount: user.isServiceAccount,
      sessionId: payload.sid,
    };

    // Enrich the ambient context so every later log line and audit row knows
    // who is acting, without any service needing to be told.
    RequestContextStore.patch({
      userId: principal.id,
      userLabel: principal.email,
      userRoles: principal.roles,
      organizationId: principal.organizationId,
      financierId: principal.financierId,
      actorType: principal.isServiceAccount ? 'DEVICE' : 'USER',
    });

    return principal;
  }
}

/* ------------------------------------------------------------------ */
/* Authentication guard                                                */
/* ------------------------------------------------------------------ */

/**
 * Registered globally, so every route is authenticated unless it opts out with
 * `@Public()`. Forgetting a decorator therefore fails closed - the opposite
 * default would mean a new endpoint is unprotected until someone remembers.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  override handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser | false,
    info: unknown,
  ): TUser {
    if (err) throw err;
    if (!user) {
      // Distinguish "expired" from "invalid" so the console knows whether to
      // silently refresh or bounce the user to the sign-in page.
      const message = (info as { message?: string } | undefined)?.message ?? '';
      if (/expired/i.test(message)) {
        throw new AppException(ErrorCode.TOKEN_EXPIRED, 'Your session has expired.');
      }
      throw new AppException(
        ErrorCode.UNAUTHENTICATED,
        'Authentication is required to access this resource.',
      );
    }
    return user;
  }
}

/* ------------------------------------------------------------------ */
/* Permissions guard                                                   */
/* ------------------------------------------------------------------ */

/**
 * Enforces the permission catalogue.
 *
 * Also enforces the service-account rule: a machine principal (an ANPR
 * gateway) may only reach routes explicitly marked `@AllowServiceAccount()`,
 * so a leaked device credential cannot be used to browse the estate even if
 * its role somehow carried a read permission.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Authentication is required.');
    }

    if (user.isServiceAccount) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_SERVICE_ACCOUNT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw permissionDenied(
          [],
          'Service accounts may only call machine-to-machine endpoints.',
        );
      }
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const mode = this.reflector.getAllAndOverride<'all' | 'any'>(PERMISSIONS_MODE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const satisfied =
      mode === 'any'
        ? required.some((permission) => user.permissions.has(permission))
        : required.every((permission) => user.permissions.has(permission));

    if (!satisfied) {
      throw permissionDenied(required);
    }
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Scope enforcement                                                   */
/* ------------------------------------------------------------------ */

/**
 * Object-level authorisation helpers.
 *
 * Requirement S36: "Do not make ownership information globally visible merely
 * because it exists in the central repository." A permission says what verb a
 * caller may use; these say which ROWS they may use it on.
 *
 * Used as an explicit call inside services rather than as a decorator, because
 * scoping needs the loaded record - and an authorisation check that can be
 * forgotten by omitting a decorator is a check that will eventually be
 * forgotten. Repositories additionally take the scope as a mandatory
 * predicate, so the narrowing happens in SQL rather than after the fact.
 */
@Injectable()
export class AccessScope {
  /**
   * Asserts the caller may act on a record belonging to `siteId`.
   *
   * @throws AppException SITE_ACCESS_DENIED
   */
  static assertSite(user: AuthenticatedUser, siteId: string | null | undefined): void {
    if (!siteId) return;
    if (user.allSiteAccess) return;
    if (user.siteIds.includes(siteId)) return;
    throw new AppException(
      ErrorCode.SITE_ACCESS_DENIED,
      'You do not have access to this site.',
      { details: { siteId } },
    );
  }

  /**
   * Asserts a financier-portal user is acting only on their own financier's
   * data. Sri JP staff (financierId === null) are unaffected.
   *
   * @throws AppException FINANCIER_SCOPE_VIOLATION
   */
  static assertFinancier(
    user: AuthenticatedUser,
    financierId: string | null | undefined,
  ): void {
    if (!user.financierId) return;
    if (financierId && financierId === user.financierId) return;
    throw new AppException(
      ErrorCode.FINANCIER_SCOPE_VIOLATION,
      'This record belongs to another financier.',
    );
  }

  /**
   * The site filter to apply to a query. `undefined` means "no restriction".
   *
   * Returning an explicit empty list for a user with no grants is deliberate:
   * it produces zero rows rather than silently returning everything.
   */
  static siteFilter(user: AuthenticatedUser): { in: string[] } | undefined {
    if (user.allSiteAccess) return undefined;
    return { in: user.siteIds };
  }

  /** The mandatory financier predicate for a portal user, if any. */
  static financierFilter(user: AuthenticatedUser): string | undefined {
    return user.financierId ?? undefined;
  }

  static has(user: AuthenticatedUser, permission: string): boolean {
    return user.permissions.has(permission);
  }

  /**
   * Whether the caller may see unmasked owner PII. Callers without
   * `vehicle:pii:read` receive masked values (requirement S36).
   */
  static canSeePii(user: AuthenticatedUser): boolean {
    return user.permissions.has('vehicle:pii:read');
  }
}

/** Thrown when a strategy is misconfigured; surfaces as 401, never 500. */
export class UnauthenticatedError extends UnauthorizedException {}
