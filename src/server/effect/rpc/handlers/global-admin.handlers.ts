import type { GlobalAdminTenantWriteInput } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import type { Headers } from 'effect/unstable/http';

import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  GlobalAdminTenantRecord,
  type GlobalAdminTenantRecord as GlobalAdminTenantRecordType,
} from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import { eq } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { tenants } from '../../../../db/schema';
import {
  includesPermission,
  type Permission,
} from '../../../../shared/permissions/permissions';
import { ConfigPermissions } from '../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, RpcUnauthorizedError> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail(
        new RpcUnauthorizedError({ message: 'Authentication required' }),
      );

const decodeHeaderJson = <A>(
  value: string | undefined,
  schema: Schema.Decoder<A>,
): A => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const ensurePermission = (
  headers: Headers.Headers,
  permission: Permission,
): Effect.Effect<void, RpcForbiddenError | RpcUnauthorizedError> =>
  Effect.gen(function* () {
    yield* ensureAuthenticated(headers);
    const currentPermissions = decodeHeaderJson(
      headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
      ConfigPermissions,
    );

    if (!includesPermission(permission, currentPermissions)) {
      return yield* Effect.fail(
        new RpcForbiddenError({ message: 'Forbidden', permission }),
      );
    }
  });

const toGlobalAdminTenantRecord = (tenant: {
  currency: string;
  domain: string;
  id: string;
  locale: string;
  name: string;
  stripeAccountId: null | string;
  theme: string;
  timezone: string;
}): GlobalAdminTenantRecordType => {
  return Schema.decodeUnknownSync(GlobalAdminTenantRecord)({
    ...tenant,
    stripeConnected: !!tenant.stripeAccountId,
  });
};

const normalizeTenantDomain = (value: string): string => {
  const trimmedValue = value.trim().toLocaleLowerCase();
  if (!trimmedValue) {
    throw new Error('Domain is required');
  }

  const url = new URL(
    trimmedValue.includes('://') ? trimmedValue : `https://${trimmedValue}`,
  );
  if (
    !url.hostname ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error('Domain must be a single host name');
  }

  return url.hostname;
};

const normalizeTenantWriteInput = (
  input: GlobalAdminTenantWriteInput,
): GlobalAdminTenantWriteInput => {
  const name = input.name.trim();
  if (!name) {
    throw new Error('Tenant name is required');
  }

  return {
    currency: input.currency,
    domain: normalizeTenantDomain(input.domain),
    locale: input.locale,
    name,
    stripeAccountId: input.stripeAccountId?.trim() || undefined,
    theme: input.theme,
    timezone: input.timezone,
  };
};

const normalizeTenantWritePayload = (input: GlobalAdminTenantWriteInput) =>
  Effect.try({
    catch: (error) =>
      new RpcBadRequestError({
        message: 'Invalid tenant settings',
        reason: error instanceof Error ? error.message : String(error),
      }),
    try: () => normalizeTenantWriteInput(input),
  });

const globalAdminTenantColumns = {
  currency: true,
  domain: true,
  id: true,
  locale: true,
  name: true,
  stripeAccountId: true,
  theme: true,
  timezone: true,
} as const;

const globalAdminTenantReturningColumns = {
  currency: tenants.currency,
  domain: tenants.domain,
  id: tenants.id,
  locale: tenants.locale,
  name: tenants.name,
  stripeAccountId: tenants.stripeAccountId,
  theme: tenants.theme,
  timezone: tenants.timezone,
} as const;

export const globalAdminHandlers = {
  'globalAdmin.tenants.create': (input, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'globalAdmin:manageTenants');
      const tenantInput = yield* normalizeTenantWritePayload(input);
      const createdTenants = yield* databaseEffect((database) =>
        database
          .insert(tenants)
          .values({
            ...tenantInput,
            stripeAccountId: tenantInput.stripeAccountId ?? null,
          })
          .returning(globalAdminTenantReturningColumns),
      );
      const createdTenant = createdTenants[0];
      if (!createdTenant) {
        return yield* Effect.fail(
          new RpcBadRequestError({ message: 'Tenant could not be created' }),
        );
      }

      return toGlobalAdminTenantRecord(createdTenant);
    }),
  'globalAdmin.tenants.findMany': (_payload, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'globalAdmin:manageTenants');
      const allTenants = yield* databaseEffect((database) =>
        database.query.tenants.findMany({
          columns: globalAdminTenantColumns,
          orderBy: (table, { asc }) => [asc(table.name)],
        }),
      );

      return allTenants.map((tenant) => toGlobalAdminTenantRecord(tenant));
    }),
  'globalAdmin.tenants.findOne': (input, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'globalAdmin:manageTenants');
      const tenant = yield* databaseEffect((database) =>
        database.query.tenants.findFirst({
          columns: globalAdminTenantColumns,
          where: {
            id: input.id,
          },
        }),
      );

      return tenant ? toGlobalAdminTenantRecord(tenant) : null;
    }),
  'globalAdmin.tenants.update': (input, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'globalAdmin:manageTenants');
      const { id, ...writeInput } = input;
      const tenantInput = yield* normalizeTenantWritePayload(writeInput);
      const updatedTenants = yield* databaseEffect((database) =>
        database
          .update(tenants)
          .set({
            ...tenantInput,
            stripeAccountId: tenantInput.stripeAccountId ?? null,
          })
          .where(eq(tenants.id, id))
          .returning(globalAdminTenantReturningColumns),
      );
      const updatedTenant = updatedTenants[0];
      if (!updatedTenant) {
        return yield* Effect.fail(
          new RpcBadRequestError({ message: 'Tenant not found' }),
        );
      }

      return toGlobalAdminTenantRecord(updatedTenant);
    }),
} satisfies Partial<AppRpcHandlers>;
