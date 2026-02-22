 

import type { Headers } from '@effect/platform';

import {
  resolveTenantReceiptSettings,
  type TenantDiscountProviders,
} from '@shared/tenant-config';
import {
  and,
  eq,
} from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  roles,
  tenants,
  tenantStripeTaxRates,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  type AdminHubRoleRecord,
  type AdminRoleRecord,
} from '../../../../../shared/rpc-contracts/app-rpcs/admin.rpcs';
import { ConfigPermissions } from '../../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { Tenant } from '../../../../../types/custom/tenant';
import { normalizeEsnCardConfig } from '../../../../discounts/discount-provider-config';
import { stripe } from '../../../../stripe-client';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.pipe(Effect.flatMap((database) => operation(database).pipe(Effect.orDie)));

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const normalizeRoleRecord = (
  role: Pick<
    typeof roles.$inferSelect,
    | 'collapseMembersInHup'
    | 'defaultOrganizerRole'
    | 'defaultUserRole'
    | 'description'
    | 'displayInHub'
    | 'id'
    | 'name'
    | 'permissions'
    | 'showInHub'
    | 'sortOrder'
  >,
): AdminRoleRecord => ({
  collapseMembersInHup: role.collapseMembersInHup,
  defaultOrganizerRole: role.defaultOrganizerRole,
  defaultUserRole: role.defaultUserRole,
  description: role.description ?? null,
  displayInHub: role.displayInHub,
  id: role.id,
  name: role.name,
  permissions: role.permissions,
  showInHub: role.showInHub,
  sortOrder: role.sortOrder,
});

const normalizeHubRoleRecord = (role: {
  description: null | string;
  id: string;
  name: string;
  usersToTenants: readonly {
    user: null | {
      firstName: string;
      id: string;
      lastName: string;
    };
  }[];
}): AdminHubRoleRecord => {
  const users = role.usersToTenants.flatMap((membership) =>
    membership.user ? [membership.user] : [],
  );

  return {
    description: role.description ?? null,
    id: role.id,
    name: role.name,
    userCount: users.length,
    users,
  };
};

const normalizeTenantTaxRateRecord = (
  taxRate: Pick<
    typeof tenantStripeTaxRates.$inferSelect,
    | 'active'
    | 'country'
    | 'displayName'
    | 'inclusive'
    | 'percentage'
    | 'state'
    | 'stripeTaxRateId'
  >,
) => ({
  active: taxRate.active,
  country: taxRate.country ?? null,
  displayName: taxRate.displayName ?? null,
  inclusive: taxRate.inclusive,
  percentage: taxRate.percentage ?? null,
  state: taxRate.state ?? null,
  stripeTaxRateId: taxRate.stripeTaxRateId,
});

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, 'UNAUTHORIZED'> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail('UNAUTHORIZED' as const);

const ensurePermission = (
  headers: Headers.Headers,
  permission: Permission,
): Effect.Effect<void, 'FORBIDDEN' | 'UNAUTHORIZED'> =>
  Effect.gen(function* () {
    yield* ensureAuthenticated(headers);
    const currentPermissions = decodeHeaderJson(
      headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
      ConfigPermissions,
    );

    if (!currentPermissions.includes(permission)) {
      return yield* Effect.fail('FORBIDDEN' as const);
    }
  });

export const adminHandlers = {
    'admin.roles.create': (input, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'admin:manageRoles');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const createdRoles = yield* databaseEffect((database) =>
          database
            .insert(roles)
            .values({
              defaultOrganizerRole: input.defaultOrganizerRole,
              defaultUserRole: input.defaultUserRole,
              description: input.description,
              name: input.name,
              permissions: input.permissions,
              tenantId: tenant.id,
            })
            .returning(),
        );
        const createdRole = createdRoles[0];
        if (!createdRole) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        return normalizeRoleRecord(createdRole);
      }),
    'admin.roles.delete': ({ id }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'admin:manageRoles');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const deletedRoles = yield* databaseEffect((database) =>
          database
            .delete(roles)
            .where(and(eq(roles.id, id), eq(roles.tenantId, tenant.id)))
            .returning(),
        );
        if (deletedRoles.length === 0) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }
      }),
    'admin.roles.findHubRoles': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const hubRoles = yield* databaseEffect((database) =>
          database.query.roles.findMany({
            columns: {
              description: true,
              id: true,
              name: true,
            },
            orderBy: (roles_, { asc }) => [
              asc(roles_.sortOrder),
              asc(roles_.name),
            ],
            where: {
              displayInHub: true,
              tenantId: tenant.id,
            },
            with: {
              usersToTenants: {
                with: {
                  user: {
                    columns: {
                      firstName: true,
                      id: true,
                      lastName: true,
                    },
                  },
                },
              },
            },
          }),
        );

        return hubRoles.map((role) => normalizeHubRoleRecord(role));
      }),
    'admin.roles.findMany': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const tenantRoles = yield* databaseEffect((database) =>
          database.query.roles.findMany({
            orderBy: { name: 'asc' },
            where: {
              tenantId: tenant.id,
              ...(input.defaultUserRole !== undefined && {
                defaultUserRole: input.defaultUserRole,
              }),
              ...(input.defaultOrganizerRole !== undefined && {
                defaultOrganizerRole: input.defaultOrganizerRole,
              }),
            },
          }),
        );

        return tenantRoles.map((role) => normalizeRoleRecord(role));
      }),
    'admin.roles.findOne': ({ id }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'admin:manageRoles');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const role = yield* databaseEffect((database) =>
          database.query.roles.findFirst({
            where: { id, tenantId: tenant.id },
          }),
        );
        if (!role) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        return normalizeRoleRecord(role);
      }),
    'admin.roles.search': ({ search }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'admin:manageRoles');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const matchingRoles = yield* databaseEffect((database) =>
          database.query.roles.findMany({
            limit: 15,
            orderBy: { name: 'asc' },
            where: {
              name: { ilike: `%${search}%` },
              tenantId: tenant.id,
            },
          }),
        );

        return matchingRoles.map((role) => normalizeRoleRecord(role));
      }),
    'admin.roles.update': ({ id, ...input }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'admin:manageRoles');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const updatedRoles = yield* databaseEffect((database) =>
          database
            .update(roles)
            .set({
              defaultOrganizerRole: input.defaultOrganizerRole,
              defaultUserRole: input.defaultUserRole,
              description: input.description,
              name: input.name,
              permissions: input.permissions,
            })
            .where(and(eq(roles.id, id), eq(roles.tenantId, tenant.id)))
            .returning(),
        );
        const updatedRole = updatedRoles[0];
        if (!updatedRole) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        return normalizeRoleRecord(updatedRole);
      }),
    'admin.tenant.importStripeTaxRates': ({ ids }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'admin:tax');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const stripeAccount = tenant.stripeAccountId;
        if (!stripeAccount) {
          return;
        }

        for (const id of ids) {
          const stripeRate = yield* Effect.promise(() =>
            stripe.taxRates.retrieve(id, undefined, { stripeAccount }),
          );
          if (!stripeRate.inclusive) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          const existingRate = yield* databaseEffect((database) =>
          database.query.tenantStripeTaxRates.findFirst({
              where: {
                stripeTaxRateId: id,
                tenantId: tenant.id,
              },
            }),
          );

          const values: Omit<typeof tenantStripeTaxRates.$inferInsert, 'id'> = {
            active: !!stripeRate.active,
            country: stripeRate.country ?? null,
            displayName: stripeRate.display_name ?? null,
            inclusive: !!stripeRate.inclusive,
            percentage:
              stripeRate.percentage !== null &&
              stripeRate.percentage !== undefined
                ? String(stripeRate.percentage)
                : undefined,
            state: stripeRate.state ?? null,
            stripeTaxRateId: stripeRate.id,
            tenantId: tenant.id,
          };

          yield* existingRate
            ? databaseEffect((database) =>
          database
                  .update(tenantStripeTaxRates)
                  .set(values)
                  .where(eq(tenantStripeTaxRates.id, existingRate.id)),
              )
            : databaseEffect((database) =>
          database.insert(tenantStripeTaxRates).values(values),
              );
        }
      }),
    'admin.tenant.listImportedTaxRates': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'admin:tax');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const importedTaxRates = yield* databaseEffect((database) =>
          database.query.tenantStripeTaxRates.findMany({
            columns: {
              active: true,
              country: true,
              displayName: true,
              inclusive: true,
              percentage: true,
              state: true,
              stripeTaxRateId: true,
            },
            where: { tenantId: tenant.id },
          }),
        );

        return importedTaxRates.map((taxRate) =>
          normalizeTenantTaxRateRecord(taxRate),
        );
      }),
    'admin.tenant.listStripeTaxRates': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'admin:tax');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const stripeAccount = tenant.stripeAccountId;
        if (!stripeAccount) {
          return [];
        }

        const [activeRates, archivedRates] = yield* Effect.promise(() =>
          Promise.all([
            stripe.taxRates.list(
              { active: true, limit: 100 },
              { stripeAccount },
            ),
            stripe.taxRates.list(
              { active: false, limit: 100 },
              { stripeAccount },
            ),
          ]),
        );
        const mapRate = (rate: (typeof activeRates)['data'][number]) => ({
          active: !!rate.active,
          country: rate.country ?? null,
          displayName: rate.display_name ?? null,
          id: rate.id,
          inclusive: !!rate.inclusive,
          percentage: rate.percentage ?? null,
          state: rate.state ?? null,
        });

        return [
          ...activeRates.data.map((rate) => mapRate(rate)),
          ...archivedRates.data.map((rate) => mapRate(rate)),
        ];
      }),
    'admin.tenant.updateSettings': (input, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'admin:changeSettings');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const discountProviders: TenantDiscountProviders = {
          esnCard: {
            config: yield* Effect.try({
              catch: () => 'BAD_REQUEST' as const,
              try: () =>
                normalizeEsnCardConfig(
                  { buyEsnCardUrl: input.buyEsnCardUrl },
                  { rejectInvalidUrl: true },
                ),
            }),
            status: input.esnCardEnabled ? 'enabled' : 'disabled',
          },
        };

        const updatedTenants = yield* databaseEffect((database) =>
          database
            .update(tenants)
            .set({
              defaultLocation: input.defaultLocation,
              discountProviders,
              receiptSettings: resolveTenantReceiptSettings({
                allowOther: input.allowOther,
                receiptCountries: input.receiptCountries,
              }),
              theme: input.theme,
            })
            .where(eq(tenants.id, tenant.id))
            .returning(),
        );
        const updatedTenant = updatedTenants[0];
        if (!updatedTenant) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        return yield* Effect.try({
          catch: () => 'FORBIDDEN' as const,
          try: () => Schema.decodeUnknownSync(Tenant)(updatedTenant),
        });
      }),
} satisfies Partial<AppRpcHandlers>;
