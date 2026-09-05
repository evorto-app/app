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
) => uniq(permissions);

const PersistedTenantRolePermissions = Schema.Array(TenantRolePermissionSchema);

const normalizedRequestHost =
  /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::[0-9]{1,5})?$/u;

export const resolvePlatformAuthority = (
  oidcUser: unknown,
): PlatformAdministratorAuthority | undefined => {
  const user = asRecord(oidcUser);
  const appMetadata = asRecord(user?.['evorto.app/app_metadata']);
  const auth0Id = asString(user?.['sub']);
  const isPlatformAdministrator =
    appMetadata?.['platformAdministrator'] === true;

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
  const tenantPermissions = input.user?.permissions ?? [];

  return normalizePermissions([
    ...(input.platformAuthority
      ? (['globalAdmin:manageTenants'] as const)
      : []),
    ...tenantPermissions,
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
  if (Array.isArray(input) && input.length === 1) return input[0];
  return;
};

const toNormalizedHostDomain = (
  protocol: string,
  requestHost: readonly string[] | string | undefined,
): string | undefined => {
  const host = resolveHostHeader(requestHost);
  if (
    (protocol !== 'http' && protocol !== 'https') ||
    !host ||
    host.trim() !== host ||
    !normalizedRequestHost.test(host) ||
    host.includes('..')
  ) {
    return;
  }

  try {
    const url = new URL(`${protocol}://${host}`);
    if (
      url.host !== host ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.hostname.endsWith('.')
    ) {
      return;
    }

    return url.hostname;
  } catch {
    return;
  }
};

const toNormalizedTenantDomain = (domain: string): string | undefined => {
  if (
    domain.trim() !== domain ||
    !normalizedRequestHost.test(domain) ||
    domain.includes('..')
  ) {
    return;
  }

  try {
    const url = new URL(`https://${domain}`);
    if (
      url.host !== domain ||
      url.hostname !== domain ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.hostname.endsWith('.')
    ) {
      return;
    }

    return url.hostname;
  } catch {
    return;
  }
};

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

export const resolveExplicitTenantDomain = (input: {
  applicationEnvironment: 'local' | 'production' | 'staging';
  localTestTenantDomain: string | undefined;
  trustedTenantDomain: string | undefined;
}): string | undefined =>
  input.trustedTenantDomain ??
  (input.applicationEnvironment === 'local'
    ? input.localTestTenantDomain
    : undefined);

export const resolveTenantContext = (input: {
  protocol: string;
  requestHost: readonly string[] | string | undefined;
  routedTenantDomain?: string | undefined;
}) =>
  Effect.gen(function* () {
    const domain =
      input.routedTenantDomain === undefined
        ? toNormalizedHostDomain(input.protocol, input.requestHost)
        : toNormalizedTenantDomain(input.routedTenantDomain);
    if (!domain) {
      return {
        cause: { domain: '' },
        tenant: undefined,
      };
    }

    const tenantRecord = yield* findTenantByDomain(domain);

    return {
      cause: { domain },
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
      throw new Error(
        'Authenticated request context is missing its Auth0 user subject',
      );
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

    const assignedRoles = user.tenantAssignments.flatMap(
      (assignment) => assignment.roles,
    );
    const permissions = assignedRoles.flatMap((role) =>
      Schema.decodeUnknownSync(PersistedTenantRolePermissions)(
        role.permissions,
      ),
    );

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
  };
  tenant: Tenant | undefined;
}
