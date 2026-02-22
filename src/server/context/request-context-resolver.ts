import { Effect, Schema } from 'effect';
import { uniq } from 'es-toolkit';

import { Database, type DatabaseClient } from '../../db';
import { getPreparedStatements } from '../../db/prepared-statements';
import {
  ALL_PERMISSIONS,
  type Permission,
} from '../../shared/permissions/permissions';
import { type Authentication } from '../../types/custom/authentication';
import { Tenant } from '../../types/custom/tenant';

// Keep backward-compatible permission aliases while migrating toward a single
// canonical set. This avoids breaking handlers that still check the old value.
const expandPermissionAliases = (permission: Permission): Permission[] => {
  if (permission === 'admin:manageTaxes') {
    return ['admin:manageTaxes', 'admin:tax'];
  }

  return [permission];
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
) => Database.pipe(Effect.flatMap((database) => operation(database)));

const findTenantByDomain = (domain: string) =>
  databaseEffect((database) =>
    getPreparedStatements(database).getTenantByDomain.execute({
      domain,
    }),
  );

export const resolveAuthenticationContext = (input: {
  appSessionCookie: string | undefined;
  isAuthenticated: boolean;
}): Authentication => ({
  cookie: input.appSessionCookie,
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
    let tenantRecord: unknown;
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
        ? Schema.decodeUnknownSync(Tenant)(tenantRecord)
        : undefined,
    };
  });

export const resolveUserContext = (input: {
  isAuthenticated: boolean;
  oidcUser: unknown;
  tenantId: string;
}) =>
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

    const appMetadata = asRecord(oidcUser?.['evorto.app/app_metadata']);
    const permissions: Permission[] =
      appMetadata?.['globalAdmin'] === true
        // Global admins bypass tenant role scoping but still include role-based
        // permissions for parity with existing permission checks.
        ? [...ALL_PERMISSIONS, 'globalAdmin:manageTenants']
        : user.tenantAssignments
            .flatMap((assignment) => assignment.roles)
            .flatMap((role) => role.permissions);

    const roleIds = user.tenantAssignments
      .flatMap((assignment) => assignment.roles)
      .flatMap((role) => role.id);

    const attributeResponse = yield* databaseEffect((database) =>
      Effect.map(
        getPreparedStatements(database).getUserAttributesByTenantAndUser.execute(
          {
            tenantId: input.tenantId,
            userId: user.id,
          },
        ),
        (result) => result[0],
      ),
    );

    const attributes = [
      ...(attributeResponse?.organizesSome
        ? (['events:organizesSome'] as const)
        : []),
    ];

    return {
      ...user,
      attributes,
      permissions: uniq(
        permissions.flatMap((permission) => expandPermissionAliases(permission)),
      ),
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
