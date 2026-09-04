import { TemplateCategoryNotFoundError } from '@shared/rpc-contracts/app-rpcs/template-categories.errors';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { eventTemplateCategories } from '../../../../db/schema';
import { RpcAccess } from './shared/rpc-access.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

export const templateCategoryHandlers = {
  'templateCategories.create': ({ icon, title }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:manageCategories');
      const { tenant } = yield* RpcAccess.current();

      yield* databaseEffect((database) =>
        database.insert(eventTemplateCategories).values({
          icon,
          tenantId: tenant.id,
          title,
        }),
      );
    }),
  'templateCategories.findMany': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const templateCategories = yield* databaseEffect((database) =>
        database.query.eventTemplateCategories.findMany({
          columns: {
            icon: true,
            id: true,
            title: true,
          },
          where: { tenantId: tenant.id },
        }),
      );

      return templateCategories;
    }),
  'templateCategories.update': ({ icon, id, title }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:manageCategories');
      const { tenant } = yield* RpcAccess.current();
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
          .returning({
            icon: eventTemplateCategories.icon,
            id: eventTemplateCategories.id,
            title: eventTemplateCategories.title,
          }),
      );
      const updatedCategory = updatedCategories[0];
      if (!updatedCategory) {
        return yield* Effect.fail(
          new TemplateCategoryNotFoundError({
            id,
            message: 'Category not found',
          }),
        );
      }

      return updatedCategory;
    }),
} satisfies Partial<AppRpcHandlers>;
