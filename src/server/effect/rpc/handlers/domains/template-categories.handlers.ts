 

import type { Headers } from '@effect/platform';

import {
  and,
  eq,
} from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventTemplateCategories,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  ConfigPermissions,
  type TemplateCategoryRecord,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { Tenant } from '../../../../../types/custom/tenant';
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

export const templateCategoryHandlers = {
    'templateCategories.create': ({ icon, title }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'templates:manageCategories');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );

        yield* databaseEffect((database) =>
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
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const templateCategories = yield* databaseEffect((database) =>
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
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const updatedCategories = yield* databaseEffect((database) =>
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
} satisfies Partial<AppRpcHandlers>;
