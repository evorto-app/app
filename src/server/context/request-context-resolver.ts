import { Effect, Schema } from 'effect';
import { uniq } from 'es-toolkit';

import { Database, type DatabaseClient } from '../../db';
import { getPreparedStatements } from '../../db/prepared-statements';
import {
  type Permission,
  type TenantRolePermission,
  TenantRolePermissionSchema,
} from '../../shared/permissions/permissions';
import { type Authentication } from '../../types/custom/authentication';
import { PlatformAdministratorAuthority } from '../../types/custom/platform-authority';
import { Tenant } from '../../types/custom/tenant';
import { hasCurrentTenantOnboarding } from '../onboarding/tenant-onboarding.service';

const normalizePermissions = <P extends Permission>(
  permissions: readonly P[],
): P[] => uniq(permissions);

const PersistedTenantRolePermissions = Schema.Array(TenantRolePermissionSchema);

export const resolvePlatformAuthority = (
  oidcUser: unknown,
  testGlobalAdminAuth0Ids: readonly string[] = [],
): PlatformAdministratorAuthority | undefined => {
  const user = asRecord(oidcUser);
  const appMetadata =
    asRecord(user?.['evorto.app/app_metadata']) ??
    asRecord(user?.['https://evorto.app/app_metadata']) ??
    asRecord(user?.['app_metadata']);
  const auth0Id = asString(user?.['sub']);
  const configuredLocalEndToEndGlobalAdmin =
    auth0Id !== undefined && testGlobalAdminAuth0Ids.includes(auth0Id);

  const isPlatformAdministrator =
    appMetadata?.['platformAdministrator'] === true ||
    configuredLocalEndToEndGlobalAdmin;

  return isPlatformAdministrator && auth0Id
    ? PlatformAdministratorAuthority.make({
        actorEmail: asString(user?.['email']) ?? null,
        actorId: auth0Id,
        kind: 'platformAdministrator',
      })
    : undefined;
};

export const resolveRequestPermissions = (input: {
  platformAuthority: PlatformAdministratorAuthority | undefined;
  user:
    | undefined
    | {
        permissions: readonly TenantRolePermission[];
      };
}) => {
  return normalizePermissions([
    ...(input.platformAuthority
      ? (['globalAdmin:manageTenants'] as const)
      : []),
    ...(input.user?.permissions ?? []),
  ]);
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const resolveHostHeader = (
  input: readonly string[] | string | undefined,
): string | undefined => {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return input[0];
  return;
};

const toHostDomain = (
  protocol: string,
  requestHost: readonly string[] | string | undefined,
): string | undefined => {
  const host = resolveHostHeader(requestHost);
  if (!host) {
    return;
  }

  try {
    return new URL(`${protocol}://${host}`).hostname;
  } catch {
    return;
  }
};

const isLocalRequestHost = (domain: string): boolean =>
  domain === 'localhost' ||
  domain === '127.0.0.1' ||
  domain === '::1' ||
  domain === '[::1]';

const databaseEffect = <A, E>(
  operation: (database: DatabaseClient) => Effect.Effect<A, E, never>,
) => Database.use((database) => operation(database));

const findTenantByDomain = (domain: string) =>
  databaseEffect((database) =>
    getPreparedStatements(database).getTenantByDomain.execute({
      domain,
    }),
  );

const tenantContextRecord = (
  tenant: NonNullable<Effect.Success<ReturnType<typeof findTenantByDomain>>>,
) => {
  const { privacyPolicyVersions, ...tenantFields } = tenant;
  const currentPrivacyPolicy = privacyPolicyVersions[0];
  if (!currentPrivacyPolicy) {
    throw new Error(
      `Tenant ${tenant.id} is missing its required privacy policy version`,
    );
  }

  return {
    ...tenantFields,
    privacyPolicyText: currentPrivacyPolicy.privacyPolicyText,
    privacyPolicyUrl: currentPrivacyPolicy.privacyPolicyUrl,
  };
};

export const resolveAuthenticationContext = (input: {
  isAuthenticated: boolean;
}): Authentication => ({
  isAuthenticated: input.isAuthenticated,
});

export const resolveTenantContext = (input: {
  cookies: Record<string, unknown> | undefined;
  protocol: string;
  requestHost: readonly string[] | string | undefined;
}) =>
  Effect.gen(function* () {
    // Resolution order:
    // 1) request host header
    // 2) plain tenant cookie fallback
    // Host-first prevents client-controlled cookies from overriding a valid host
    // tenant, while still supporting local/dev fallback when host resolution
    // does not map to a tenant.
    const cause = { domain: '', tenantCookie: '' };
    let tenantRecord: Effect.Success<ReturnType<typeof findTenantByDomain>>;
    const hostDomain = toHostDomain(input.protocol, input.requestHost);
    const tenantCookie = asString(input.cookies?.['evorto-tenant']);

    if (hostDomain) {
      cause.domain = hostDomain;
    }
    if (tenantCookie) {
      cause.tenantCookie = tenantCookie;
    }

    if (hostDomain && isLocalRequestHost(hostDomain) && tenantCookie) {
      tenantRecord = yield* findTenantByDomain(tenantCookie);
      if (!tenantRecord) {
        tenantRecord = yield* findTenantByDomain(hostDomain);
      }
    } else if (hostDomain) {
      tenantRecord = yield* findTenantByDomain(hostDomain);
    } else if (tenantCookie) {
      tenantRecord = yield* findTenantByDomain(tenantCookie);
    }

    return {
      cause,
      tenant: tenantRecord
        ? Schema.decodeUnknownSync(Tenant)(tenantContextRecord(tenantRecord))
        : undefined,
    };
  });

const resolveCurrentTenantOnboarding = (input: {
  tenantId: string;
  userId: string;
}) => databaseEffect((database) => hasCurrentTenantOnboarding(database, input));

export const resolveUserContext = (
  input: {
    isAuthenticated: boolean;
    oidcUser: unknown;
    tenantId: string;
  },
  resolveOnboardingComplete = resolveCurrentTenantOnboarding,
) =>
  Effect.gen(function* () {
    if (!input.isAuthenticated) {
      return;
    }

    const oidcUser = asRecord(input.oidcUser);
    const auth0Id = asString(oidcUser?.['sub']);
    if (!auth0Id) {
      return;
    }

    const user = yield* databaseEffect((database) =>
      getPreparedStatements(database).getUserByAuth0IdAndTenant.execute({
        auth0Id,
        tenantId: input.tenantId,
      }),
    );
    if (!user) {
      return;
    }

    if (user.tenantAssignments.length === 0) {
      return;
    }

    const onboardingComplete = yield* resolveOnboardingComplete({
      tenantId: input.tenantId,
      userId: user.id,
    });
    if (!onboardingComplete) {
      return;
    }

    const assignedRoles = user.tenantAssignments
      .flatMap((assignment) => assignment.roles)
      .map((role) => ({
        ...role,
        permissions: Schema.decodeUnknownSync(PersistedTenantRolePermissions)(
          role.permissions,
        ),
      }));

    const permissions = assignedRoles.flatMap((role) => role.permissions);

    const roleIds = assignedRoles.map((role) => role.id);

    return {
      ...user,
      homeTenantName: user.homeTenant?.name,
      permissions: normalizePermissions(permissions),
      roleIds,
    };
  });

export interface TenantContextResolution {
  cause: {
    domain: string;
    tenantCookie: string;
  };
  tenant: Tenant | undefined;
}
