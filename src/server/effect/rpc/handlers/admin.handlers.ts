import type { Headers } from 'effect/unstable/http';

import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  AdminRoleNotFoundError,
  AdminTenantNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/admin.errors';
import {
  resolveTenantReceiptSettings,
  type TenantDiscountProviders,
} from '@shared/tenant-config';
import { and, eq } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import type {
  AdminHubRoleRecord,
  AdminTenantBrandAssetKind,
} from '../../../../shared/rpc-contracts/app-rpcs/admin.rpcs';
import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { roles, tenants, tenantStripeTaxRates } from '../../../../db/schema';
import {
  includesPermission,
  partitionTenantRolePermissions,
  type Permission,
} from '../../../../shared/permissions/permissions';
import { ConfigPermissions } from '../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { Tenant } from '../../../../types/custom/tenant';
import { User } from '../../../../types/custom/user';
import { normalizeEsnCardConfig } from '../../../discounts/discount-provider-config';
import {
  normalizeTenantPrivacyPolicy,
  publishPrivacyPolicyVersionIfChanged,
} from '../../../onboarding/tenant-onboarding.service';
import { tenantHasPendingStripeObligations } from '../../../payments/pending-stripe-obligations';
import {
  ensureTenantRetainsAnotherDefaultUserRole,
  ensureTenantRoleIsUnreferenced,
  lockTenantRoleGraph,
} from '../../../roles/tenant-role-graph';
import { StripeClient } from '../../../stripe-client';
import { uploadTenantBrandAsset } from '../../../tenant-brand-assets';
import {
  tenantCurrencyChangeBlockedErrorDetails,
  tenantHasCurrencyDependentData,
} from '../../../tenant-currency-integrity';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const databaseRoleEffect = <A, R>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, R>,
) =>
  Database.use((database) =>
    operation(database).pipe(
      Effect.catch((error) =>
        error instanceof AdminRoleNotFoundError ||
        error instanceof RpcBadRequestError
          ? Effect.fail(error)
          : Effect.die(error),
      ),
    ),
  );

const decodeHeaderJson = <S extends Schema.ConstraintDecoder<unknown>>(
  value: string | undefined,
  schema: S,
): S['Type'] =>
  Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const normalizeOptionalUrl = (
  value: string | undefined,
  fieldName: string,
): null | string => {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    const url = new URL(trimmedValue);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('URL must use http or https');
    }

    return url.toString();
  } catch (error) {
    throw new Error(
      `${fieldName} must be a valid http or https URL${
        error instanceof Error ? `: ${error.message}` : ''
      }`,
      { cause: error },
    );
  }
};

const decodeTenantAssetSegment = (value: string): string | undefined => {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes('/') || decoded.includes('\\')
      ? undefined
      : decoded;
  } catch {
    return;
  }
};

const normalizeTenantAssetPath = (
  value: string,
  expected: {
    kind: AdminTenantBrandAssetKind;
    tenantId: string;
  },
): string | undefined => {
  const parsed = new URL(value, 'https://tenant-assets.invalid');
  if (
    parsed.origin !== 'https://tenant-assets.invalid' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return;
  }

  const match = /^\/tenant-assets\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(
    parsed.pathname,
  );
  const tenantId = match?.[1] ? decodeTenantAssetSegment(match[1]) : undefined;
  const kind = match?.[2] ? decodeTenantAssetSegment(match[2]) : undefined;
  const fileName = match?.[3] ? decodeTenantAssetSegment(match[3]) : undefined;
  if (
    !tenantId ||
    kind !== expected.kind ||
    tenantId !== expected.tenantId ||
    !fileName
  ) {
    return;
  }

  return `/tenant-assets/${encodeURIComponent(tenantId)}/${kind}/${encodeURIComponent(fileName)}`;
};

const normalizeOptionalBrandAssetUrl = (
  value: string | undefined,
  options: {
    fieldName: string;
    kind: AdminTenantBrandAssetKind;
    tenantId: string;
  },
): null | string => {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return null;
  }

  if (trimmedValue.startsWith('/')) {
    const assetPath = normalizeTenantAssetPath(trimmedValue, options);
    if (assetPath) {
      return assetPath;
    }

    throw new Error(
      `${options.fieldName} must be an uploaded ${options.kind} path for the current tenant or a valid http or https URL`,
    );
  }

  return normalizeOptionalUrl(trimmedValue, options.fieldName);
};

const normalizeTenantLegalLinks = (input: {
  legalNoticeText?: string | undefined;
  legalNoticeUrl?: string | undefined;
  privacyPolicyText?: string | undefined;
  privacyPolicyUrl?: string | undefined;
  termsText?: string | undefined;
  termsUrl?: string | undefined;
}) => ({
  legalNoticeText: input.legalNoticeText?.trim() || null,
  legalNoticeUrl: normalizeOptionalUrl(input.legalNoticeUrl, 'legalNoticeUrl'),
  privacyPolicyText: input.privacyPolicyText?.trim() || null,
  privacyPolicyUrl: normalizeOptionalUrl(
    input.privacyPolicyUrl,
    'privacyPolicyUrl',
  ),
  termsText: input.termsText?.trim() || null,
  termsUrl: normalizeOptionalUrl(input.termsUrl, 'termsUrl'),
});

const normalizeTenantBrandAssets = (
  input: {
    faviconUrl?: string | undefined;
    logoUrl?: string | undefined;
  },
  tenantId: string,
) => ({
  faviconUrl: normalizeOptionalBrandAssetUrl(input.faviconUrl, {
    fieldName: 'faviconUrl',
    kind: 'favicon',
    tenantId,
  }),
  logoUrl: normalizeOptionalBrandAssetUrl(input.logoUrl, {
    fieldName: 'logoUrl',
    kind: 'logo',
    tenantId,
  }),
});

const normalizeMaxActiveRegistrationsPerUser = (value: number): number =>
  Math.max(0, Math.trunc(value));

type TenantRuntimeDependentDataDatabase = Pick<DatabaseClient, 'query'>;

const tenantHasRuntimeDependentData = (
  database: TenantRuntimeDependentDataDatabase,
  tenantId: string,
): Effect.Effect<boolean, unknown> =>
  Effect.gen(function* () {
    const existingEvent = yield* database.query.eventInstances.findFirst({
      columns: {
        id: true,
      },
      where: {
        tenantId,
      },
    });
    if (existingEvent) {
      return true;
    }

    const existingTransaction = yield* database.query.transactions.findFirst({
      columns: {
        id: true,
      },
      where: {
        tenantId,
      },
    });

    return !!existingTransaction;
  });

const tenantRuntimeSettingsLockedError = () =>
  new RpcBadRequestError({
    message: 'Tenant currency and timezone settings are locked',
    reason:
      'Currency and timezone cannot be changed after event or payment data exists.',
  });

const tenantCurrencySettingsLockedError = () =>
  new RpcBadRequestError(tenantCurrencyChangeBlockedErrorDetails);

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

const normalizeAdminRoleRecord = <
  Role extends { permissions: readonly Permission[] },
>(
  role: Role,
) => ({
  ...role,
  permissions: partitionTenantRolePermissions(role.permissions).accepted,
});

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, RpcUnauthorizedError> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail(
        new RpcUnauthorizedError({ message: 'Authentication required' }),
      );

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

export const adminHandlers = {
  'admin.roles.create': (input, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'admin:manageRoles');
      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
      const createdRoles = yield* databaseRoleEffect((database) =>
        database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* lockTenantRoleGraph(transaction, tenant.id);

            return yield* transaction
              .insert(roles)
              .values({
                collapseMembersInHup: input.collapseMembersInHup,
                defaultOrganizerRole: input.defaultOrganizerRole,
                defaultUserRole: input.defaultUserRole,
                description: input.description,
                displayInHub: input.displayInHub,
                name: input.name,
                permissions: input.permissions,
                tenantId: tenant.id,
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
              });
          }),
        ),
      );
      const createdRole = createdRoles[0];
      if (!createdRole) {
        return yield* Effect.die(new Error('Role insert returned no rows'));
      }

      return normalizeAdminRoleRecord(createdRole);
    }),
  'admin.roles.delete': ({ id }, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'admin:manageRoles');
      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
      yield* databaseRoleEffect((database) =>
        database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* lockTenantRoleGraph(transaction, tenant.id);
            const lockedRoles = yield* transaction
              .select({
                defaultUserRole: roles.defaultUserRole,
                id: roles.id,
              })
              .from(roles)
              .where(and(eq(roles.id, id), eq(roles.tenantId, tenant.id)))
              .for('update');
            const lockedRole = lockedRoles[0];
            if (!lockedRole) {
              return yield* new AdminRoleNotFoundError({
                id,
                message: 'Role not found',
              });
            }
            if (lockedRole.defaultUserRole) {
              yield* ensureTenantRetainsAnotherDefaultUserRole(
                transaction,
                tenant.id,
                id,
              );
            }
            yield* ensureTenantRoleIsUnreferenced(transaction, tenant.id, id);

            const deletedRoles = yield* transaction
              .delete(roles)
              .where(and(eq(roles.id, id), eq(roles.tenantId, tenant.id)))
              .returning({ id: roles.id });
            if (deletedRoles.length === 0) {
              return yield* Effect.die(
                new Error('Locked role disappeared before delete'),
              );
            }
          }),
        ),
      );
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
      yield* ensurePermission(options.headers, 'admin:manageRoles');
      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
      const tenantRoles = yield* databaseEffect((database) =>
        database.query.roles.findMany({
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

      return tenantRoles.map((role) => normalizeAdminRoleRecord(role));
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
          where: { id, tenantId: tenant.id },
        }),
      );
      if (!role) {
        return yield* Effect.fail(
          new AdminRoleNotFoundError({ id, message: 'Role not found' }),
        );
      }

      return normalizeAdminRoleRecord(role);
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
          limit: 15,
          orderBy: { name: 'asc' },
          where: {
            name: { ilike: `%${search}%` },
            tenantId: tenant.id,
          },
        }),
      );

      return matchingRoles.map((role) => normalizeAdminRoleRecord(role));
    }),
  'admin.roles.update': ({ id, ...input }, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'admin:manageRoles');
      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
      const updatedRoles = yield* databaseRoleEffect((database) =>
        database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* lockTenantRoleGraph(transaction, tenant.id);
            const lockedRoles = yield* transaction
              .select({
                defaultUserRole: roles.defaultUserRole,
                id: roles.id,
              })
              .from(roles)
              .where(and(eq(roles.id, id), eq(roles.tenantId, tenant.id)))
              .for('update');
            const lockedRole = lockedRoles[0];
            if (!lockedRole) {
              return yield* new AdminRoleNotFoundError({
                id,
                message: 'Role not found',
              });
            }
            if (lockedRole.defaultUserRole && !input.defaultUserRole) {
              yield* ensureTenantRetainsAnotherDefaultUserRole(
                transaction,
                tenant.id,
                id,
              );
            }

            return yield* transaction
              .update(roles)
              .set({
                collapseMembersInHup: input.collapseMembersInHup,
                defaultOrganizerRole: input.defaultOrganizerRole,
                defaultUserRole: input.defaultUserRole,
                description: input.description,
                displayInHub: input.displayInHub,
                name: input.name,
                permissions: input.permissions,
              })
              .where(and(eq(roles.id, id), eq(roles.tenantId, tenant.id)))
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
              });
          }),
        ),
      );
      const updatedRole = updatedRoles[0];
      if (!updatedRole) {
        return yield* Effect.fail(
          new AdminRoleNotFoundError({ id, message: 'Role not found' }),
        );
      }

      return normalizeAdminRoleRecord(updatedRole);
    }),
  'admin.tenant.importStripeTaxRates': ({ ids }, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'admin:tax');
      const stripe = yield* StripeClient;
      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
      const stripeAccount = tenant.stripeAccountId;
      if (!stripeAccount) {
        return;
      }

      const stripeRates = yield* Effect.all(
        ids.map((id) =>
          Effect.promise(() =>
            stripe.taxRates.retrieve(id, undefined, { stripeAccount }),
          ).pipe(
            Effect.flatMap((stripeRate) =>
              stripeRate.inclusive
                ? Effect.succeed(stripeRate)
                : Effect.fail(
                    new RpcBadRequestError({
                      message: 'Stripe tax rate must be inclusive',
                      reason: 'nonInclusiveTaxRate',
                    }),
                  ),
            ),
          ),
        ),
      );

      yield* databaseEffect((database) =>
        database.transaction((tx) =>
          Effect.all(
            stripeRates.map((stripeRate) =>
              Effect.gen(function* () {
                const existingRate =
                  yield* tx.query.tenantStripeTaxRates.findFirst({
                    columns: {
                      id: true,
                    },
                    where: {
                      stripeTaxRateId: stripeRate.id,
                      tenantId: tenant.id,
                    },
                  });

                const values: Omit<
                  typeof tenantStripeTaxRates.$inferInsert,
                  'id'
                > = {
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
                  ? tx
                      .update(tenantStripeTaxRates)
                      .set(values)
                      .where(eq(tenantStripeTaxRates.id, existingRate.id))
                  : tx.insert(tenantStripeTaxRates).values(values);
              }),
            ),
          ).pipe(Effect.asVoid),
        ),
      );
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

      return importedTaxRates;
    }),
  'admin.tenant.listStripeTaxRates': (_payload, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'admin:tax');
      const stripe = yield* StripeClient;
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
          stripe.taxRates.list({ active: true, limit: 100 }, { stripeAccount }),
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
            catch: (error) =>
              new RpcBadRequestError({
                message: 'Invalid ESN card configuration',
                reason: error instanceof Error ? error.message : String(error),
              }),
            try: () =>
              normalizeEsnCardConfig(
                { buyEsnCardUrl: input.buyEsnCardUrl },
                { rejectInvalidUrl: true },
              ),
          }),
          status: input.esnCardEnabled ? 'enabled' : 'disabled',
        },
      };
      const legalLinks = yield* Effect.try({
        catch: (error) =>
          new RpcBadRequestError({
            message: 'Invalid tenant legal links',
            reason: error instanceof Error ? error.message : String(error),
          }),
        try: () => normalizeTenantLegalLinks(input),
      });
      const privacyPolicy = yield* normalizeTenantPrivacyPolicy({
        privacyPolicyText: legalLinks.privacyPolicyText ?? '',
        privacyPolicyUrl: legalLinks.privacyPolicyUrl ?? '',
      }).pipe(
        Effect.mapError(
          (error) =>
            new RpcBadRequestError({
              message: 'Invalid tenant privacy policy',
              reason: error.message,
            }),
        ),
      );
      const currentUser = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.USER],
        Schema.NullOr(User),
      );
      const brandAssets = yield* Effect.try({
        catch: (error) =>
          new RpcBadRequestError({
            message: 'Invalid tenant brand assets',
            reason: error instanceof Error ? error.message : String(error),
          }),
        try: () => normalizeTenantBrandAssets(input, tenant.id),
      });
      const nextTenant = {
        ...tenant,
        ...brandAssets,
        cancellationDeadlineHoursBeforeStart:
          input.cancellationDeadlineHoursBeforeStart,
        currency: input.currency,
        defaultLocation: input.defaultLocation,
        discountProviders,
        emailSenderEmail: input.emailSenderEmail?.trim() || null,
        emailSenderName: input.emailSenderName?.trim() || null,
        ...legalLinks,
        maxActiveRegistrationsPerUser: normalizeMaxActiveRegistrationsPerUser(
          input.maxActiveRegistrationsPerUser,
        ),
        receiptSettings: resolveTenantReceiptSettings({
          allowOther: input.allowOther,
          receiptCountries: input.receiptCountries,
        }),
        refundFeesOnCancellation: input.refundFeesOnCancellation,
        seoDescription: input.seoDescription?.trim() || null,
        seoTitle: input.seoTitle?.trim() || null,
        stripeAccountId: input.stripeAccountId?.trim() || null,
        theme: input.theme,
        timezone: input.timezone,
        transferDeadlineHoursBeforeStart:
          input.transferDeadlineHoursBeforeStart,
      };

      const validatedTenant = yield* Effect.try({
        catch: (error) =>
          new RpcBadRequestError({
            message: 'Updated tenant settings failed validation',
            reason: error instanceof Error ? error.message : String(error),
          }),
        try: () => Schema.decodeUnknownSync(Tenant)(nextTenant),
      });

      const tenantUpdate = {
        ...brandAssets,
        cancellationDeadlineHoursBeforeStart:
          input.cancellationDeadlineHoursBeforeStart,
        currency: input.currency,
        defaultLocation: input.defaultLocation,
        discountProviders,
        emailSenderEmail: input.emailSenderEmail?.trim() || null,
        emailSenderName: input.emailSenderName?.trim() || null,
        ...legalLinks,
        maxActiveRegistrationsPerUser: normalizeMaxActiveRegistrationsPerUser(
          input.maxActiveRegistrationsPerUser,
        ),
        receiptSettings: resolveTenantReceiptSettings({
          allowOther: input.allowOther,
          receiptCountries: input.receiptCountries,
        }),
        refundFeesOnCancellation: input.refundFeesOnCancellation,
        seoDescription: input.seoDescription?.trim() || null,
        seoTitle: input.seoTitle?.trim() || null,
        stripeAccountId: input.stripeAccountId?.trim() || null,
        theme: input.theme,
        timezone: input.timezone,
        transferDeadlineHoursBeforeStart:
          input.transferDeadlineHoursBeforeStart,
      };
      const updatedTenants = yield* Database.use((database) =>
        database
          .transaction((tx) =>
            Effect.gen(function* () {
              const lockedTenantRows = yield* tx
                .select({
                  currency: tenants.currency,
                  id: tenants.id,
                  stripeAccountId: tenants.stripeAccountId,
                  timezone: tenants.timezone,
                })
                .from(tenants)
                .where(eq(tenants.id, tenant.id))
                .for('update');

              const lockedTenant = lockedTenantRows[0];
              if (!lockedTenant) {
                return [];
              }

              if (
                lockedTenant.stripeAccountId !== tenantUpdate.stripeAccountId
              ) {
                const hasPendingStripeObligations =
                  yield* tenantHasPendingStripeObligations(tx, tenant.id);
                if (hasPendingStripeObligations) {
                  return yield* new RpcBadRequestError({
                    message:
                      'Stripe account cannot change while registration Checkouts or refunds are pending',
                    reason:
                      'Complete or cancel every pending Checkout and refund before changing the connected account.',
                  });
                }
              }

              if (lockedTenant.currency !== input.currency) {
                const hasCurrencyDependentData =
                  yield* tenantHasCurrencyDependentData(tx, tenant.id);
                if (hasCurrencyDependentData) {
                  return yield* Effect.fail(
                    tenantCurrencySettingsLockedError(),
                  );
                }
              }

              if (lockedTenant.timezone !== input.timezone) {
                const hasDependentData = yield* tenantHasRuntimeDependentData(
                  tx,
                  tenant.id,
                );
                if (hasDependentData) {
                  return yield* Effect.fail(tenantRuntimeSettingsLockedError());
                }
              }

              yield* publishPrivacyPolicyVersionIfChanged(tx, {
                actorUserId: currentUser?.id ?? null,
                policy: privacyPolicy,
                tenantId: tenant.id,
              });

              return yield* tx
                .update(tenants)
                .set(tenantUpdate)
                .where(eq(tenants.id, tenant.id))
                .returning({
                  id: tenants.id,
                });
            }),
          )
          .pipe(
            Effect.catch((error) =>
              error instanceof RpcBadRequestError
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );
      const updatedTenant = updatedTenants[0];
      if (!updatedTenant) {
        return yield* Effect.fail(
          new AdminTenantNotFoundError({
            id: tenant.id,
            message: 'Tenant not found or stale',
          }),
        );
      }

      return validatedTenant;
    }),
  'admin.tenant.uploadBrandAsset': (input, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'admin:changeSettings');
      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );

      return yield* uploadTenantBrandAsset({
        fileBase64: input.fileBase64,
        fileName: input.fileName,
        fileSizeBytes: input.fileSizeBytes,
        kind: input.kind,
        mimeType: input.mimeType,
        tenantId: tenant.id,
      });
    }),
} satisfies Partial<AppRpcHandlers>;
