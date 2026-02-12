import type { Headers } from '@effect/platform';

import { and, eq } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { database } from '../../../db';
import {
  eventTemplateCategories,
  eventTemplates,
  icons,
  users,
} from '../../../db/schema';
import { type Permission } from '../../../shared/permissions/permissions';
import {
  AppRpcs,
  ConfigPermissions,
  type IconRecord,
  type IconRpcError,
  type TemplateCategoryRecord,
  type TemplateCategoryRpcError,
  type TemplateListRecord,
  type TemplatesByCategoryRecord,
} from '../../../shared/rpc-contracts/app-rpcs';
import { Tenant } from '../../../types/custom/tenant';
import { User } from '../../../types/custom/user';
import { serverEnvironment } from '../../config/environment';
import { computeIconSourceColor } from '../../utils/icon-color';
import { getPublicConfigEffect } from '../config/public-config.effect';

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
): Effect.Effect<void, TemplateCategoryRpcError> =>
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
