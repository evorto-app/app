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

const databaseEffect = <A, E>(
  operation: (database: DatabaseClient) => Effect.Effect<A, E, never>,
) => Database.pipe(Effect.flatMap((database) => operation(database)));

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
  signedCookies: Record<string, unknown> | undefined;
}) =>
  Effect.gen(function* () {
    // Resolution order:
    // 1) signed cookie
    // 2) plain cookie
    // 3) request host header
    // This keeps local/dev tenant switching deterministic while still allowing
    // host-based tenant resolution in production.
    const cause = { domain: '', tenantCookie: '' };
    const tenantCookie =
      asString(input.signedCookies?.['evorto-tenant']) ??
      asString(input.cookies?.['evorto-tenant']);
    let tenantRecord;

    if (tenantCookie) {
      tenantRecord = yield* databaseEffect((database) =>
        getPreparedStatements(database).getTenantByDomain.execute({
          domain: tenantCookie,
        }),
      );
      cause.tenantCookie = tenantCookie;
    }

    const host = resolveHostHeader(input.requestHost);
    if (!tenantCookie && host) {
      const hostUrl = new URL(`${input.protocol}://${host}`);
      const domain = hostUrl.hostname;
      tenantRecord = yield* databaseEffect((database) =>
        getPreparedStatements(database).getTenantByDomain.execute({
          domain,
        }),
      );
      cause.domain = domain;
    }

    return {
      cause,
      tenant: tenantRecord ? Schema.decodeSync(Tenant)(tenantRecord) : undefined,
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
