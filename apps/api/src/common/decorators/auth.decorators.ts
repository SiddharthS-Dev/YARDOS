import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { Permission } from '@smartpark/contracts';

export const IS_PUBLIC_KEY = 'smartpark:isPublic';
export const PERMISSIONS_KEY = 'smartpark:permissions';
export const PERMISSIONS_MODE_KEY = 'smartpark:permissionsMode';
export const ALLOW_SERVICE_ACCOUNT_KEY = 'smartpark:allowServiceAccount';

/**
 * Marks a route as reachable without authentication.
 *
 * Deliberately opt-in: `JwtAuthGuard` is registered globally, so a route is
 * protected unless someone explicitly says otherwise. Forgetting a decorator
 * therefore fails closed.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires the caller to hold ALL of the listed permissions.
 *
 * Server-side authorisation is the only authorisation (requirement S28); the
 * console uses the same catalogue purely to hide affordances.
 */
export const RequirePermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Requires ANY ONE of the listed permissions. */
export const RequireAnyPermission = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => {
  const decorate = (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(PERMISSIONS_KEY, permissions)(target, key as string, descriptor as PropertyDescriptor);
    SetMetadata(PERMISSIONS_MODE_KEY, 'any')(target, key as string, descriptor as PropertyDescriptor);
  };
  return decorate as MethodDecorator & ClassDecorator;
};

/**
 * Allows a machine principal (an ANPR gateway service account) to call this
 * route. Every other route rejects service accounts outright, so a leaked
 * device credential cannot browse the estate.
 */
export const AllowServiceAccount = (): MethodDecorator =>
  SetMetadata(ALLOW_SERVICE_ACCOUNT_KEY, true);

/**
 * The authenticated principal, as resolved by `JwtStrategy` and enriched by
 * `PermissionsGuard`.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  /** Non-null only for financier-portal users. Forces object-level scoping. */
  financierId: string | null;
  roles: string[];
  permissions: Set<string>;
  /** Explicit site grants. Meaningless when `allSiteAccess` is true. */
  siteIds: string[];
  allSiteAccess: boolean;
  isServiceAccount: boolean;
  sessionId: string;
}

/** Injects the authenticated principal into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
