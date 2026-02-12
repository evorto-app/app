import type { Headers } from '@effect/platform';

import {
  resolveTenantDiscountProviders,
  resolveTenantReceiptSettings,
  type TenantDiscountProviders,
} from '@shared/tenant-config';
import consola from 'consola';
import { and, count, eq } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { database } from '../../../db';
import {
  eventInstances,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  icons,
  roles,
  rolesToTenantUsers,
  tenants,
  tenantStripeTaxRates,
  userDiscountCards,
  users,
  usersToTenants,
} from '../../../db/schema';
import { type Permission } from '../../../shared/permissions/permissions';
import {
  type AdminHubRoleRecord,
  type AdminRoleRecord,
  AppRpcs,
  ConfigPermissions,
  type IconRecord,
  type IconRpcError,
  type TemplateCategoryRecord,
  type TemplateListRecord,
  type TemplatesByCategoryRecord,
  UsersAuthData,
} from '../../../shared/rpc-contracts/app-rpcs';
import { Tenant } from '../../../types/custom/tenant';
import { User } from '../../../types/custom/user';
import { serverEnvironment } from '../../config/environment';
import { Adapters, PROVIDERS, type ProviderType } from '../../discounts/providers';
import { createCloudflareImageDirectUpload } from '../../integrations/cloudflare-images';
import { stripe } from '../../stripe-client';
import { normalizeEsnCardConfig } from '../../trpc/discounts/discount-provider-config';
import { computeIconSourceColor } from '../../utils/icon-color';
import { getPublicConfigEffect } from '../config/public-config.effect';

const ALLOWED_IMAGE_MIME_TYPES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
const ALLOWED_IMAGE_MIME_TYPE_SET = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(JSON.parse(value ?? 'null'));

const normalizeIconRecord = (
  icon: Pick<
    typeof icons.$inferSelect,
    'commonName' | 'friendlyName' | 'id' | 'sourceColor'
  >,
): IconRecord => ({
  commonName: icon.commonName,
  friendlyName: icon.friendlyName,
  id: icon.id,
  // eslint-disable-next-line unicorn/no-null
  sourceColor: icon.sourceColor ?? null,
});

const normalizeTemplateCategoryRecord = (
  templateCategory: Pick<
    typeof eventTemplateCategories.$inferSelect,
    'icon' | 'id' | 'title'
  >,
): TemplateCategoryRecord => ({
  icon: templateCategory.icon,
  id: templateCategory.id,
  title: templateCategory.title,
});

const normalizeTemplateRecord = (
  template: Pick<typeof eventTemplates.$inferSelect, 'icon' | 'id' | 'title'>,
): TemplateListRecord => ({
  icon: template.icon,
  id: template.id,
  title: template.title,
});

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
  // eslint-disable-next-line unicorn/no-null
  description: role.description ?? null,
  displayInHub: role.displayInHub,
  id: role.id,
  name: role.name,
  permissions: role.permissions,
  showInHub: role.showInHub,
  sortOrder: role.sortOrder,
});

const normalizeHubRoleRecord = (
  role: {
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
  },
): AdminHubRoleRecord => {
  const users = role.usersToTenants.flatMap((membership) =>
    membership.user ? [membership.user] : [],
  );

  return {
    // eslint-disable-next-line unicorn/no-null
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
  // eslint-disable-next-line unicorn/no-null
  country: taxRate.country ?? null,
  // eslint-disable-next-line unicorn/no-null
  displayName: taxRate.displayName ?? null,
  inclusive: taxRate.inclusive,
  // eslint-disable-next-line unicorn/no-null
  percentage: taxRate.percentage ?? null,
  // eslint-disable-next-line unicorn/no-null
  state: taxRate.state ?? null,
  stripeTaxRateId: taxRate.stripeTaxRateId,
});

const normalizeActiveTenantTaxRateRecord = (
  taxRate: Pick<
    typeof tenantStripeTaxRates.$inferSelect,
    | 'country'
    | 'displayName'
    | 'id'
    | 'percentage'
    | 'state'
    | 'stripeTaxRateId'
  >,
) => ({
  // eslint-disable-next-line unicorn/no-null
  country: taxRate.country ?? null,
  // eslint-disable-next-line unicorn/no-null
  displayName: taxRate.displayName ?? null,
  id: taxRate.id,
  // eslint-disable-next-line unicorn/no-null
  percentage: taxRate.percentage ?? null,
  // eslint-disable-next-line unicorn/no-null
  state: taxRate.state ?? null,
  stripeTaxRateId: taxRate.stripeTaxRateId,
});

const normalizeUserDiscountCardRecord = (
  card: Pick<
    typeof userDiscountCards.$inferSelect,
    'id' | 'identifier' | 'status' | 'type' | 'validTo'
  >,
) => ({
  id: card.id,
  identifier: card.identifier,
  status: card.status,
  type: card.type,
  // eslint-disable-next-line unicorn/no-null
  validTo: card.validTo?.toISOString() ?? null,
});

const normalizeTemplatesByCategoryRecord = (
  templateCategory: Pick<
    typeof eventTemplateCategories.$inferSelect,
    'icon' | 'id' | 'title'
  > & {
    templates: readonly Pick<
      typeof eventTemplates.$inferSelect,
      'icon' | 'id' | 'title'
    >[];
  },
): TemplatesByCategoryRecord => ({
  icon: templateCategory.icon,
  id: templateCategory.id,
  templates: templateCategory.templates.map((template) =>
    normalizeTemplateRecord(template),
  ),
  title: templateCategory.title,
});

const getFriendlyIconName = (icon: string): Effect.Effect<string, IconRpcError> =>
  Effect.sync(() => icon.split(':')).pipe(
    Effect.flatMap(([name, set]) => {
      if (!name) {
        return Effect.fail('INVALID_ICON_NAME' as const);
      }

      let friendlyName = name;
      if (set?.includes('-')) {
        for (const part of set.split('-')) {
          friendlyName = friendlyName.replaceAll(part, '');
        }
      }

      friendlyName = friendlyName.replaceAll('-', ' ').trim();

      return Effect.succeed(
        friendlyName
          .split(' ')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' '),
      );
    }),
  );

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, 'UNAUTHORIZED'> =>
  headers['x-evorto-authenticated'] === 'true'
    ? Effect.void
    : Effect.fail('UNAUTHORIZED' as const);

const ensurePermission = (
  headers: Headers.Headers,
  permission: Permission,
): Effect.Effect<void, 'FORBIDDEN' | 'UNAUTHORIZED'> =>
  Effect.gen(function* () {
    yield* ensureAuthenticated(headers);
    const currentPermissions = decodeHeaderJson(
      headers['x-evorto-permissions'],
      ConfigPermissions,
    );

    if (!currentPermissions.includes(permission)) {
      return yield* Effect.fail('FORBIDDEN' as const);
    }
  });

const decodeUserHeader = (
  headers: Headers.Headers,
) => Effect.sync(() => decodeHeaderJson(headers['x-evorto-user'], Schema.NullOr(User)));

const decodeAuthDataHeader = (headers: Headers.Headers) =>
  decodeHeaderJson(headers['x-evorto-auth-data'], UsersAuthData);

const requireUserHeader = (
  headers: Headers.Headers,
): Effect.Effect<User, 'UNAUTHORIZED'> =>
  Effect.gen(function* () {
    const user = yield* decodeUserHeader(headers);
    if (!user) {
      return yield* Effect.fail('UNAUTHORIZED' as const);
    }
    return user;
  });

export const appRpcHandlers = AppRpcs.toLayer(
  Effect.succeed({
    'admin.roles.create': (input, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'admin:manageRoles');
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const createdRoles = yield* Effect.promise(() =>
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
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const deletedRoles = yield* Effect.promise(() =>
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
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const hubRoles = yield* Effect.promise(() =>
          database.query.roles.findMany({
            columns: {
              description: true,
              id: true,
              name: true,
            },
            orderBy: (roles_, { asc }) => [asc(roles_.sortOrder), asc(roles_.name)],
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
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const tenantRoles = yield* Effect.promise(() =>
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
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const role = yield* Effect.promise(() =>
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
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const matchingRoles = yield* Effect.promise(() =>
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
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const updatedRoles = yield* Effect.promise(() =>
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
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
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

          const existingRate = yield* Effect.promise(() =>
            database.query.tenantStripeTaxRates.findFirst({
              where: {
                stripeTaxRateId: id,
                tenantId: tenant.id,
              },
            }),
          );

          const values: Omit<typeof tenantStripeTaxRates.$inferInsert, 'id'> = {
            active: !!stripeRate.active,
            // eslint-disable-next-line unicorn/no-null
            country: stripeRate.country ?? null,
            // eslint-disable-next-line unicorn/no-null
            displayName: stripeRate.display_name ?? null,
            inclusive: !!stripeRate.inclusive,
            percentage:
              stripeRate.percentage !== null &&
              stripeRate.percentage !== undefined
                ? String(stripeRate.percentage)
                : undefined,
            // eslint-disable-next-line unicorn/no-null
            state: stripeRate.state ?? null,
            stripeTaxRateId: stripeRate.id,
            tenantId: tenant.id,
          };

          yield* existingRate
            ? Effect.promise(() =>
                database
                  .update(tenantStripeTaxRates)
                  .set(values)
                  .where(eq(tenantStripeTaxRates.id, existingRate.id)),
              )
            : Effect.promise(() =>
                database.insert(tenantStripeTaxRates).values(values),
              );
        }
      }),
    'admin.tenant.listImportedTaxRates': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'admin:tax');
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const importedTaxRates = yield* Effect.promise(() =>
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
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const stripeAccount = tenant.stripeAccountId;
        if (!stripeAccount) {
          return [];
        }

        const [activeRates, archivedRates] = yield* Effect.promise(() =>
          Promise.all([
            stripe.taxRates.list({ active: true, limit: 100 }, { stripeAccount }),
            stripe.taxRates.list({ active: false, limit: 100 }, { stripeAccount }),
          ]),
        );
        const mapRate = (rate: (typeof activeRates)['data'][number]) => ({
          active: !!rate.active,
          // eslint-disable-next-line unicorn/no-null
          country: rate.country ?? null,
          // eslint-disable-next-line unicorn/no-null
          displayName: rate.display_name ?? null,
          id: rate.id,
          inclusive: !!rate.inclusive,
          // eslint-disable-next-line unicorn/no-null
          percentage: rate.percentage ?? null,
          // eslint-disable-next-line unicorn/no-null
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
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
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

        const updatedTenants = yield* Effect.promise(() =>
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
    'config.isAuthenticated': (_payload, options) =>
      Effect.succeed(options.headers['x-evorto-authenticated'] === 'true'),
    'config.permissions': (_payload, options) =>
      Effect.sync(() =>
        decodeHeaderJson(options.headers['x-evorto-permissions'], ConfigPermissions),
      ),
    'config.public': () => getPublicConfigEffect(serverEnvironment),
    'config.tenant': (_payload, options) =>
      Effect.sync(() =>
        decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant),
      ),
    'discounts.deleteMyCard': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        yield* Effect.promise(() =>
          database
            .delete(userDiscountCards)
            .where(
              and(
                eq(userDiscountCards.tenantId, tenant.id),
                eq(userDiscountCards.userId, user.id),
                eq(userDiscountCards.type, input.type),
              ),
            ),
        );
      }),
    'discounts.getMyCards': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);
        const cards = yield* Effect.promise(() =>
          database.query.userDiscountCards.findMany({
            where: {
              tenantId: tenant.id,
              userId: user.id,
            },
          }),
        );

        return cards.map((card) => normalizeUserDiscountCardRecord(card));
      }),
    'discounts.getTenantProviders': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const resolvedTenant = yield* Effect.promise(() =>
          database.query.tenants.findFirst({
            where: { id: tenant.id },
          }),
        );
        const config = resolveTenantDiscountProviders(
          resolvedTenant?.discountProviders,
        );

        return (Object.keys(PROVIDERS) as ProviderType[]).map((type) => ({
          config: normalizeEsnCardConfig(config[type].config),
          status: config[type].status,
          type,
        }));
      }),
    'discounts.refreshMyCard': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        const tenantRecord = yield* Effect.promise(() =>
          database.query.tenants.findFirst({
            where: {
              id: tenant.id,
            },
          }),
        );
        const providers = resolveTenantDiscountProviders(
          tenantRecord?.discountProviders,
        );
        const provider = providers[input.type];
        if (!provider || provider.status !== 'enabled') {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        const card = yield* Effect.promise(() =>
          database.query.userDiscountCards.findFirst({
            where: {
              tenantId: tenant.id,
              type: input.type,
              userId: user.id,
            },
          }),
        );
        if (!card) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const adapter = Adapters[input.type];
        if (!adapter) {
          return normalizeUserDiscountCardRecord(card);
        }

        const result = yield* Effect.promise(() =>
          adapter.validate({
            config: provider.config,
            identifier: card.identifier,
          }),
        );
        const updatedCards = yield* Effect.promise(() =>
          database
            .update(userDiscountCards)
            .set({
              lastCheckedAt: new Date(),
              metadata: result.metadata,
              status: result.status,
              validFrom: result.validFrom ?? undefined,
              validTo: result.validTo ?? undefined,
            })
            .where(eq(userDiscountCards.id, card.id))
            .returning(),
        );
        const updatedCard = updatedCards[0];
        if (!updatedCard) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        return normalizeUserDiscountCardRecord(updatedCard);
      }),
    'discounts.upsertMyCard': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        const tenantRecord = yield* Effect.promise(() =>
          database.query.tenants.findFirst({
            where: {
              id: tenant.id,
            },
          }),
        );
        const providers = resolveTenantDiscountProviders(
          tenantRecord?.discountProviders,
        );
        const provider = providers[input.type];
        if (!provider || provider.status !== 'enabled') {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        const existingIdentifier = yield* Effect.promise(() =>
          database.query.userDiscountCards.findFirst({
            where: {
              identifier: input.identifier,
              type: input.type,
            },
          }),
        );
        if (existingIdentifier && existingIdentifier.userId !== user.id) {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const existingCard = yield* Effect.promise(() =>
          database.query.userDiscountCards.findFirst({
            where: {
              tenantId: tenant.id,
              type: input.type,
              userId: user.id,
            },
          }),
        );

        const upsertedCards = existingCard
          ? yield* Effect.promise(() =>
              database
                .update(userDiscountCards)
                .set({
                  identifier: input.identifier,
                })
                .where(eq(userDiscountCards.id, existingCard.id))
                .returning(),
            )
          : yield* Effect.promise(() =>
              database
                .insert(userDiscountCards)
                .values({
                  identifier: input.identifier,
                  tenantId: tenant.id,
                  type: input.type,
                  userId: user.id,
                })
                .returning(),
            );
        const upsertedCard = upsertedCards[0];
        if (!upsertedCard) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const adapter = Adapters[input.type];
        if (!adapter) {
          return normalizeUserDiscountCardRecord(upsertedCard);
        }

        const result = yield* Effect.promise(() =>
          adapter.validate({
            config: provider.config,
            identifier: input.identifier,
          }),
        );
        const updatedCards = yield* Effect.promise(() =>
          database
            .update(userDiscountCards)
            .set({
              lastCheckedAt: new Date(),
              metadata: result.metadata,
              status: result.status,
              validFrom: result.validFrom ?? undefined,
              validTo: result.validTo ?? undefined,
            })
            .where(eq(userDiscountCards.id, upsertedCard.id))
            .returning(),
        );
        const updatedCard = updatedCards[0];
        if (!updatedCard) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        if (updatedCard.status !== 'verified') {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        return normalizeUserDiscountCardRecord(updatedCard);
      }),
    'editorMedia.createImageDirectUpload': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        if (!ALLOWED_IMAGE_MIME_TYPE_SET.has(input.mimeType)) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        if (
          input.fileSizeBytes <= 0 ||
          input.fileSizeBytes > MAX_IMAGE_SIZE_BYTES
        ) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        return yield* Effect.tryPromise({
          catch: (error) => {
            consola.error('editor-media.cloudflare.direct-upload-failed', {
              error,
              tenantId: tenant.id,
              userId: user.id,
            });
            return 'INTERNAL_SERVER_ERROR' as const;
          },
          try: () =>
            createCloudflareImageDirectUpload({
              fileName: input.fileName,
              mimeType: input.mimeType,
              source: 'editor',
              tenantId: tenant.id,
              uploadedByUserId: user.id,
            }),
        });
      }),
    'events.canOrganize': ({ eventId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        if (
          user.permissions.includes('events:organizeAll') ||
          user.permissions.includes('finance:manageReceipts')
        ) {
          return true;
        }

        const registrations = yield* Effect.promise(() =>
          database
            .select({
              id: eventRegistrations.id,
            })
            .from(eventRegistrations)
            .innerJoin(
              eventRegistrationOptions,
              eq(
                eventRegistrations.registrationOptionId,
                eventRegistrationOptions.id,
              ),
            )
            .where(
              and(
                eq(eventRegistrations.tenantId, tenant.id),
                eq(eventRegistrations.eventId, eventId),
                eq(eventRegistrations.userId, user.id),
                eq(eventRegistrations.status, 'CONFIRMED'),
                eq(eventRegistrationOptions.organizingRegistration, true),
              ),
            )
            .limit(1),
        );

        return registrations.length > 0;
      }),
    'events.getRegistrationStatus': ({ eventId }, options) =>
      Effect.gen(function* () {
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* decodeUserHeader(options.headers);
        if (!user) {
          return {
            isRegistered: false,
            registrations: [],
          };
        }

        const registrations = yield* Effect.promise(() =>
          database.query.eventRegistrations.findMany({
            where: {
              eventId,
              status: {
                NOT: 'CANCELLED',
              },
              tenantId: tenant.id,
              userId: user.id,
            },
            with: {
              registrationOption: true,
              transactions: true,
            },
          }),
        );

        const registrationSummaries = registrations.map((registration) => {
          const registrationOption = registration.registrationOption;
          if (!registrationOption) {
            throw new Error(
              `Registration option missing for registration ${registration.id}`,
            );
          }

          const registrationTransaction = registration.transactions.find(
            (transaction) =>
              transaction.type === 'registration' &&
              transaction.amount < registrationOption.price,
          );
           
          const discountedPrice =
            registration.appliedDiscountedPrice ??
            registrationTransaction?.amount ??
            undefined;
          const appliedDiscountType =
            registration.appliedDiscountType ??
            (discountedPrice === undefined ? undefined : ('esnCard' as const));
          const basePriceAtRegistration =
            registration.basePriceAtRegistration ??
            (discountedPrice === undefined
              ? undefined
              : registrationOption.price);
          const discountAmount =
            registration.discountAmount ??
            (discountedPrice === undefined
              ? undefined
              : registrationOption.price - discountedPrice);

          return {
            appliedDiscountedPrice: discountedPrice,
            appliedDiscountType,
            basePriceAtRegistration,
            checkoutUrl: registration.transactions.find(
              (transaction) =>
                transaction.method === 'stripe' &&
                transaction.type === 'registration',
            )?.stripeCheckoutUrl,
            discountAmount,
            id: registration.id,
            paymentPending: registration.transactions.some(
              (transaction) =>
                transaction.status === 'pending' &&
                transaction.type === 'registration',
            ),
            registeredDescription: registrationOption.registeredDescription,
            registrationOptionId: registration.registrationOptionId,
            registrationOptionTitle: registrationOption.title,
            status: registration.status,
          };
        });

        return {
          isRegistered: registrations.length > 0,
          registrations: registrationSummaries,
        };
      }),
    'globalAdmin.tenants.findMany': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const allTenants = yield* Effect.promise(() =>
          database.query.tenants.findMany({
            columns: {
              domain: true,
              id: true,
              name: true,
            },
            orderBy: (table, { asc }) => [asc(table.name)],
          }),
        );

        return allTenants;
      }),
    'icons.add': ({ icon }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const friendlyName = yield* getFriendlyIconName(icon);
        const sourceColor = yield* Effect.promise(() => computeIconSourceColor(icon));
        const insertedIcons = yield* Effect.promise(() =>
          database
            .insert(icons)
            .values({
              commonName: icon,
              friendlyName,
              sourceColor,
              tenantId: tenant.id,
            })
            .returning(),
        );

        return insertedIcons.map((icon) => normalizeIconRecord(icon));
      }),
    'icons.search': ({ search }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const matchingIcons = yield* Effect.promise(() =>
          database.query.icons.findMany({
            orderBy: { commonName: 'asc' },
            where: {
              commonName: { ilike: `%${search}%` },
              tenantId: tenant.id,
            },
          }),
        );

        return matchingIcons.map((icon) => normalizeIconRecord(icon));
      }),
    'taxRates.listActive': (_payload, options) =>
      Effect.gen(function* () {
        if (options.headers['x-evorto-authenticated'] === 'true') {
          const currentPermissions = decodeHeaderJson(
            options.headers['x-evorto-permissions'],
            ConfigPermissions,
          );
          if (!currentPermissions.includes('templates:view')) {
            return yield* Effect.fail('FORBIDDEN' as const);
          }
        }

        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const activeTaxRates = yield* Effect.promise(() =>
          database.query.tenantStripeTaxRates.findMany({
            columns: {
              country: true,
              displayName: true,
              id: true,
              percentage: true,
              state: true,
              stripeTaxRateId: true,
            },
            orderBy: (table, { asc }) => [
              asc(table.displayName),
              asc(table.stripeTaxRateId),
            ],
            where: {
              active: true,
              inclusive: true,
              tenantId: tenant.id,
            },
          }),
        );

        return activeTaxRates.map((taxRate) =>
          normalizeActiveTenantTaxRateRecord(taxRate),
        );
      }),
    'templateCategories.create': ({ icon, title }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'templates:manageCategories');
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);

        yield* Effect.promise(() =>
          database.insert(eventTemplateCategories).values({
            icon,
            tenantId: tenant.id,
            title,
          }),
        );
      }),
    'templateCategories.findMany': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const templateCategories = yield* Effect.promise(() =>
          database.query.eventTemplateCategories.findMany({
            where: { tenantId: tenant.id },
          }),
        );

        return templateCategories.map((category) =>
          normalizeTemplateCategoryRecord(category),
        );
      }),
    'templateCategories.update': ({ icon, id, title }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'templates:manageCategories');
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const updatedCategories = yield* Effect.promise(() =>
          database
            .update(eventTemplateCategories)
            .set({
              icon,
              title,
            })
            .where(
              and(
                eq(eventTemplateCategories.tenantId, tenant.id),
                eq(eventTemplateCategories.id, id),
              ),
            )
            .returning(),
        );
        const updatedCategory = updatedCategories[0];
        if (!updatedCategory) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        return normalizeTemplateCategoryRecord(updatedCategory);
      }),
    'templates.groupedByCategory': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const templateCategories = yield* Effect.promise(() =>
          database.query.eventTemplateCategories.findMany({
            orderBy: (categories, { asc }) => [asc(categories.title)],
            where: { tenantId: tenant.id },
            with: {
              templates: {
                orderBy: { createdAt: 'asc' },
              },
            },
          }),
        );

        return templateCategories.map((templateCategory) =>
          normalizeTemplatesByCategoryRecord(templateCategory),
        );
      }),
    'users.authData': (_payload, options) =>
      Effect.sync(() => decodeAuthDataHeader(options.headers)),
    'users.createAccount': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const authData = decodeAuthDataHeader(options.headers);
        const auth0Id = authData.sub?.trim();
        const email = authData.email?.trim();

        if (!auth0Id || !email) {
          return yield* Effect.fail('UNAUTHORIZED' as const);
        }

        const existingUser = yield* Effect.promise(() =>
          database
            .select({ id: users.id })
            .from(users)
            .where(eq(users.auth0Id, auth0Id))
            .limit(1),
        );
        if (existingUser.length > 0) {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const defaultUserRoles = yield* Effect.promise(() =>
          database.query.roles.findMany({
            where: { defaultUserRole: true, tenantId: tenant.id },
          }),
        );
        const userCreateResponse = yield* Effect.promise(() =>
          database
            .insert(users)
            .values({
              auth0Id,
              communicationEmail: input.communicationEmail,
              email,
              firstName: input.firstName,
              lastName: input.lastName,
            })
            .returning(),
        );
        const createdUser = userCreateResponse[0];
        if (!createdUser) {
          return yield* Effect.fail('UNAUTHORIZED' as const);
        }

        const userTenantCreateResponse = yield* Effect.promise(() =>
          database
            .insert(usersToTenants)
            .values({
              tenantId: tenant.id,
              userId: createdUser.id,
            })
            .returning(),
        );
        const createdUserTenant = userTenantCreateResponse[0];
        if (!createdUserTenant) {
          return yield* Effect.fail('UNAUTHORIZED' as const);
        }

        if (defaultUserRoles.length > 0) {
          yield* Effect.promise(() =>
            database.insert(rolesToTenantUsers).values(
              defaultUserRoles.map((role) => ({
                roleId: role.id,
                userTenantId: createdUserTenant.id,
              })),
            ),
          );
        }
      }),
    'users.events': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        const registrations = yield* Effect.promise(() =>
          database
            .select({
              eventId: eventRegistrations.eventId,
            })
            .from(eventRegistrations)
            .where(eq(eventRegistrations.userId, user.id)),
        );

        if (registrations.length === 0) {
          return [];
        }

        const events = yield* Effect.promise(() =>
          database
            .select({
              description: eventInstances.description,
              end: eventInstances.end,
              id: eventInstances.id,
              start: eventInstances.start,
              title: eventInstances.title,
            })
            .from(eventInstances)
            .where(eq(eventInstances.tenantId, tenant.id))
            .orderBy(eventInstances.start),
        );

        return events.map((event) => ({
          // eslint-disable-next-line unicorn/no-null
          description: event.description ?? null,
          end: event.end.toISOString(),
          id: event.id,
          start: event.start.toISOString(),
          title: event.title,
        }));
      }),
    'users.findMany': (input, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'users:viewAll');
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);

        const usersCountResult = yield* Effect.promise(() =>
          database
            .select({ count: count() })
            .from(users)
            .innerJoin(
              usersToTenants,
              and(
                eq(usersToTenants.userId, users.id),
                eq(usersToTenants.tenantId, tenant.id),
              ),
            )
            .leftJoin(
              rolesToTenantUsers,
              eq(usersToTenants.id, rolesToTenantUsers.userTenantId),
            ),
        );
        const usersCount = usersCountResult[0]?.count ?? 0;

        const selectedUsers = yield* Effect.promise(() =>
          database
            .select({
              email: users.email,
              firstName: users.firstName,
              id: users.id,
              lastName: users.lastName,
              role: roles.name,
            })
            .from(users)
            .orderBy(users.lastName, users.firstName)
            .offset(input.offset ?? 0)
            .limit(input.limit ?? 100)
            .innerJoin(
              usersToTenants,
              and(
                eq(usersToTenants.userId, users.id),
                eq(usersToTenants.tenantId, tenant.id),
              ),
            )
            .leftJoin(
              rolesToTenantUsers,
              eq(usersToTenants.id, rolesToTenantUsers.userTenantId),
            )
            .leftJoin(roles, eq(rolesToTenantUsers.roleId, roles.id)),
        );

        const userMap: Record<
          string,
          {
            email: string;
            firstName: string;
            id: string;
            lastName: string;
            roles: string[];
          }
        > = {};
        for (const user of selectedUsers) {
          if (userMap[user.id]) {
            if (user.role) {
              userMap[user.id].roles.push(user.role);
            }
            continue;
          }
          userMap[user.id] = {
            ...user,
            roles: user.role ? [user.role] : [],
          };
        }

        return { users: Object.values(userMap), usersCount };
      }),
    'users.maybeSelf': (_payload, options) => decodeUserHeader(options.headers),
    'users.self': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        return yield* requireUserHeader(options.headers);
      }),
    'users.updateProfile': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const user = yield* requireUserHeader(options.headers);

        yield* Effect.promise(() =>
          database
            .update(users)
            .set({
              firstName: input.firstName,
              // eslint-disable-next-line unicorn/no-null
              iban: input.iban ?? null,
              lastName: input.lastName,
              // eslint-disable-next-line unicorn/no-null
              paypalEmail: input.paypalEmail ?? null,
            })
            .where(eq(users.id, user.id)),
        );
      }),
    'users.userAssigned': (_payload, options) =>
      Effect.succeed(options.headers['x-evorto-user-assigned'] === 'true'),
  }),
);
