import type { GlobalAdminTenantWriteInput } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import type { Headers } from 'effect/unstable/http';

import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  GlobalAdminEmailOutboxOverview,
  GlobalAdminTenantRecord,
  type GlobalAdminTenantRecord as GlobalAdminTenantRecordType,
} from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { emailOutbox, tenants } from '../../../../db/schema';
import {
  includesPermission,
  type Permission,
} from '../../../../shared/permissions/permissions';
import { ConfigPermissions } from '../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import {
  normalizeTenantCanonicalRootUrl,
  normalizeTenantDomain,
} from '../../../../shared/tenant-origin';
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

const decodeHeaderJson = <S extends Schema.ConstraintDecoder<unknown>>(
  value: string | undefined,
  schema: S,
): S['Type'] =>
  Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

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
  canonicalRootUrl: string;
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

const normalizeTenantWriteInput = (
  input: GlobalAdminTenantWriteInput,
): GlobalAdminTenantWriteInput => {
  const name = input.name.trim();
  if (!name) {
    throw new Error('Tenant name is required');
  }

  const domain = normalizeTenantDomain(input.domain);

  return {
    canonicalRootUrl: normalizeTenantCanonicalRootUrl(
      input.canonicalRootUrl,
      domain,
    ),
    currency: input.currency,
    domain,
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
  canonicalRootUrl: true,
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
  canonicalRootUrl: tenants.canonicalRootUrl,
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
  'globalAdmin.emailOutbox.findOverview': (_payload, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'globalAdmin:manageTenants');
      const now = new Date();
      const staleSendingBefore = new Date(Date.now() - 10 * 60 * 1000);
      const [
        statusCounts,
        waitingForRetryRows,
        staleSendingRows,
        exhaustedRows,
        itemRows,
      ] = yield* databaseEffect((database) =>
        Effect.all([
          database
            .select({
              status: emailOutbox.status,
              total: count(),
            })
            .from(emailOutbox)
            .groupBy(emailOutbox.status),
          database
            .select({
              total: count(),
            })
            .from(emailOutbox)
            .where(
              and(
                inArray(emailOutbox.status, ['queued', 'failed']),
                isNull(emailOutbox.exhaustedAt),
                lte(emailOutbox.nextAttemptAt, now),
                sql`${emailOutbox.attempts} < ${emailOutbox.maxAttempts}`,
              ),
            ),
          database
            .select({
              total: count(),
            })
            .from(emailOutbox)
            .where(
              and(
                eq(emailOutbox.status, 'sending'),
                lte(emailOutbox.updatedAt, staleSendingBefore),
              ),
            ),
          database
            .select({
              total: count(),
            })
            .from(emailOutbox)
            .where(isNotNull(emailOutbox.exhaustedAt)),
          database
            .select({
              attempts: emailOutbox.attempts,
              createdAt: emailOutbox.createdAt,
              exhaustedAt: emailOutbox.exhaustedAt,
              id: emailOutbox.id,
              kind: emailOutbox.kind,
              lastAttemptAt: emailOutbox.lastAttemptAt,
              lastError: emailOutbox.lastError,
              maxAttempts: emailOutbox.maxAttempts,
              nextAttemptAt: emailOutbox.nextAttemptAt,
              recipient: emailOutbox.toEmail,
              sentAt: emailOutbox.sentAt,
              status: emailOutbox.status,
              subject: emailOutbox.subject,
              tenantDomain: tenants.domain,
              tenantId: emailOutbox.tenantId,
              tenantName: tenants.name,
              updatedAt: emailOutbox.updatedAt,
            })
            .from(emailOutbox)
            .innerJoin(tenants, eq(emailOutbox.tenantId, tenants.id))
            .where(inArray(emailOutbox.status, ['queued', 'sending', 'failed']))
            .orderBy(desc(emailOutbox.updatedAt))
            .limit(100),
        ]),
      );
      const summary = {
        exhausted: exhaustedRows[0]?.total ?? 0,
        failed: 0,
        queued: 0,
        sending: 0,
        sent: 0,
        staleSending: staleSendingRows[0]?.total ?? 0,
        waitingForRetry: waitingForRetryRows[0]?.total ?? 0,
      };
      for (const row of statusCounts) {
        summary[row.status] = row.total;
      }

      return Schema.decodeUnknownSync(GlobalAdminEmailOutboxOverview)({
        items: itemRows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          exhaustedAt: row.exhaustedAt?.toISOString() ?? null,
          lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
          nextAttemptAt: row.nextAttemptAt.toISOString(),
          sentAt: row.sentAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        })),
        summary,
      });
    }),
  'globalAdmin.tenants.create': (input, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'globalAdmin:manageTenants');
      const tenantInput = yield* normalizeTenantWritePayload(input);
      const existingDomainTenant = yield* databaseEffect((database) =>
        database.query.tenants.findFirst({
          columns: {
            id: true,
          },
          where: {
            domain: tenantInput.domain,
          },
        }),
      );
      if (existingDomainTenant) {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Tenant domain already exists',
            reason: tenantInput.domain,
          }),
        );
      }

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
        return yield* Effect.die(new Error('Tenant creation returned no rows'));
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
      const existingDomainTenant = yield* databaseEffect((database) =>
        database.query.tenants.findFirst({
          columns: {
            id: true,
          },
          where: {
            domain: tenantInput.domain,
          },
        }),
      );
      if (existingDomainTenant && existingDomainTenant.id !== id) {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Tenant domain already exists',
            reason: tenantInput.domain,
          }),
        );
      }

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
