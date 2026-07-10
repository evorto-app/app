import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { type Permission } from '@shared/permissions/permissions';
import { type PlatformAuditSnapshot } from '@shared/platform-audit';
import {
  type PlatformRoleCreateInput,
  type PlatformRoleDeleteInput,
  PlatformRoleRecord,
  type PlatformRoleUpdateInput,
  PlatformStripeTaxRateRecord,
  type PlatformTaxRatesImportInput,
  PlatformTenantUserRecord,
  type PlatformTenantUsersAssignRolesInput,
  type PlatformTenantUsersListInput,
  PlatformTenantUsersListResult,
} from '@shared/rpc-contracts/app-rpcs/platform-tenant-admin.rpcs';
import { and, count, eq, ilike, inArray } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { createHash } from 'node:crypto';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  roles,
  rolesToTenantUsers,
  tenants,
  tenantStripeTaxRates,
  users,
  usersToTenants,
} from '../../../../../db/schema';
import {
  ensureTenantRetainsAnotherDefaultUserRole,
  ensureTenantRoleIsUnreferenced,
  lockTenantRoleGraph,
} from '../../../../roles/tenant-role-graph';
import { StripeClient } from '../../../../stripe-client';
import {
  providePlatformOperation,
  resolvePlatformMutation,
  resolvePlatformRead,
  writePlatformAudit,
} from '../shared/platform-operation.service';

export interface StripeTaxRateSource {
  readonly active: boolean;
  readonly country: null | string;
  readonly display_name: null | string;
  readonly id: string;
  readonly inclusive: boolean;
  readonly percentage: null | number;
  readonly state: null | string;
}

interface NormalizedRoleWrite {
  readonly collapseMembersInHup: boolean;
  readonly defaultOrganizerRole: boolean;
  readonly defaultUserRole: boolean;
  readonly description: null | string;
  readonly displayInHub: boolean;
  readonly name: string;
  readonly permissions: Permission[];
}

type QueryDatabase = Pick<DatabaseClient, 'query'>;

type SelectDatabase = Pick<DatabaseClient, 'select'>;

interface StripeTaxRatePage {
  readonly data: readonly StripeTaxRateSource[];
  readonly hasMore: boolean;
}

export class PlatformTaxRateAuditRecord extends Schema.Class<PlatformTaxRateAuditRecord>(
  'PlatformTaxRateAuditRecord',
)({
  active: Schema.Boolean,
  country: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  inclusive: Schema.Boolean,
  percentage: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  stripeTaxRateId: Schema.NonEmptyString,
  tenantId: Schema.NonEmptyString,
}) {}

class PlatformTaxRateBatchAuditState extends Schema.Class<PlatformTaxRateBatchAuditState>(
  'PlatformTaxRateBatchAuditState',
)({
  rates: Schema.Array(PlatformTaxRateAuditRecord),
}) {}
class PlatformUserRoleAssignmentAuditState extends Schema.Class<PlatformUserRoleAssignmentAuditState>(
  'PlatformUserRoleAssignmentAuditState',
)({
  roleIds: Schema.Array(Schema.NonEmptyString),
  userId: Schema.NonEmptyString,
}) {}

const databaseEffect = <A, E, R>(
  operation: (database: DatabaseClient) => Effect.Effect<A, E, R>,
) =>
  Database.use((database) =>
    operation(database).pipe(
      Effect.catch((error) =>
        error instanceof RpcBadRequestError
          ? Effect.fail(error)
          : Effect.die(error),
      ),
    ),
  );

const roleNotFound = (roleId: string) =>
  new RpcBadRequestError({
    message: `Role ${roleId} was not found for the target tenant`,
    reason: 'roleNotFound',
  });

const missingStripeAccount = () =>
  new RpcBadRequestError({
    message: 'The target tenant does not have a connected Stripe account',
    reason: 'stripeAccountRequired',
  });

const lockTargetTenant = Effect.fn('PlatformTenantAdmin.lockTargetTenant')(
  function* (database: SelectDatabase, targetTenantId: string) {
    const lockedTenants = yield* database
      .select({
        id: tenants.id,
        stripeAccountId: tenants.stripeAccountId,
      })
      .from(tenants)
      .where(eq(tenants.id, targetTenantId))
      .for('update')
      .pipe(Effect.orDie);
    if (lockedTenants.length === 0) {
      return yield* Effect.die(
        new Error('Target tenant disappeared during platform operation'),
      );
    }

    return lockedTenants[0];
  },
);

export const normalizeTenantAssignableRolePermissions = Effect.fn(
  'PlatformTenantAdmin.normalizeTenantAssignableRolePermissions',
)(function* (permissions: readonly Permission[]) {
  if (permissions.some((permission) => permission.startsWith('globalAdmin:'))) {
    return yield* new RpcBadRequestError({
      message: 'Platform authority cannot be granted through a tenant role',
      reason: 'platformPermissionNotAssignable',
    });
  }

  return [...new Set(permissions)].toSorted();
});

export const ensureStripeAccountUnchanged = Effect.fn(
  'PlatformTenantAdmin.ensureStripeAccountUnchanged',
)(function* (
  expectedStripeAccountId: string,
  lockedStripeAccountId: null | string,
) {
  if (lockedStripeAccountId !== expectedStripeAccountId) {
    return yield* new RpcBadRequestError({
      message:
        'The target tenant Stripe account changed while tax rates were being loaded; retry the import',
      reason: 'stripeAccountChanged',
    });
  }
});

const normalizeRoleWrite = Effect.fn('PlatformTenantAdmin.normalizeRoleWrite')(
  function* (input: PlatformRoleCreateInput | PlatformRoleUpdateInput) {
    const name = input.name.trim();
    if (!name) {
      return yield* new RpcBadRequestError({
        message: 'Role name is required',
        reason: 'roleNameRequired',
      });
    }

    return {
      collapseMembersInHup: input.collapseMembersInHup,
      defaultOrganizerRole: input.defaultOrganizerRole,
      defaultUserRole: input.defaultUserRole,
      description: input.description?.trim() || null,
      displayInHub: input.displayInHub,
      name,
      permissions: yield* normalizeTenantAssignableRolePermissions(
        input.permissions,
      ),
    } satisfies NormalizedRoleWrite;
  },
);

const toPlatformRoleRecord = (role: {
  collapseMembersInHup: boolean;
  defaultOrganizerRole: boolean;
  defaultUserRole: boolean;
  description: null | string;
  displayInHub: boolean;
  id: string;
  name: string;
  permissions: Permission[];
  sortOrder: number;
}): PlatformRoleRecord => PlatformRoleRecord.make(role);

const loadPlatformRole = Effect.fn('PlatformTenantAdmin.loadPlatformRole')(
  function* (database: QueryDatabase, targetTenantId: string, roleId: string) {
    const role = yield* database.query.roles
      .findFirst({
        columns: {
          collapseMembersInHup: true,
          defaultOrganizerRole: true,
          defaultUserRole: true,
          description: true,
          displayInHub: true,
          id: true,
          name: true,
          permissions: true,
          sortOrder: true,
        },
        where: { id: roleId, tenantId: targetTenantId },
      })
      .pipe(Effect.orDie);
    if (!role) {
      return yield* roleNotFound(roleId);
    }

    return toPlatformRoleRecord(role);
  },
);

const lockPlatformRole = Effect.fn('PlatformTenantAdmin.lockPlatformRole')(
  function* (database: SelectDatabase, targetTenantId: string, roleId: string) {
    const matchingRoles = yield* database
      .select({
        collapseMembersInHup: roles.collapseMembersInHup,
        defaultOrganizerRole: roles.defaultOrganizerRole,
        defaultUserRole: roles.defaultUserRole,
        description: roles.description,
        displayInHub: roles.displayInHub,
        id: roles.id,
        name: roles.name,
        permissions: roles.permissions,
        sortOrder: roles.sortOrder,
      })
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, targetTenantId)))
      .for('update')
      .pipe(Effect.orDie);
    const role = matchingRoles[0];
    if (!role) {
      return yield* roleNotFound(roleId);
    }

    return toPlatformRoleRecord(role);
  },
);

const roleSnapshot = (role: PlatformRoleRecord): PlatformAuditSnapshot => ({
  resourceId: role.id,
  resourceType: 'role',
  state: {
    collapseMembersInHup: role.collapseMembersInHup,
    defaultOrganizerRole: role.defaultOrganizerRole,
    defaultUserRole: role.defaultUserRole,
    description: role.description,
    displayInHub: role.displayInHub,
    id: role.id,
    name: role.name,
    permissions: [...role.permissions],
    sortOrder: role.sortOrder,
  },
});

const userRoleAssignmentSnapshot = (
  userId: string,
  roleIds: readonly string[],
): PlatformAuditSnapshot => {
  const state = PlatformUserRoleAssignmentAuditState.make({
    roleIds: [...roleIds].toSorted(),
    userId,
  });

  return {
    resourceId: userId,
    resourceType: 'userRoleAssignment',
    state: {
      roleIds: [...state.roleIds],
      userId: state.userId,
    },
  };
};

export const platformTaxRateBatchAuditSnapshot = (
  resourceId: string,
  rates: readonly PlatformTaxRateAuditRecord[],
): PlatformAuditSnapshot => {
  const state = PlatformTaxRateBatchAuditState.make({
    rates: [...rates].toSorted((left, right) =>
      left.stripeTaxRateId.localeCompare(right.stripeTaxRateId),
    ),
  });

  return {
    resourceId,
    resourceType: 'taxRateBatch',
    state: {
      rates: state.rates.map((rate) => ({
        active: rate.active,
        country: rate.country,
        displayName: rate.displayName,
        id: rate.id,
        inclusive: rate.inclusive,
        percentage: rate.percentage,
        state: rate.state,
        stripeTaxRateId: rate.stripeTaxRateId,
        tenantId: rate.tenantId,
      })),
    },
  };
};

const taxRateBatchResourceId = (stripeTaxRateIds: readonly string[]): string =>
  createHash('sha256')
    .update(stripeTaxRateIds.toSorted().join('\u{0}'), 'utf8')
    .digest('hex');

export const normalizePlatformTenantUserSearch = (
  search: string | undefined,
): string | undefined => {
  const trimmed = search?.trim();
  const escaped = trimmed
    ?.replaceAll('\\', '\\\\')
    .replaceAll('%', String.raw`\%`)
    .replaceAll('_', String.raw`\_`);

  return escaped ? `%${escaped}%` : undefined;
};

export const uniqueSortedIds = (ids: readonly string[]): string[] =>
  [...new Set(ids)].toSorted();

const selectPlatformTaxRateAuditRecords = Effect.fn(
  'PlatformTenantAdmin.selectPlatformTaxRateAuditRecords',
)(function* (
  database: SelectDatabase,
  targetTenantId: string,
  stripeTaxRateIds: readonly string[],
) {
  const rates = yield* database
    .select({
      active: tenantStripeTaxRates.active,
      country: tenantStripeTaxRates.country,
      displayName: tenantStripeTaxRates.displayName,
      id: tenantStripeTaxRates.id,
      inclusive: tenantStripeTaxRates.inclusive,
      percentage: tenantStripeTaxRates.percentage,
      state: tenantStripeTaxRates.state,
      stripeTaxRateId: tenantStripeTaxRates.stripeTaxRateId,
      tenantId: tenantStripeTaxRates.tenantId,
    })
    .from(tenantStripeTaxRates)
    .where(
      and(
        eq(tenantStripeTaxRates.tenantId, targetTenantId),
        inArray(tenantStripeTaxRates.stripeTaxRateId, stripeTaxRateIds),
      ),
    );

  return rates.map((rate) => PlatformTaxRateAuditRecord.make(rate));
});

export const PLATFORM_STRIPE_TAX_RATE_MAX_PAGES = 20;

export const collectSupportedStripeTaxRatePages = Effect.fn(
  'PlatformTenantAdmin.collectSupportedStripeTaxRatePages',
)(function* <E, R>(
  loadPage: (
    startingAfter: string | undefined,
  ) => Effect.Effect<StripeTaxRatePage, E, R>,
  maxPages = PLATFORM_STRIPE_TAX_RATE_MAX_PAGES,
) {
  const supportedRates: StripeTaxRateSource[] = [];
  let startingAfter: string | undefined;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = yield* loadPage(startingAfter);
    supportedRates.push(
      ...page.data.filter((rate) => rate.active && rate.inclusive),
    );
    if (!page.hasMore) {
      return supportedRates;
    }

    const lastRate = page.data.at(-1);
    if (!lastRate) {
      return yield* Effect.die(
        new Error('Stripe returned an empty tax-rate page with has_more=true'),
      );
    }
    startingAfter = lastRate.id;
  }

  return yield* new RpcBadRequestError({
    message:
      'The target Stripe account has too many tax rates to list safely in one request',
    reason: 'stripeTaxRatePageLimitExceeded',
  });
});

const ensureRoleNameAvailable = Effect.fn(
  'PlatformTenantAdmin.ensureRoleNameAvailable',
)(function* (
  database: QueryDatabase,
  targetTenantId: string,
  name: string,
  excludedRoleId?: string,
) {
  const existingRole = yield* database.query.roles
    .findFirst({
      columns: { id: true },
      where: {
        name,
        tenantId: targetTenantId,
        ...(excludedRoleId && { id: { NOT: excludedRoleId } }),
      },
    })
    .pipe(Effect.orDie);
  if (existingRole) {
    return yield* new RpcBadRequestError({
      message: `A role named ${name} already exists for the target tenant`,
      reason: 'roleNameAlreadyExists',
    });
  }
});

const retrieveSupportedStripeTaxRate = Effect.fn(
  'PlatformTenantAdmin.retrieveSupportedStripeTaxRate',
)(function* (stripe: Stripe, stripeAccount: string, id: string) {
  const stripeRate = yield* Effect.tryPromise({
    catch: (error) => error,
    try: () => stripe.taxRates.retrieve(id, undefined, { stripeAccount }),
  }).pipe(
    Effect.catch((error) =>
      error instanceof Stripe.errors.StripeInvalidRequestError
        ? Effect.fail(
            new RpcBadRequestError({
              message: `Stripe tax rate ${id} was not found for the target tenant account`,
              reason: 'stripeTaxRateNotFound',
            }),
          )
        : Effect.die(error),
    ),
  );
  if (!stripeRate.active || !stripeRate.inclusive) {
    return yield* new RpcBadRequestError({
      message: `Stripe tax rate ${id} must be active and inclusive`,
      reason: 'unsupportedStripeTaxRate',
    });
  }

  return stripeRate;
});

const toPlatformStripeTaxRateRecord = (
  rate: StripeTaxRateSource,
  imported: boolean,
): PlatformStripeTaxRateRecord =>
  PlatformStripeTaxRateRecord.make({
    active: rate.active,
    country: rate.country ?? null,
    displayName: rate.display_name ?? null,
    id: rate.id,
    imported,
    inclusive: rate.inclusive,
    percentage: rate.percentage ?? null,
    state: rate.state ?? null,
  });

export const platformTenantAdminHandlers = {
  'platform.roles.create': (
    input: PlatformRoleCreateInput,
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformMutation(input);
      const normalized = yield* normalizeRoleWrite(input);

      return yield* providePlatformOperation(
        databaseEffect((database) =>
          database.transaction((transaction) =>
            Effect.gen(function* () {
              yield* lockTenantRoleGraph(transaction, input.targetTenantId);
              yield* lockTargetTenant(transaction, input.targetTenantId);
              yield* ensureRoleNameAvailable(
                transaction,
                input.targetTenantId,
                normalized.name,
              );

              const createdRoles = yield* transaction
                .insert(roles)
                .values({
                  ...normalized,
                  tenantId: input.targetTenantId,
                })
                .returning({
                  collapseMembersInHup: roles.collapseMembersInHup,
                  defaultOrganizerRole: roles.defaultOrganizerRole,
                  defaultUserRole: roles.defaultUserRole,
                  description: roles.description,
                  displayInHub: roles.displayInHub,
                  id: roles.id,
                  name: roles.name,
                  permissions: roles.permissions,
                  sortOrder: roles.sortOrder,
                })
                .pipe(Effect.orDie);
              const createdRole = createdRoles[0];
              if (!createdRole) {
                return yield* Effect.die(
                  new Error('Platform role creation returned no rows'),
                );
              }
              const after = toPlatformRoleRecord(createdRole);
              yield* writePlatformAudit(transaction, {
                action: 'role.create',
                after: roleSnapshot(after),
                before: null,
              });

              return after;
            }),
          ),
        ),
        operation,
        ['admin:manageRoles'],
      );
    }),
  'platform.roles.delete': (
    input: PlatformRoleDeleteInput,
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformMutation(input);

      return yield* providePlatformOperation(
        databaseEffect((database) =>
          database.transaction((transaction) =>
            Effect.gen(function* () {
              yield* lockTenantRoleGraph(transaction, input.targetTenantId);
              yield* lockTargetTenant(transaction, input.targetTenantId);
              const before = yield* lockPlatformRole(
                transaction,
                input.targetTenantId,
                input.roleId,
              );
              if (before.defaultUserRole) {
                yield* ensureTenantRetainsAnotherDefaultUserRole(
                  transaction,
                  input.targetTenantId,
                  input.roleId,
                );
              }
              yield* ensureTenantRoleIsUnreferenced(
                transaction,
                input.targetTenantId,
                input.roleId,
              );

              const deletedRoles = yield* transaction
                .delete(roles)
                .where(
                  and(
                    eq(roles.id, input.roleId),
                    eq(roles.tenantId, input.targetTenantId),
                  ),
                )
                .returning({ id: roles.id })
                .pipe(Effect.orDie);
              if (deletedRoles.length === 0) {
                return yield* Effect.die(
                  new Error('Locked platform role disappeared before delete'),
                );
              }
              yield* writePlatformAudit(transaction, {
                action: 'role.delete',
                after: null,
                before: roleSnapshot(before),
              });
            }),
          ),
        ),
        operation,
        ['admin:manageRoles'],
      );
    }),
  'platform.roles.findOne': (
    input: { readonly roleId: string; readonly targetTenantId: string },
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      return yield* providePlatformOperation(
        databaseEffect((database) =>
          loadPlatformRole(database, input.targetTenantId, input.roleId),
        ),
        operation,
        [],
      );
    }),
  'platform.roles.list': (
    input: { readonly targetTenantId: string },
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      return yield* providePlatformOperation(
        databaseEffect((database) =>
          database.query.roles
            .findMany({
              columns: {
                collapseMembersInHup: true,
                defaultOrganizerRole: true,
                defaultUserRole: true,
                description: true,
                displayInHub: true,
                id: true,
                name: true,
                permissions: true,
                sortOrder: true,
              },
              orderBy: (table, { asc }) => [asc(table.name), asc(table.id)],
              where: { tenantId: input.targetTenantId },
            })
            .pipe(
              Effect.orDie,
              Effect.map((tenantRoles) =>
                tenantRoles.map((role) => toPlatformRoleRecord(role)),
              ),
            ),
        ),
        operation,
        [],
      );
    }),
  'platform.roles.update': (
    input: PlatformRoleUpdateInput,
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformMutation(input);
      const normalized = yield* normalizeRoleWrite(input);

      return yield* providePlatformOperation(
        databaseEffect((database) =>
          database.transaction((transaction) =>
            Effect.gen(function* () {
              yield* lockTenantRoleGraph(transaction, input.targetTenantId);
              yield* lockTargetTenant(transaction, input.targetTenantId);
              const before = yield* lockPlatformRole(
                transaction,
                input.targetTenantId,
                input.roleId,
              );
              yield* ensureRoleNameAvailable(
                transaction,
                input.targetTenantId,
                normalized.name,
                input.roleId,
              );
              if (before.defaultUserRole && !normalized.defaultUserRole) {
                yield* ensureTenantRetainsAnotherDefaultUserRole(
                  transaction,
                  input.targetTenantId,
                  input.roleId,
                );
              }

              const updatedRoles = yield* transaction
                .update(roles)
                .set(normalized)
                .where(
                  and(
                    eq(roles.id, input.roleId),
                    eq(roles.tenantId, input.targetTenantId),
                  ),
                )
                .returning({
                  collapseMembersInHup: roles.collapseMembersInHup,
                  defaultOrganizerRole: roles.defaultOrganizerRole,
                  defaultUserRole: roles.defaultUserRole,
                  description: roles.description,
                  displayInHub: roles.displayInHub,
                  id: roles.id,
                  name: roles.name,
                  permissions: roles.permissions,
                  sortOrder: roles.sortOrder,
                })
                .pipe(Effect.orDie);
              const updatedRole = updatedRoles[0];
              if (!updatedRole) {
                return yield* Effect.die(
                  new Error('Locked platform role disappeared before update'),
                );
              }
              const after = toPlatformRoleRecord(updatedRole);
              yield* writePlatformAudit(transaction, {
                action: 'role.update',
                after: roleSnapshot(after),
                before: roleSnapshot(before),
              });

              return after;
            }),
          ),
        ),
        operation,
        ['admin:manageRoles'],
      );
    }),
  'platform.taxRates.import': (
    input: PlatformTaxRatesImportInput,
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformMutation(input);
      const stripeAccount = operation.targetTenant.stripeAccountId;
      if (!stripeAccount) {
        return yield* missingStripeAccount();
      }
      const ids = uniqueSortedIds(input.ids);
      const stripe = yield* StripeClient;
      const stripeRates = yield* Effect.forEach(
        ids,
        (id) => retrieveSupportedStripeTaxRate(stripe, stripeAccount, id),
        { concurrency: 10 },
      );
      const resourceId = taxRateBatchResourceId(ids);

      return yield* providePlatformOperation(
        databaseEffect((database) =>
          database.transaction((transaction) =>
            Effect.gen(function* () {
              const lockedTenant = yield* lockTargetTenant(
                transaction,
                input.targetTenantId,
              );
              yield* ensureStripeAccountUnchanged(
                stripeAccount,
                lockedTenant.stripeAccountId,
              );
              const before = yield* selectPlatformTaxRateAuditRecords(
                transaction,
                input.targetTenantId,
                ids,
              ).pipe(Effect.orDie);

              yield* Effect.forEach(
                stripeRates,
                (stripeRate) => {
                  const values = {
                    active: true,
                    country: stripeRate.country ?? null,
                    displayName: stripeRate.display_name ?? null,
                    inclusive: true,
                    percentage:
                      stripeRate.percentage === null
                        ? null
                        : String(stripeRate.percentage),
                    state: stripeRate.state ?? null,
                    stripeTaxRateId: stripeRate.id,
                    tenantId: input.targetTenantId,
                  };

                  return transaction
                    .insert(tenantStripeTaxRates)
                    .values(values)
                    .onConflictDoUpdate({
                      set: values,
                      target: [
                        tenantStripeTaxRates.tenantId,
                        tenantStripeTaxRates.stripeTaxRateId,
                      ],
                    })
                    .pipe(Effect.orDie);
                },
                { concurrency: 1, discard: true },
              );

              const after = yield* selectPlatformTaxRateAuditRecords(
                transaction,
                input.targetTenantId,
                ids,
              ).pipe(Effect.orDie);

              yield* writePlatformAudit(transaction, {
                action: 'taxRates.import',
                after: platformTaxRateBatchAuditSnapshot(resourceId, after),
                before: platformTaxRateBatchAuditSnapshot(resourceId, before),
              });
            }),
          ),
        ),
        operation,
        ['admin:tax'],
      );
    }),
  'platform.taxRates.listStripe': (
    input: { readonly targetTenantId: string },
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      const stripeAccount = operation.targetTenant.stripeAccountId;
      if (!stripeAccount) {
        return yield* missingStripeAccount();
      }
      const stripe = yield* StripeClient;

      return yield* providePlatformOperation(
        Effect.gen(function* () {
          const supportedRates = yield* collectSupportedStripeTaxRatePages(
            (startingAfter) =>
              Effect.tryPromise({
                catch: (error) => error,
                try: () =>
                  stripe.taxRates.list(
                    {
                      active: true,
                      limit: 100,
                      ...(startingAfter !== undefined && {
                        starting_after: startingAfter,
                      }),
                    },
                    { stripeAccount },
                  ),
              }).pipe(
                Effect.orDie,
                Effect.map((page) => ({
                  data: page.data,
                  hasMore: page.has_more,
                })),
              ),
          );
          if (supportedRates.length === 0) {
            return [];
          }

          const importedRates = yield* databaseEffect((database) =>
            database
              .select({
                stripeTaxRateId: tenantStripeTaxRates.stripeTaxRateId,
              })
              .from(tenantStripeTaxRates)
              .where(
                and(
                  eq(tenantStripeTaxRates.tenantId, input.targetTenantId),
                  inArray(
                    tenantStripeTaxRates.stripeTaxRateId,
                    supportedRates.map((rate) => rate.id),
                  ),
                ),
              ),
          );
          const importedIds = new Set(
            importedRates.map((rate) => rate.stripeTaxRateId),
          );

          return supportedRates
            .map((rate) =>
              toPlatformStripeTaxRateRecord(rate, importedIds.has(rate.id)),
            )
            .toSorted((left, right) =>
              (left.displayName ?? left.id).localeCompare(
                right.displayName ?? right.id,
              ),
            );
        }),
        operation,
        [],
      );
    }),
  'platform.tenantUsers.assignRoles': (
    input: PlatformTenantUsersAssignRolesInput,
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformMutation(input);
      const nextRoleIds = uniqueSortedIds(input.roleIds);

      return yield* providePlatformOperation(
        databaseEffect((database) =>
          database.transaction((transaction) =>
            Effect.gen(function* () {
              yield* lockTenantRoleGraph(transaction, input.targetTenantId);
              yield* lockTargetTenant(transaction, input.targetTenantId);
              const memberships = yield* transaction
                .select({ id: usersToTenants.id })
                .from(usersToTenants)
                .where(
                  and(
                    eq(usersToTenants.tenantId, input.targetTenantId),
                    eq(usersToTenants.userId, input.userId),
                  ),
                )
                .for('update')
                .pipe(Effect.orDie);
              const membership = memberships[0];
              if (!membership) {
                return yield* new RpcBadRequestError({
                  message: 'Tenant user membership was not found',
                  reason: 'tenantUserNotFound',
                });
              }

              const currentAssignments = yield* transaction
                .select({ roleId: rolesToTenantUsers.roleId })
                .from(rolesToTenantUsers)
                .where(
                  and(
                    eq(rolesToTenantUsers.tenantId, input.targetTenantId),
                    eq(rolesToTenantUsers.userTenantId, membership.id),
                  ),
                )
                .pipe(Effect.orDie);
              if (nextRoleIds.length > 0) {
                const targetRoles = yield* transaction.query.roles
                  .findMany({
                    columns: { id: true },
                    where: {
                      id: { in: nextRoleIds },
                      tenantId: input.targetTenantId,
                    },
                  })
                  .pipe(Effect.orDie);
                if (targetRoles.length !== nextRoleIds.length) {
                  return yield* new RpcBadRequestError({
                    message:
                      'One or more roles were not found for the target tenant',
                    reason: 'roleNotFound',
                  });
                }
              }

              yield* transaction
                .delete(rolesToTenantUsers)
                .where(
                  and(
                    eq(rolesToTenantUsers.tenantId, input.targetTenantId),
                    eq(rolesToTenantUsers.userTenantId, membership.id),
                  ),
                )
                .pipe(Effect.orDie);
              if (nextRoleIds.length > 0) {
                yield* transaction
                  .insert(rolesToTenantUsers)
                  .values(
                    nextRoleIds.map((roleId) => ({
                      roleId,
                      tenantId: input.targetTenantId,
                      userTenantId: membership.id,
                    })),
                  )
                  .pipe(Effect.orDie);
              }

              yield* writePlatformAudit(transaction, {
                action: 'user.assignRoles',
                after: userRoleAssignmentSnapshot(input.userId, nextRoleIds),
                before: userRoleAssignmentSnapshot(
                  input.userId,
                  currentAssignments.map((assignment) => assignment.roleId),
                ),
              });
            }),
          ),
        ),
        operation,
        ['users:assignRoles'],
      );
    }),
  'platform.tenantUsers.list': (
    input: PlatformTenantUsersListInput,
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      const search = normalizePlatformTenantUserSearch(input.search);
      const usersFilter = search
        ? and(
            eq(usersToTenants.tenantId, input.targetTenantId),
            ilike(users.searchableInfo, search),
          )
        : eq(usersToTenants.tenantId, input.targetTenantId);

      return yield* providePlatformOperation(
        databaseEffect((database) =>
          Effect.gen(function* () {
            const usersCountResult = yield* database
              .select({ total: count() })
              .from(usersToTenants)
              .innerJoin(users, eq(usersToTenants.userId, users.id))
              .where(usersFilter)
              .pipe(Effect.orDie);
            const usersCount = usersCountResult[0]?.total ?? 0;
            const tenantUsers = yield* database
              .select({
                email: users.email,
                firstName: users.firstName,
                id: users.id,
                lastName: users.lastName,
                userTenantId: usersToTenants.id,
              })
              .from(usersToTenants)
              .innerJoin(users, eq(usersToTenants.userId, users.id))
              .where(usersFilter)
              .orderBy(users.lastName, users.firstName, users.id)
              .offset(input.offset ?? 0)
              .limit(input.limit ?? 100)
              .pipe(Effect.orDie);
            if (tenantUsers.length === 0) {
              return PlatformTenantUsersListResult.make({
                users: [],
                usersCount,
              });
            }

            const tenantUserIds = tenantUsers.map(
              (tenantUser) => tenantUser.userTenantId,
            );
            const selectedRoles = yield* database
              .select({
                name: roles.name,
                roleId: roles.id,
                userTenantId: rolesToTenantUsers.userTenantId,
              })
              .from(rolesToTenantUsers)
              .innerJoin(
                roles,
                and(
                  eq(roles.id, rolesToTenantUsers.roleId),
                  eq(roles.tenantId, input.targetTenantId),
                ),
              )
              .where(
                and(
                  eq(rolesToTenantUsers.tenantId, input.targetTenantId),
                  inArray(rolesToTenantUsers.userTenantId, tenantUserIds),
                ),
              )
              .orderBy(roles.name, roles.id)
              .pipe(Effect.orDie);
            const rolesByMembershipId = new Map<
              string,
              { roleIds: string[]; roles: string[] }
            >();
            for (const role of selectedRoles) {
              const membershipRoles = rolesByMembershipId.get(
                role.userTenantId,
              ) ?? { roleIds: [], roles: [] };
              membershipRoles.roleIds.push(role.roleId);
              membershipRoles.roles.push(role.name);
              rolesByMembershipId.set(role.userTenantId, membershipRoles);
            }

            return PlatformTenantUsersListResult.make({
              users: tenantUsers.map((tenantUser) => {
                const membershipRoles = rolesByMembershipId.get(
                  tenantUser.userTenantId,
                ) ?? { roleIds: [], roles: [] };

                return PlatformTenantUserRecord.make({
                  email: tenantUser.email,
                  firstName: tenantUser.firstName,
                  id: tenantUser.id,
                  lastName: tenantUser.lastName,
                  roleIds: membershipRoles.roleIds,
                  roles: membershipRoles.roles,
                });
              }),
              usersCount,
            });
          }),
        ),
        operation,
        [],
      );
    }),
};
