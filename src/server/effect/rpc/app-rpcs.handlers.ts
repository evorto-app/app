import type { Headers } from '@effect/platform';

import {
  resolveTenantDiscountProviders,
  resolveTenantReceiptSettings,
  type TenantDiscountProviders,
} from '@shared/tenant-config';
import consola from 'consola';
import {
  and,
  arrayOverlaps,
  count,
  eq,
  exists,
  gt,
  inArray,
  not,
} from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { groupBy } from 'es-toolkit';
import { DateTime } from 'luxon';

import { database } from '../../../db';
import { createId } from '../../../db/create-id';
import {
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  icons,
  roles,
  rolesToTenantUsers,
  templateRegistrationOptionDiscounts,
  tenants,
  tenantStripeTaxRates,
  transactions,
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
import {
  isMeaningfulRichTextHtml,
  sanitizeOptionalRichTextHtml,
  sanitizeRichTextHtml,
} from '../../utils/rich-text-sanitize';
import { validateTaxRate } from '../../utils/validate-tax-rate';
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

const getEsnCardDiscountedPriceByOptionId = (
  discounts: readonly {
    discountedPrice: number;
    discountType: string;
    registrationOptionId: string;
  }[],
) => {
  const map = new Map<string, number>();
  for (const discount of discounts) {
    if (discount.discountType !== 'esnCard') {
      continue;
    }

    const current = map.get(discount.registrationOptionId);
    if (current === undefined || discount.discountedPrice < current) {
      map.set(discount.registrationOptionId, discount.discountedPrice);
    }
  }

  return map;
};

const isEsnCardEnabled = (providers: unknown) => {
  if (!providers || typeof providers !== 'object') {
    return false;
  }

  const esnCard = (
    providers as {
      esnCard?: {
        status?: unknown;
      };
    }
  ).esnCard;

  return esnCard?.status === 'enabled';
};

const canEditEvent = ({
  creatorId,
  permissions,
  userId,
}: {
  creatorId: string;
  permissions: readonly string[];
  userId: string;
}) => creatorId === userId || permissions.includes('events:editAll');

const EDITABLE_EVENT_STATUSES = ['DRAFT', 'REJECTED'] as const;

type EventRegistrationOptionDiscountInsert =
  typeof eventRegistrationOptionDiscounts.$inferInsert;

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
    'events.cancelPendingRegistration': ({ registrationId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        const registration = yield* Effect.promise(() =>
          database.query.eventRegistrations.findFirst({
            where: {
              id: registrationId,
              status: 'PENDING',
              tenantId: tenant.id,
              userId: user.id,
            },
            with: {
              registrationOption: true,
              transactions: true,
            },
          }),
        );

        if (!registration) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        yield* Effect.tryPromise({
          catch: () => 'INTERNAL_SERVER_ERROR' as const,
          try: () =>
            database.transaction(async (tx) => {
              await tx
                .update(eventRegistrations)
                .set({
                  status: 'CANCELLED',
                })
                .where(eq(eventRegistrations.id, registration.id));

              const reservedSpots = registration.registrationOption?.reservedSpots;
              if (reservedSpots === undefined) {
                throw new Error('Registration option missing');
              }

              await tx
                .update(eventRegistrationOptions)
                .set({
                  reservedSpots: reservedSpots - 1,
                })
                .where(
                  eq(
                    eventRegistrationOptions.id,
                    registration.registrationOptionId,
                  ),
                );

              const transaction = registration.transactions.find(
                (currentTransaction) =>
                  currentTransaction.status === 'pending' &&
                  currentTransaction.method === 'stripe',
              );

              if (!transaction) {
                return;
              }

              await tx
                .update(transactions)
                .set({
                  status: 'cancelled',
                })
                .where(eq(transactions.id, transaction.id));

              if (!transaction.stripeCheckoutSessionId) {
                return;
              }

              const stripeAccount = tenant.stripeAccountId;
              if (!stripeAccount) {
                throw new Error('Stripe account not found');
              }
              try {
                await stripe.checkout.sessions.expire(
                  transaction.stripeCheckoutSessionId,
                  undefined,
                  {
                    stripeAccount,
                  },
                );
              } catch (error) {
                consola.error('stripe.checkout.expire-failed', {
                  error,
                  registrationId: registration.id,
                  tenantId: tenant.id,
                });
              }
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
    'events.create': (input, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:create');
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        const start = new Date(input.start);
        const end = new Date(input.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const sanitizedDescription = sanitizeRichTextHtml(input.description);
        if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const sanitizedRegistrationOptions = input.registrationOptions.map(
          (option) => ({
            ...option,
            closeRegistrationTime: new Date(option.closeRegistrationTime),
            description: sanitizeOptionalRichTextHtml(option.description),
            openRegistrationTime: new Date(option.openRegistrationTime),
            registeredDescription: sanitizeOptionalRichTextHtml(
              option.registeredDescription,
            ),
          }),
        );

        for (const option of sanitizedRegistrationOptions) {
          if (
            Number.isNaN(option.closeRegistrationTime.getTime()) ||
            Number.isNaN(option.openRegistrationTime.getTime())
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          const validation = yield* Effect.promise(() =>
            validateTaxRate({
              isPaid: option.isPaid,
              // eslint-disable-next-line unicorn/no-null
              stripeTaxRateId: option.stripeTaxRateId ?? null,
              tenantId: tenant.id,
            }),
          );
          if (!validation.success) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }
        }

        const templateDefaults = yield* Effect.promise(() =>
          database.query.eventTemplates.findFirst({
            columns: { unlisted: true },
            where: { id: input.templateId },
          }),
        );

        const events = yield* Effect.promise(() =>
          database
            .insert(eventInstances)
            .values({
              creatorId: user.id,
              description: sanitizedDescription,
              end,
              icon: input.icon,
              start,
              templateId: input.templateId,
              tenantId: tenant.id,
              title: input.title,
              unlisted: templateDefaults?.unlisted ?? false,
            })
            .returning({
              id: eventInstances.id,
            }),
        );
        const event = events[0];
        if (!event) {
          return yield* Effect.fail('INTERNAL_SERVER_ERROR' as const);
        }

        const createdOptions = yield* Effect.promise(() =>
          database
            .insert(eventRegistrationOptions)
            .values(
              sanitizedRegistrationOptions.map((option) => ({
                closeRegistrationTime: option.closeRegistrationTime,
                description: option.description,
                eventId: event.id,
                isPaid: option.isPaid,
                openRegistrationTime: option.openRegistrationTime,
                organizingRegistration: option.organizingRegistration,
                price: option.price,
                registeredDescription: option.registeredDescription,
                registrationMode: option.registrationMode,
                roleIds: [...option.roleIds],
                spots: option.spots,
                // eslint-disable-next-line unicorn/no-null
                stripeTaxRateId: option.stripeTaxRateId ?? null,
                title: option.title,
              })),
            )
            .returning({
              id: eventRegistrationOptions.id,
              organizingRegistration: eventRegistrationOptions.organizingRegistration,
              title: eventRegistrationOptions.title,
            }),
        );

        const tenantTemplateOptions = yield* Effect.promise(() =>
          database.query.templateRegistrationOptions.findMany({
            where: { templateId: input.templateId },
          }),
        );
        if (tenantTemplateOptions.length > 0) {
          const templateDiscounts = yield* Effect.promise(() =>
            database
              .select()
              .from(templateRegistrationOptionDiscounts)
              .where(
                inArray(
                  templateRegistrationOptionDiscounts.registrationOptionId,
                  tenantTemplateOptions.map((option) => option.id),
                ),
              ),
          );
          if (templateDiscounts.length > 0) {
            const registrationOptionKey = (title: string, organizing: boolean) =>
              `${title}__${organizing ? '1' : '0'}`;
            const templateOptionByKey = new Map(
              tenantTemplateOptions.map((option) => [
                registrationOptionKey(option.title, option.organizingRegistration),
                option,
              ]),
            );
            const discountInserts: EventRegistrationOptionDiscountInsert[] = [];
            for (const createdOption of createdOptions) {
              const sourceTemplateOption = templateOptionByKey.get(
                registrationOptionKey(
                  createdOption.title,
                  createdOption.organizingRegistration,
                ),
              );
              if (!sourceTemplateOption) {
                continue;
              }
              for (const discount of templateDiscounts) {
                if (discount.registrationOptionId !== sourceTemplateOption.id) {
                  continue;
                }
                discountInserts.push({
                  discountedPrice: discount.discountedPrice,
                  discountType: discount.discountType,
                  registrationOptionId: createdOption.id,
                });
              }
            }
            if (discountInserts.length > 0) {
              yield* Effect.promise(() =>
                database
                  .insert(eventRegistrationOptionDiscounts)
                  .values(discountInserts),
              );
            }
          }
        }

        return {
          id: event.id,
        };
      }),
    'events.eventList': (input, options) =>
      Effect.gen(function* () {
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* decodeUserHeader(options.headers);
        const userPermissions = user?.permissions ?? [];

        if (user?.id !== input.userId) {
          consola.warn(
            `Supplied query parameter userId (${input.userId}) does not match the actual state (${user?.id})!`,
          );
        }

        const onlyApprovedStatus =
          input.status.length === 1 && input.status[0] === 'APPROVED';
        if (!onlyApprovedStatus && !userPermissions.includes('events:seeDrafts')) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        if (input.includeUnlisted && !userPermissions.includes('events:seeUnlisted')) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        const rolesToFilterBy =
          user?.roleIds ??
          (yield* Effect.promise(() =>
            database.query.roles
              .findMany({
                columns: { id: true },
                where: {
                  defaultUserRole: true,
                  tenantId: tenant.id,
                },
              })
              .then((roleRecords) => roleRecords.map((role) => role.id)),
          ));
        const roleFilters = rolesToFilterBy.length > 0 ? [...rolesToFilterBy] : [''];

        const selectedEvents = yield* Effect.promise(() =>
          database
            .select({
              creatorId: eventInstances.creatorId,
              icon: eventInstances.icon,
              id: eventInstances.id,
              start: eventInstances.start,
              status: eventInstances.status,
              title: eventInstances.title,
              unlisted: eventInstances.unlisted,
              userRegistered: exists(
                database
                  .select()
                  .from(eventRegistrations)
                  .where(
                    and(
                      eq(eventRegistrations.eventId, eventInstances.id),
                      eq(eventRegistrations.userId, user?.id ?? ''),
                      not(eq(eventRegistrations.status, 'CANCELLED')),
                    ),
                  ),
              ),
            })
            .from(eventInstances)
            .where(
              and(
                gt(eventInstances.start, new Date(input.startAfter)),
                eq(eventInstances.tenantId, tenant.id),
                inArray(eventInstances.status, [...input.status]),
                ...(input.includeUnlisted
                  ? []
                  : [eq(eventInstances.unlisted, false)]),
                exists(
                  database
                    .select()
                    .from(eventRegistrationOptions)
                    .where(
                      and(
                        eq(eventRegistrationOptions.eventId, eventInstances.id),
                        arrayOverlaps(
                          eventRegistrationOptions.roleIds,
                          roleFilters,
                        ),
                      ),
                    ),
                ),
              ),
            )
            .limit(input.limit)
            .offset(input.offset)
            .orderBy(eventInstances.start),
        );

        const eventRecords = selectedEvents.map((event) => ({
          icon: event.icon,
          id: event.id,
          start: event.start.toISOString(),
          status: event.status,
          title: event.title,
          unlisted: event.unlisted,
          userIsCreator: event.creatorId === (user?.id ?? 'not'),
          userRegistered: Boolean(event.userRegistered),
        }));

        const groupedEvents = new Map<string, typeof eventRecords>();

        for (const event of eventRecords) {
          const day = DateTime.fromISO(event.start).toFormat('yyyy-MM-dd');
          const currentEvents = groupedEvents.get(day) ?? [];
          currentEvents.push(event);
          groupedEvents.set(day, currentEvents);
        }

        return [...groupedEvents.entries()].map(([day, events]) => ({
          day: DateTime.fromFormat(day, 'yyyy-MM-dd').toJSDate().toISOString(),
          events,
        }));
      }),
    'events.findOne': ({ id }, options) =>
      Effect.gen(function* () {
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* decodeUserHeader(options.headers);

        const rolesToFilterBy =
          user?.roleIds ??
          (yield* Effect.promise(() =>
            database.query.roles
              .findMany({
                columns: { id: true },
                where: {
                  defaultUserRole: true,
                  tenantId: tenant.id,
                },
              })
              .then((roleRecords) => roleRecords.map((role) => role.id)),
          ));

        const event = yield* Effect.promise(() =>
          database.query.eventInstances.findFirst({
            where: { id, tenantId: tenant.id },
            with: {
              registrationOptions: {
                where: {
                  RAW: (table) => arrayOverlaps(table.roleIds, [...rolesToFilterBy]),
                },
              },
              reviewer: {
                columns: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const canSeeDrafts = user?.permissions.includes('events:seeDrafts');
        const canReviewEvents = user?.permissions.includes('events:review');
        const canEditEvent_ = user
          ? canEditEvent({
              creatorId: event.creatorId,
              permissions: user.permissions,
              userId: user.id,
            })
          : false;
        if (
          event.status !== 'APPROVED' &&
          !canSeeDrafts &&
          !canReviewEvents &&
          !canEditEvent_
        ) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const registrationOptionIds = event.registrationOptions.map(
          (registrationOption) => registrationOption.id,
        );
        const optionDiscounts =
          registrationOptionIds.length === 0
            ? []
            : yield* Effect.promise(() =>
                database
                  .select()
                  .from(eventRegistrationOptionDiscounts)
                  .where(
                    and(
                      eq(eventRegistrationOptionDiscounts.discountType, 'esnCard'),
                      inArray(
                        eventRegistrationOptionDiscounts.registrationOptionId,
                        registrationOptionIds,
                      ),
                    ),
                  ),
              );
        const esnCardDiscountedPriceByOptionId =
          getEsnCardDiscountedPriceByOptionId(optionDiscounts);

        const esnCardIsEnabledForTenant = isEsnCardEnabled(
          tenant.discountProviders ?? null,
        );
        let userCanUseEsnCardDiscount = false;

        if (user && esnCardIsEnabledForTenant) {
          const cards = yield* Effect.promise(() =>
            database.query.userDiscountCards.findMany({
              where: {
                status: 'verified',
                tenantId: tenant.id,
                type: 'esnCard',
                userId: user.id,
              },
            }),
          );
          userCanUseEsnCardDiscount = cards.some(
            (card) => !card.validTo || card.validTo > event.start,
          );
        }

        return {
          creatorId: event.creatorId,
          description: event.description,
          end: event.end.toISOString(),
          icon: event.icon,
          id: event.id,
          // eslint-disable-next-line unicorn/no-null
          location: event.location ?? null,
          registrationOptions: event.registrationOptions.map(
            (registrationOption) => {
              const esnCardDiscountedPrice =
                esnCardDiscountedPriceByOptionId.get(registrationOption.id) ??
                null;
              const userIsEligibleForEsnCardDiscount =
                registrationOption.isPaid &&
                esnCardDiscountedPrice !== null &&
                esnCardIsEnabledForTenant &&
                userCanUseEsnCardDiscount;
              const effectivePrice = userIsEligibleForEsnCardDiscount
                ? Math.min(registrationOption.price, esnCardDiscountedPrice)
                : registrationOption.price;
              const discountApplied =
                userIsEligibleForEsnCardDiscount &&
                effectivePrice < registrationOption.price;

              return {
                appliedDiscountType: discountApplied
                  ? ('esnCard' as const)
                  : null,
                checkedInSpots: registrationOption.checkedInSpots,
                closeRegistrationTime:
                  registrationOption.closeRegistrationTime.toISOString(),
                confirmedSpots: registrationOption.confirmedSpots,
                // eslint-disable-next-line unicorn/no-null
                description: registrationOption.description ?? null,
                discountApplied,
                effectivePrice,
                esnCardDiscountedPrice: discountApplied
                  ? esnCardDiscountedPrice
                  : null,
                eventId: registrationOption.eventId,
                id: registrationOption.id,
                isPaid: registrationOption.isPaid,
                openRegistrationTime:
                  registrationOption.openRegistrationTime.toISOString(),
                organizingRegistration: registrationOption.organizingRegistration,
                price: registrationOption.price,
                registeredDescription:
                  registrationOption.registeredDescription ?? null,
                registrationMode: registrationOption.registrationMode,
                roleIds: [...registrationOption.roleIds],
                spots: registrationOption.spots,
                // eslint-disable-next-line unicorn/no-null
                stripeTaxRateId: registrationOption.stripeTaxRateId ?? null,
                title: registrationOption.title,
              };
            },
          ),
          reviewer: event.reviewer,
          start: event.start.toISOString(),
          status: event.status,
          // eslint-disable-next-line unicorn/no-null
          statusComment: event.statusComment ?? null,
          title: event.title,
          unlisted: event.unlisted,
        };
      }),
    'events.findOneForEdit': ({ id }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        const event = yield* Effect.promise(() =>
          database.query.eventInstances.findFirst({
            where: { id, tenantId: tenant.id },
            with: {
              registrationOptions: true,
            },
          }),
        );

        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const canEdit =
          event.creatorId === user.id || user.permissions.includes('events:editAll');
        if (!canEdit) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        if (event.status !== 'DRAFT' && event.status !== 'REJECTED') {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const registrationOptionIds = event.registrationOptions.map(
          (option) => option.id,
        );
        const optionDiscounts =
          registrationOptionIds.length === 0
            ? []
            : yield* Effect.promise(() =>
                database
                  .select({
                    discountedPrice: eventRegistrationOptionDiscounts.discountedPrice,
                    discountType: eventRegistrationOptionDiscounts.discountType,
                    registrationOptionId:
                      eventRegistrationOptionDiscounts.registrationOptionId,
                  })
                  .from(eventRegistrationOptionDiscounts)
                  .where(
                    and(
                      eq(eventRegistrationOptionDiscounts.discountType, 'esnCard'),
                      inArray(
                        eventRegistrationOptionDiscounts.registrationOptionId,
                        [...registrationOptionIds],
                      ),
                    ),
                  ),
              );
        const esnCardDiscountedPriceByOptionId =
          getEsnCardDiscountedPriceByOptionId(optionDiscounts);

        return {
          description: event.description,
          end: event.end.toISOString(),
          icon: event.icon,
          id: event.id,
          // eslint-disable-next-line unicorn/no-null
          location: event.location ?? null,
          registrationOptions: event.registrationOptions.map((option) => ({
            closeRegistrationTime: option.closeRegistrationTime.toISOString(),
            // eslint-disable-next-line unicorn/no-null
            description: option.description ?? null,
            esnCardDiscountedPrice:
              esnCardDiscountedPriceByOptionId.get(option.id) ?? undefined,
            id: option.id,
            isPaid: option.isPaid,
            openRegistrationTime: option.openRegistrationTime.toISOString(),
            organizingRegistration: option.organizingRegistration,
            price: option.price,
            // eslint-disable-next-line unicorn/no-null
            registeredDescription: option.registeredDescription ?? null,
            registrationMode: option.registrationMode,
            roleIds: [...option.roleIds],
            spots: option.spots,
            // eslint-disable-next-line unicorn/no-null
            stripeTaxRateId: option.stripeTaxRateId ?? null,
            title: option.title,
          })),
          start: event.start.toISOString(),
          title: event.title,
        };
      }),
    'events.getOrganizeOverview': ({ eventId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);

        const registrations = yield* Effect.promise(() =>
          database.query.eventRegistrations.findMany({
            where: {
              eventId,
              status: 'CONFIRMED',
              tenantId: tenant.id,
            },
            with: {
              registrationOption: {
                columns: {
                  id: true,
                  organizingRegistration: true,
                  price: true,
                  title: true,
                },
              },
              transactions: {
                columns: {
                  amount: true,
                },
                where: {
                  type: 'registration',
                },
              },
              user: {
                columns: {
                  email: true,
                  firstName: true,
                  id: true,
                  lastName: true,
                },
              },
            },
          }),
        );
        const registrationsWithRelations = registrations.filter(
          (registration) => registration.registrationOption && registration.user,
        );

        type Registration = (typeof registrationsWithRelations)[number];
        const groupedRegistrations = groupBy(
          registrationsWithRelations,
          (registration) => registration.registrationOptionId,
        ) as Record<string, Registration[]>;

        const sortedOptions = (
          Object.entries(groupedRegistrations) as [string, Registration[]][]
        ).toSorted(([, registrationsA], [, registrationsB]) => {
          if (
            registrationsA[0].registrationOption.organizingRegistration !==
            registrationsB[0].registrationOption.organizingRegistration
          ) {
            return registrationsB[0].registrationOption.organizingRegistration
              ? 1
              : -1;
          }

          return registrationsA[0].registrationOption.title.localeCompare(
            registrationsB[0].registrationOption.title,
          );
        });

        return sortedOptions.map(([registrationOptionId, registrationRows]) => {
          const sortedUsers = registrationRows
            .toSorted((registrationA, registrationB) => {
              if (
                (registrationA.checkInTime === null) !==
                (registrationB.checkInTime === null)
              ) {
                return registrationA.checkInTime === null ? -1 : 1;
              }

              const firstNameCompare =
                registrationA.user.firstName.localeCompare(
                  registrationB.user.firstName,
                );
              if (firstNameCompare !== 0) {
                return firstNameCompare;
              }

              return registrationA.user.lastName.localeCompare(
                registrationB.user.lastName,
              );
            })
            .map((registration) => {
              const registrationOption = registration.registrationOption;
              const discountedPriceFromTransaction =
                registration.transactions.find(
                  (transaction) =>
                    transaction.amount < registrationOption.price,
                )?.amount;
              const appliedDiscountedPrice =
                registration.appliedDiscountedPrice ??
                discountedPriceFromTransaction ??
                null;
              const appliedDiscountType =
                registration.appliedDiscountType ??
                (appliedDiscountedPrice === null ? null : ('esnCard' as const));
              const basePriceAtRegistration =
                registration.basePriceAtRegistration ??
                (appliedDiscountedPrice === null
                  ? null
                  : registrationOption.price);
              const discountAmount =
                registration.discountAmount ??
                (appliedDiscountedPrice === null
                  ? null
                  : registrationOption.price - appliedDiscountedPrice);

              return {
                appliedDiscountedPrice,
                appliedDiscountType,
                basePriceAtRegistration,
                checkedIn: registration.checkInTime !== null,
                // eslint-disable-next-line unicorn/no-null
                checkInTime: registration.checkInTime?.toISOString() ?? null,
                discountAmount,
                email: registration.user.email,
                firstName: registration.user.firstName,
                lastName: registration.user.lastName,
                userId: registration.user.id,
              };
            });

          return {
            organizingRegistration:
              registrationRows[0].registrationOption.organizingRegistration,
            registrationOptionId,
            registrationOptionTitle: registrationRows[0].registrationOption.title,
            users: sortedUsers,
          };
        });
      }),
    'events.getPendingReviews': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:review');
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);

        const pendingReviews = yield* Effect.promise(() =>
          database.query.eventInstances.findMany({
            columns: {
              id: true,
              start: true,
              title: true,
            },
            orderBy: { start: 'desc' },
            where: { status: 'PENDING_REVIEW', tenantId: tenant.id },
          }),
        );

        return pendingReviews.map((event) => ({
          id: event.id,
          start: event.start.toISOString(),
          title: event.title,
        }));
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
    'events.registerForEvent': ({ eventId, registrationOptionId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        const existingRegistration = yield* Effect.promise(() =>
          database.query.eventRegistrations.findFirst({
            where: {
              eventId,
              status: { NOT: 'CANCELLED' },
              userId: user.id,
            },
          }),
        );
        if (existingRegistration) {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const registrationOption = yield* Effect.promise(() =>
          database.query.eventRegistrationOptions.findFirst({
            where: { eventId, id: registrationOptionId },
            with: {
              event: {
                columns: {
                  start: true,
                  title: true,
                },
              },
            },
          }),
        );
        if (!registrationOption) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }
        if (!registrationOption.event) {
          return yield* Effect.fail('INTERNAL_SERVER_ERROR' as const);
        }
        if (
          registrationOption.confirmedSpots + registrationOption.reservedSpots >=
          registrationOption.spots
        ) {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const selectedTaxRateId = registrationOption.stripeTaxRateId ?? undefined;
        const selectedTaxRate = selectedTaxRateId
          ? yield* Effect.promise(() =>
              database.query.tenantStripeTaxRates.findFirst({
                where: {
                  stripeTaxRateId: selectedTaxRateId,
                  tenantId: tenant.id,
                },
              }),
            )
          : undefined;

        const createdRegistrations = yield* Effect.promise(() =>
          database
            .insert(eventRegistrations)
            .values({
              eventId,
              registrationOptionId: registrationOption.id,
              status: registrationOption.isPaid ? 'PENDING' : 'CONFIRMED',
              ...(selectedTaxRateId
                ? {
                    stripeTaxRateId: selectedTaxRateId,
                    taxRateDisplayName: selectedTaxRate?.displayName,
                    taxRateInclusive: selectedTaxRate?.inclusive,
                    taxRatePercentage: selectedTaxRate?.percentage,
                  }
                : {}),
              tenantId: tenant.id,
              userId: user.id,
            })
            .returning({
              id: eventRegistrations.id,
            }),
        );
        const userRegistration = createdRegistrations[0];
        if (!userRegistration) {
          return yield* Effect.fail('INTERNAL_SERVER_ERROR' as const);
        }

        yield* Effect.promise(() =>
          database
            .update(eventRegistrationOptions)
            .set(
              registrationOption.isPaid
                ? { reservedSpots: registrationOption.reservedSpots + 1 }
                : {
                    confirmedSpots: registrationOption.confirmedSpots + 1,
                  },
            )
            .where(
              and(
                eq(eventRegistrationOptions.id, registrationOption.id),
                eq(eventRegistrationOptions.eventId, eventId),
              ),
            ),
        );

        if (!registrationOption.isPaid) {
          return;
        }

        const registerForEventSucceeded = yield* Effect.promise(async () => {
          try {
            const transactionId = createId();
            const forwardedProtocol = options.headers['x-forwarded-proto']
              ?.split(',')[0]
              ?.trim();
            const forwardedHost = options.headers['x-forwarded-host']
              ?.split(',')[0]
              ?.trim();
            const host = forwardedHost ?? options.headers['host'];
            const origin =
              options.headers['origin'] ??
              (host ? `${forwardedProtocol ?? 'http'}://${host}` : undefined);
            const eventUrl = `${origin ?? ''}/events/${eventId}`;

            const basePrice = registrationOption.price;
            let effectivePrice = registrationOption.price;
            let appliedDiscountType:
              | null
              | typeof eventRegistrationOptionDiscounts.$inferSelect.discountType =
              null;
            let appliedDiscountedPrice: null | number = null;
            const cards = await database.query.userDiscountCards.findMany({
              where: {
                status: 'verified',
                tenantId: tenant.id,
                userId: user.id,
              },
            });
            if (cards.length > 0) {
              const tenantRecord = await database.query.tenants.findFirst({
                where: { id: tenant.id },
              });
              const providerConfig: TenantDiscountProviders =
                resolveTenantDiscountProviders(tenantRecord?.discountProviders);
              const enabledTypes = new Set(
                Object.entries(providerConfig)
                  .filter(([, provider]) => provider?.status === 'enabled')
                  .map(([key]) => key),
              );
              const discounts =
                await database.query.eventRegistrationOptionDiscounts.findMany({
                  where: { registrationOptionId: registrationOption.id },
                });
              const eventStart = registrationOption.event.start ?? new Date();
              const eligible = discounts.filter((discount) =>
                cards.some(
                  (card) =>
                    card.type === discount.discountType &&
                    enabledTypes.has(card.type) &&
                    (!card.validTo || card.validTo > eventStart),
                ),
              );
              if (eligible.length > 0) {
                let bestDiscount = eligible[0];
                for (const candidate of eligible.slice(1)) {
                  if (candidate.discountedPrice < bestDiscount.discountedPrice) {
                    bestDiscount = candidate;
                  }
                }
                effectivePrice = bestDiscount.discountedPrice;
                appliedDiscountType = bestDiscount.discountType;
                appliedDiscountedPrice = bestDiscount.discountedPrice;
              }
            }

            const discountAmount =
              appliedDiscountedPrice === null
                ? null
                : Math.max(0, basePrice - appliedDiscountedPrice);
            await database
              .update(eventRegistrations)
              .set({
                appliedDiscountedPrice,
                appliedDiscountType,
                basePriceAtRegistration: basePrice,
                discountAmount,
              })
              .where(eq(eventRegistrations.id, userRegistration.id));

            if (effectivePrice <= 0) {
              await database
                .update(eventRegistrations)
                .set({
                  status: 'CONFIRMED',
                })
                .where(eq(eventRegistrations.id, userRegistration.id));

              await database
                .update(eventRegistrationOptions)
                .set({
                  confirmedSpots: registrationOption.confirmedSpots + 1,
                  reservedSpots: Math.max(0, registrationOption.reservedSpots - 1),
                })
                .where(eq(eventRegistrationOptions.id, registrationOption.id));
              return;
            }

            const applicationFee = Math.round(effectivePrice * 0.035);
            const stripeAccount = tenant.stripeAccountId;
            if (!stripeAccount) {
              throw new Error('Stripe account not found');
            }

            const session = await stripe.checkout.sessions.create(
              {
                cancel_url: `${eventUrl}?registrationStatus=cancel`,
                customer_email: user.email,
                expires_at: Math.ceil(
                  DateTime.local().plus({ minutes: 30 }).toSeconds(),
                ),
                line_items: [
                  {
                    price_data: {
                      currency: tenant.currency,
                      product_data: {
                        name: `Registration fee for ${registrationOption.event.title}`,
                      },
                      unit_amount: effectivePrice,
                    },
                    ...(selectedTaxRateId
                      ? { tax_rates: [selectedTaxRateId] as string[] }
                      : {}),
                    quantity: 1,
                  },
                ],
                metadata: {
                  registrationId: userRegistration.id,
                  tenantId: tenant.id,
                  transactionId,
                },
                mode: 'payment',
                payment_intent_data: {
                  application_fee_amount: applicationFee,
                },
                success_url: `${eventUrl}?registrationStatus=success`,
              },
              { stripeAccount },
            );

            await database.insert(transactions).values({
              amount: effectivePrice,
              comment: `Registration for event ${registrationOption.event.title} ${registrationOption.eventId}`,
              currency: tenant.currency,
              eventId: registrationOption.eventId,
              eventRegistrationId: userRegistration.id,
              executiveUserId: user.id,
              id: transactionId,
              method: 'stripe',
              status: 'pending',
              stripeCheckoutSessionId: session.id,
              stripeCheckoutUrl: session.url,
              stripePaymentIntentId:
                typeof session.payment_intent === 'string'
                  ? session.payment_intent
                  : session.payment_intent?.id,
              targetUserId: user.id,
              tenantId: tenant.id,
              type: 'registration',
            });
            return true;
          } catch (error) {
            consola.error('events.registerForEvent.failed', {
              error: error instanceof Error ? error.message : String(error),
              registrationId: userRegistration.id,
              tenantId: tenant.id,
            });
            return false;
          }
        });
        if (!registerForEventSucceeded) {
          const rollbackRegistrationOption =
            yield* Effect.promise(() =>
              database.query.eventRegistrationOptions.findFirst({
                where: {
                  eventId,
                  id: registrationOptionId,
                },
              }),
            );
          if (rollbackRegistrationOption) {
            yield* Effect.promise(() =>
              database
                .update(eventRegistrationOptions)
                .set({
                  reservedSpots: Math.max(
                    0,
                    rollbackRegistrationOption.reservedSpots - 1,
                  ),
                })
                .where(
                  and(
                    eq(eventRegistrationOptions.id, rollbackRegistrationOption.id),
                    eq(eventRegistrationOptions.eventId, eventId),
                  ),
                ),
            );
          }
          yield* Effect.promise(() =>
            database
              .delete(eventRegistrations)
              .where(eq(eventRegistrations.id, userRegistration.id)),
          );
          return yield* Effect.fail('INTERNAL_SERVER_ERROR' as const);
        }
      }),
    'events.registrationScanned': ({ registrationId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        const registration = yield* Effect.promise(() =>
          database.query.eventRegistrations.findFirst({
            where: { id: registrationId, tenantId: tenant.id },
            with: {
              event: {
                columns: {
                  start: true,
                  title: true,
                },
              },
              registrationOption: {
                columns: {
                  price: true,
                  title: true,
                },
              },
              transactions: {
                columns: {
                  amount: true,
                },
                where: {
                  type: 'registration',
                },
              },
              user: {
                columns: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          }),
        );
        if (!registration || !registration.user || !registration.event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const sameUserIssue = registration.userId === user.id;
        const registrationStatusIssue = registration.status !== 'CONFIRMED';
        const allowCheckin = !registrationStatusIssue && !sameUserIssue;
        const discountedTransaction = registration.transactions.find(
          (transaction) =>
            transaction.amount < registration.registrationOption.price,
        );
        const appliedDiscountedPrice =
          registration.appliedDiscountedPrice ??
          discountedTransaction?.amount ??
          null;
        const appliedDiscountType =
          registration.appliedDiscountType ??
          (appliedDiscountedPrice === null ? null : ('esnCard' as const));

        return {
          allowCheckin,
          appliedDiscountType,
          event: {
            start: registration.event.start.toISOString(),
            title: registration.event.title,
          },
          registrationOption: {
            title: registration.registrationOption.title,
          },
          registrationStatusIssue,
          sameUserIssue,
          user: {
            firstName: registration.user.firstName,
            lastName: registration.user.lastName,
          },
        };
      }),
    'events.reviewEvent': ({ approved, comment, eventId }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:review');
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        const reviewedEvents = yield* Effect.promise(() =>
          database
            .update(eventInstances)
            .set({
              reviewedAt: new Date(),
              reviewedBy: user.id,
              status: approved ? 'APPROVED' : 'REJECTED',
              // eslint-disable-next-line unicorn/no-null
              statusComment: comment || null,
            })
            .where(
              and(
                eq(eventInstances.id, eventId),
                eq(eventInstances.tenantId, tenant.id),
                eq(eventInstances.status, 'PENDING_REVIEW'),
              ),
            )
            .returning({
              id: eventInstances.id,
            }),
        );
        if (reviewedEvents.length > 0) {
          return;
        }

        const event = yield* Effect.promise(() =>
          database.query.eventInstances.findFirst({
            columns: { id: true },
            where: {
              id: eventId,
              tenantId: tenant.id,
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        return yield* Effect.fail('CONFLICT' as const);
      }),
    'events.submitForReview': ({ eventId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        const event = yield* Effect.promise(() =>
          database.query.eventInstances.findFirst({
            columns: {
              creatorId: true,
              id: true,
              status: true,
            },
            where: {
              id: eventId,
              tenantId: tenant.id,
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        if (
          !canEditEvent({
            creatorId: event.creatorId,
            permissions: user.permissions,
            userId: user.id,
          })
        ) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }
        if (event.status !== 'DRAFT' && event.status !== 'REJECTED') {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const submittedEvents = yield* Effect.promise(() =>
          database
            .update(eventInstances)
            .set({
              // eslint-disable-next-line unicorn/no-null
              reviewedAt: null,
              // eslint-disable-next-line unicorn/no-null
              reviewedBy: null,
              status: 'PENDING_REVIEW',
              // eslint-disable-next-line unicorn/no-null
              statusComment: null,
            })
            .where(
              and(
                eq(eventInstances.id, eventId),
                eq(eventInstances.tenantId, tenant.id),
                inArray(eventInstances.status, ['DRAFT', 'REJECTED']),
              ),
            )
            .returning({
              id: eventInstances.id,
            }),
        );
        if (submittedEvents.length > 0) {
          return;
        }

        return yield* Effect.fail('CONFLICT' as const);
      }),
    'events.update': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const user = yield* requireUserHeader(options.headers);

        const start = new Date(input.start);
        const end = new Date(input.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const sanitizedDescription = sanitizeRichTextHtml(input.description);
        if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }
        const sanitizedRegistrationOptions = input.registrationOptions.map(
          (option) => ({
            ...option,
            closeRegistrationTime: new Date(option.closeRegistrationTime),
            description: sanitizeOptionalRichTextHtml(option.description),
            esnCardDiscountedPrice:
              option.esnCardDiscountedPrice === undefined
                ? null
                : option.esnCardDiscountedPrice,
            openRegistrationTime: new Date(option.openRegistrationTime),
            registeredDescription: sanitizeOptionalRichTextHtml(
              option.registeredDescription,
            ),
          }),
        );

        const event = yield* Effect.promise(() =>
          database.query.eventInstances.findFirst({
            where: {
              id: input.eventId,
              tenantId: tenant.id,
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }
        if (
          !canEditEvent({
            creatorId: event.creatorId,
            permissions: user.permissions,
            userId: user.id,
          })
        ) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }
        if (
          !EDITABLE_EVENT_STATUSES.includes(
            event.status as (typeof EDITABLE_EVENT_STATUSES)[number],
          )
        ) {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const esnCardEnabledForTenant = isEsnCardEnabled(
          tenant.discountProviders ?? null,
        );

        for (const option of sanitizedRegistrationOptions) {
          if (
            Number.isNaN(option.closeRegistrationTime.getTime()) ||
            Number.isNaN(option.openRegistrationTime.getTime())
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          const validation = yield* Effect.promise(() =>
            validateTaxRate({
              isPaid: option.isPaid,
              // eslint-disable-next-line unicorn/no-null
              stripeTaxRateId: option.stripeTaxRateId ?? null,
              tenantId: tenant.id,
            }),
          );
          if (!validation.success) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          if (
            option.esnCardDiscountedPrice !== null &&
            option.esnCardDiscountedPrice > option.price
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          if (
            option.esnCardDiscountedPrice !== null &&
            !esnCardEnabledForTenant &&
            option.isPaid
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          if (option.spots < 0) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }
        }

        const updatedEvent = yield* Effect.tryPromise({
          catch: (error): 'BAD_REQUEST' | 'CONFLICT' | 'INTERNAL_SERVER_ERROR' => {
            if (
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              (error as { code: unknown }).code === 'BAD_REQUEST'
            ) {
              return 'BAD_REQUEST';
            }
            if (
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              (error as { code: unknown }).code === 'CONFLICT'
            ) {
              return 'CONFLICT';
            }
            return 'INTERNAL_SERVER_ERROR';
          },
          try: () =>
            database.transaction(async (tx) => {
              const updatedEvents = await tx
                .update(eventInstances)
                .set({
                  description: sanitizedDescription,
                  end,
                  icon: input.icon,
                  location: input.location,
                  start,
                  title: input.title,
                })
                .where(
                  and(
                    eq(eventInstances.id, input.eventId),
                    eq(eventInstances.tenantId, tenant.id),
                    inArray(eventInstances.status, [...EDITABLE_EVENT_STATUSES]),
                  ),
                )
                .returning({
                  id: eventInstances.id,
                });
              const eventRow = updatedEvents[0];
              if (!eventRow) {
                throw { code: 'CONFLICT' };
              }

              const existingRegistrationRows =
                await tx.query.eventRegistrationOptions.findMany({
                  where: {
                    eventId: input.eventId,
                  },
                });
              const existingRegistrationOptionIds = new Set(
                existingRegistrationRows.map((option) => option.id),
              );
              for (const option of sanitizedRegistrationOptions) {
                if (!existingRegistrationOptionIds.has(option.id)) {
                  throw { code: 'BAD_REQUEST' };
                }
              }

              await Promise.all(
                sanitizedRegistrationOptions.map((option) =>
                  tx
                    .update(eventRegistrationOptions)
                    .set({
                      closeRegistrationTime: option.closeRegistrationTime,
                      description: option.description,
                      isPaid: option.isPaid,
                      openRegistrationTime: option.openRegistrationTime,
                      organizingRegistration: option.organizingRegistration,
                      price: option.price,
                      registeredDescription: option.registeredDescription,
                      registrationMode: option.registrationMode,
                      roleIds: [...option.roleIds],
                      spots: option.spots,
                      // eslint-disable-next-line unicorn/no-null
                      stripeTaxRateId: option.stripeTaxRateId ?? null,
                      title: option.title,
                    })
                    .where(
                      and(
                        eq(eventRegistrationOptions.eventId, input.eventId),
                        eq(eventRegistrationOptions.id, option.id),
                      ),
                    ),
                ),
              );

              const existingEsnDiscounts =
                sanitizedRegistrationOptions.length === 0
                  ? []
                  : await tx
                      .select()
                      .from(eventRegistrationOptionDiscounts)
                      .where(
                        and(
                          eq(
                            eventRegistrationOptionDiscounts.discountType,
                            'esnCard',
                          ),
                          inArray(
                            eventRegistrationOptionDiscounts.registrationOptionId,
                            sanitizedRegistrationOptions.map(
                              (registrationOption) => registrationOption.id,
                            ),
                          ),
                        ),
                      );
              const existingEsnDiscountByRegistrationOptionId = new Map(
                existingEsnDiscounts.map((discount) => [
                  discount.registrationOptionId,
                  discount,
                ]),
              );

              for (const option of sanitizedRegistrationOptions) {
                const existingDiscount =
                  existingEsnDiscountByRegistrationOptionId.get(option.id);
                const shouldPersistDiscount =
                  esnCardEnabledForTenant &&
                  option.isPaid &&
                  option.esnCardDiscountedPrice !== null;

                if (!shouldPersistDiscount) {
                  if (existingDiscount) {
                    await tx
                      .delete(eventRegistrationOptionDiscounts)
                      .where(eq(eventRegistrationOptionDiscounts.id, existingDiscount.id));
                  }
                  continue;
                }

                const discountedPrice = option.esnCardDiscountedPrice;
                if (discountedPrice === null) {
                  continue;
                }

                if (existingDiscount) {
                  await tx
                    .update(eventRegistrationOptionDiscounts)
                    .set({
                      discountedPrice,
                    })
                    .where(eq(eventRegistrationOptionDiscounts.id, existingDiscount.id));
                  continue;
                }

                await tx.insert(eventRegistrationOptionDiscounts).values({
                  discountedPrice,
                  discountType: 'esnCard',
                  registrationOptionId: option.id,
                });
              }

              return eventRow;
            }),
        });

        return {
          id: updatedEvent.id,
        };
      }),
    'events.updateListing': ({ eventId, unlisted }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:changeListing');
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);

        yield* Effect.promise(() =>
          database
            .update(eventInstances)
            .set({ unlisted })
            .where(
              and(
                eq(eventInstances.tenantId, tenant.id),
                eq(eventInstances.id, eventId),
              ),
            ),
        );
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
