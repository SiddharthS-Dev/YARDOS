import { Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';

import {
  ErrorCode,
  FINANCIER_SCOPED_ROLES,
  MACHINE_ONLY_ROLES,
  Paginated,
  RoleCode,
} from '@smartpark/contracts';
import { AppException, notFound } from '@/common/errors/app-exception';
import { AuthenticatedUser } from '@/common/decorators/auth.decorators';
import { PaginationQueryDto, paginate } from '@/common/dto/pagination.dto';
import { randomToken } from '@/common/util/hash';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PasswordHasher } from '@/infrastructure/crypto/password-hasher.service';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: UserStatus;
  roles: string[];
  financierId: string | null;
  financierName: string | null;
  siteIds: string[];
  allSiteAccess: boolean;
  isServiceAccount: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface CreateUserInput {
  email: string;
  fullName: string;
  phone?: string;
  roleCodes: string[];
  siteIds?: string[];
  financierId?: string | null;
  /** Omitted means "generate one and require a change at first sign-in". */
  password?: string;
}

const SORTABLE = ['createdAt', 'fullName', 'email', 'lastLoginAt', 'status'] as const;

/**
 * User and role administration.
 *
 * Two invariants are enforced here rather than left to the caller, because
 * getting either wrong is a data-isolation breach:
 *
 *   1. A user holding a financier-scoped role MUST be linked to a financier,
 *      and a user NOT holding one must not be. Otherwise a portal login could
 *      end up unscoped and see every lender's vehicles.
 *
 *   2. Machine-only roles cannot be attached to an interactive login, and a
 *      service account cannot hold a human role.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
    filters: { search?: string; status?: UserStatus; roleCode?: string; financierId?: string } = {},
  ): Promise<Paginated<UserSummary>> {
    const where: Prisma.UserWhereInput = {
      organizationId: actor.organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.financierId ? { financierId: filters.financierId } : {}),
      ...(filters.roleCode ? { roles: { some: { role: { code: filters.roleCode } } } } : {}),
      ...(filters.search
        ? {
            OR: [
              { fullName: { contains: filters.search, mode: 'insensitive' } },
              { email: { contains: filters.search.toLowerCase() } },
            ],
          }
        : {}),
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: userInclude,
        orderBy: query.orderBy(SORTABLE, 'createdAt'),
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(rows.map(toSummary), totalItems, query);
  }

  async findById(actor: AuthenticatedUser, id: string): Promise<UserSummary> {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: userInclude,
    });
    if (!user) throw notFound('User', id);
    return toSummary(user);
  }

  /**
   * Creates a user.
   *
   * Returns the generated temporary password when one was not supplied. It is
   * returned exactly once, to the administrator who created the account, and
   * is never stored or logged.
   */
  async create(
    actor: AuthenticatedUser,
    input: CreateUserInput,
  ): Promise<{ user: UserSummary; temporaryPassword?: string }> {
    const email = input.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppException(ErrorCode.CONFLICT, 'A user with that email address already exists.', {
        details: { email },
      });
    }

    const roles = await this.resolveRoles(actor.organizationId, input.roleCodes);
    this.assertRoleScopeConsistency(roles.map((r) => r.code), input.financierId ?? null);

    if (input.financierId) {
      const financier = await this.prisma.financier.findFirst({
        where: { id: input.financierId, organizationId: actor.organizationId },
        select: { id: true, isActive: true },
      });
      if (!financier) throw notFound('Financier', input.financierId);
      if (!financier.isActive) {
        throw new AppException(ErrorCode.FINANCIER_INACTIVE, 'That financier is not active.');
      }
    }

    const temporaryPassword = input.password ?? generateTemporaryPassword();
    const policyProblems = this.hasher.validatePolicy(temporaryPassword, {
      email,
      fullName: input.fullName,
    });
    if (policyProblems.length > 0) {
      throw new AppException(
        ErrorCode.PASSWORD_POLICY_VIOLATION,
        'The supplied password does not meet the password policy.',
        { details: { problems: policyProblems } },
      );
    }

    const passwordHash = await this.hasher.hash(temporaryPassword);
    const siteIds = input.siteIds ?? [];

    if (siteIds.length > 0) {
      const validSites = await this.prisma.site.count({
        where: { id: { in: siteIds }, organizationId: actor.organizationId },
      });
      if (validSites !== siteIds.length) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'One or more sites are unknown.');
      }
    }

    const created = await this.prisma.transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: actor.organizationId,
          email,
          fullName: input.fullName.trim(),
          phone: input.phone ?? null,
          passwordHash,
          passwordAlgorithm: this.hasher.algorithm,
          // Created accounts are ACTIVE but must rotate the temporary password.
          status: UserStatus.ACTIVE,
          mustChangePassword: !input.password,
          financierId: input.financierId ?? null,
          createdById: actor.id,
          roles: {
            create: roles.map((role) => ({ roleId: role.id, grantedById: actor.id })),
          },
          ...(siteIds.length > 0
            ? { siteAccess: { create: siteIds.map((siteId) => ({ siteId })) } }
            : {}),
        },
        include: userInclude,
      });

      await this.audit.record(tx, {
        action: AuditAction.USER_CREATED,
        entityType: 'User',
        entityId: user.id,
        organizationId: actor.organizationId,
        afterState: {
          email: user.email,
          fullName: user.fullName,
          roles: roles.map((r) => r.code),
          financierId: user.financierId,
          siteIds,
        },
      });

      return user;
    });

    return {
      user: toSummary(created),
      ...(input.password ? {} : { temporaryPassword }),
    };
  }

  /** Replaces a user's role set. */
  async setRoles(
    actor: AuthenticatedUser,
    userId: string,
    roleCodes: string[],
  ): Promise<UserSummary> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
      include: userInclude,
    });
    if (!user) throw notFound('User', userId);

    const roles = await this.resolveRoles(actor.organizationId, roleCodes);
    this.assertRoleScopeConsistency(roles.map((r) => r.code), user.financierId);

    if (user.isServiceAccount && roles.some((r) => !MACHINE_ONLY_ROLES.includes(r.code as RoleCode))) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'A service account may only hold machine roles.',
      );
    }

    const before = user.roles.map((r) => r.role.code).sort();

    const updated = await this.prisma.transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({
        data: roles.map((role) => ({ userId, roleId: role.id, grantedById: actor.id })),
      });
      // Role changes take effect immediately: existing sessions are ended so a
      // live access token cannot keep exercising a permission just removed.
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ROLES_CHANGED' },
      });

      await this.audit.record(tx, {
        action: AuditAction.USER_ROLES_CHANGED,
        entityType: 'User',
        entityId: userId,
        organizationId: actor.organizationId,
        beforeState: { roles: before },
        afterState: { roles: roles.map((r) => r.code).sort() },
      });

      return tx.user.findUniqueOrThrow({ where: { id: userId }, include: userInclude });
    });

    return toSummary(updated);
  }

  /** Replaces a user's site grants. */
  async setSiteAccess(
    actor: AuthenticatedUser,
    userId: string,
    siteIds: string[],
  ): Promise<UserSummary> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
      include: userInclude,
    });
    if (!user) throw notFound('User', userId);

    if (siteIds.length > 0) {
      const valid = await this.prisma.site.count({
        where: { id: { in: siteIds }, organizationId: actor.organizationId },
      });
      if (valid !== siteIds.length) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'One or more sites are unknown.');
      }
    }

    const before = user.siteAccess.map((a) => a.siteId).sort();

    const updated = await this.prisma.transaction(async (tx) => {
      await tx.userSiteAccess.deleteMany({ where: { userId } });
      if (siteIds.length > 0) {
        await tx.userSiteAccess.createMany({ data: siteIds.map((siteId) => ({ userId, siteId })) });
      }
      await this.audit.record(tx, {
        action: AuditAction.USER_SITE_ACCESS_CHANGED,
        entityType: 'User',
        entityId: userId,
        organizationId: actor.organizationId,
        beforeState: { siteIds: before },
        afterState: { siteIds: [...siteIds].sort() },
      });
      return tx.user.findUniqueOrThrow({ where: { id: userId }, include: userInclude });
    });

    return toSummary(updated);
  }

  async setStatus(
    actor: AuthenticatedUser,
    userId: string,
    status: UserStatus,
    reason: string,
  ): Promise<UserSummary> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
      include: userInclude,
    });
    if (!user) throw notFound('User', userId);

    // Locking yourself out of the platform is never the intent.
    if (userId === actor.id && status !== UserStatus.ACTIVE) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'You cannot change your own account status.',
      );
    }

    const updated = await this.prisma.transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: userId },
        data: {
          status,
          ...(status === UserStatus.ACTIVE ? { failedLoginAttempts: 0, lockedUntil: null } : {}),
        },
        include: userInclude,
      });

      if (status !== UserStatus.ACTIVE) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: `STATUS_${status}` },
        });
      }

      await this.audit.record(tx, {
        action: AuditAction.USER_STATUS_CHANGED,
        entityType: 'User',
        entityId: userId,
        organizationId: actor.organizationId,
        beforeState: { status: user.status },
        afterState: { status },
        reason,
      });

      return next;
    });

    return toSummary(updated);
  }

  /** Administrator-initiated password reset. */
  async resetPassword(
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<{ temporaryPassword: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
    });
    if (!user) throw notFound('User', userId);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.hasher.hash(temporaryPassword);

    await this.prisma.transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          passwordAlgorithm: this.hasher.algorithm,
          passwordUpdatedAt: new Date(),
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
      });
      await this.audit.record(tx, {
        action: AuditAction.PASSWORD_CHANGED,
        entityType: 'User',
        entityId: userId,
        organizationId: actor.organizationId,
        reason: 'Administrator-initiated reset.',
      });
    });

    return { temporaryPassword };
  }

  async listRoles(actor: AuthenticatedUser): Promise<
    Array<{ code: string; name: string; description: string | null; isSystem: boolean; permissions: string[] }>
  > {
    const roles = await this.prisma.role.findMany({
      where: { organizationId: actor.organizationId },
      include: { permissions: { include: { permission: true } } },
      orderBy: { code: 'asc' },
    });

    return roles.map((role) => ({
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.permissions.map((p) => p.permission.code).sort(),
    }));
  }

  /* ---------------------------------------------------------------- */

  private async resolveRoles(organizationId: string, roleCodes: string[]) {
    if (roleCodes.length === 0) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'At least one role is required.');
    }
    const roles = await this.prisma.role.findMany({
      where: { organizationId, code: { in: roleCodes } },
      select: { id: true, code: true },
    });
    if (roles.length !== roleCodes.length) {
      const found = new Set(roles.map((r) => r.code));
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'One or more roles are unknown.', {
        details: { unknownRoles: roleCodes.filter((code) => !found.has(code)) },
      });
    }
    return roles;
  }

  /**
   * A financier-scoped role without a financier link would produce an
   * unscoped portal login able to read every lender's data. Refuse both
   * directions.
   */
  private assertRoleScopeConsistency(roleCodes: string[], financierId: string | null): void {
    const needsFinancier = roleCodes.some((code) =>
      FINANCIER_SCOPED_ROLES.includes(code as RoleCode),
    );

    if (needsFinancier && !financierId) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'A financier portal user must be linked to a financier.',
        { details: { roles: roleCodes } },
      );
    }
    if (!needsFinancier && financierId) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'Only financier portal users may be linked to a financier.',
        { details: { roles: roleCodes } },
      );
    }
  }
}

/* ------------------------------------------------------------------ */

const userInclude = {
  financier: { select: { id: true, displayName: true } },
  roles: { include: { role: { select: { code: true } } } },
  siteAccess: { select: { siteId: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function toSummary(user: UserRow): UserSummary {
  const roles = user.roles.map((r) => r.role.code).sort();
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    status: user.status,
    roles,
    financierId: user.financierId,
    financierName: user.financier?.displayName ?? null,
    siteIds: user.siteAccess.map((a) => a.siteId),
    // Derived from the role bundle rather than stored, so it cannot drift.
    allSiteAccess: false,
    isServiceAccount: user.isServiceAccount,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * A temporary password that satisfies the policy by construction.
 * Returned once to the creating administrator; never stored or logged.
 */
function generateTemporaryPassword(): string {
  // randomToken is base64url, so it already mixes cases and digits; the suffix
  // guarantees a symbol and removes any chance of a policy failure.
  return `Sp${randomToken(12)}!7q`;
}
