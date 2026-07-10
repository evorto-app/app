import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import {
  TemplateSimpleBadRequestError,
  TemplateSimpleInternalError,
  TemplateSimpleNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/templates.errors';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { eventTemplates } from '../../../../db/schema';
import { lockTenantRoleGraph } from '../../../roles/tenant-role-graph';
import { lockTenantCurrencyForFinancialConfiguration } from '../../../tenant-currency-integrity';
import { RpcAccess } from './shared/rpc-access.service';
import { SimpleTemplateService } from './templates/simple-template.service';
import {
  loadTemplateGraphDetail,
  templateGraphNotFoundError,
} from './templates/template-graph.query';
import { TemplateGraphService } from './templates/template-graph.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const isExpectedTemplateWriteError = (
  error: unknown,
): error is
  | TemplateSimpleBadRequestError
  | TemplateSimpleInternalError
  | TemplateSimpleNotFoundError =>
  error instanceof TemplateSimpleBadRequestError ||
  error instanceof TemplateSimpleInternalError ||
  error instanceof TemplateSimpleNotFoundError;

export const templateHandlers = {
  'templates.create': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:create');
      const { tenant } = yield* RpcAccess.current();

      return yield* Database.use((database) =>
        database
          .transaction((transaction) => {
            const transactionalDatabase = Object.assign(transaction, {
              $client: database.$client,
            });
            return Effect.gen(function* () {
              yield* lockTenantRoleGraph(transaction, tenant.id);
              yield* lockTenantCurrencyForFinancialConfiguration(
                transaction,
                tenant.id,
                tenant.currency,
              );
              const created = yield* TemplateGraphService.createTemplate({
                esnCardEnabled:
                  tenant.discountProviders?.esnCard?.status === 'enabled',
                input,
                tenantId: tenant.id,
              }).pipe(Effect.provideService(Database, transactionalDatabase));

              return yield* loadTemplateGraphDetail(
                transaction,
                tenant.id,
                created.id,
              );
            });
          })
          .pipe(
            Effect.catch((error) =>
              error instanceof RpcBadRequestError
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );
    }),
  'templates.createSimpleTemplate': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:create');
      const { tenant } = yield* RpcAccess.current();

      return yield* Database.use((database) =>
        database
          .transaction((transaction) => {
            const transactionalDatabase = Object.assign(transaction, {
              $client: database.$client,
            });
            return Effect.gen(function* () {
              yield* lockTenantRoleGraph(transaction, tenant.id);
              yield* lockTenantCurrencyForFinancialConfiguration(
                transaction,
                tenant.id,
                tenant.currency,
              ).pipe(
                Effect.catchTag('RpcBadRequestError', (error) =>
                  Effect.fail(
                    new TemplateSimpleBadRequestError({
                      message: `${error.message}. ${error.reason ?? ''}`.trim(),
                    }),
                  ),
                ),
              );
              return yield* SimpleTemplateService.createSimpleTemplate({
                esnCardEnabled:
                  tenant.discountProviders?.esnCard?.status === 'enabled',
                input,
                tenantId: tenant.id,
              }).pipe(Effect.provideService(Database, transactionalDatabase));
            });
          })
          .pipe(
            Effect.catch((error) =>
              isExpectedTemplateWriteError(error)
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );
    }),
  'templates.findOne': ({ id }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:view');
      const { tenant } = yield* RpcAccess.current();

      return yield* Database.use((database) =>
        loadTemplateGraphDetail(database, tenant.id, id).pipe(
          Effect.catchTag('RpcBadRequestError', () =>
            Effect.fail(
              new TemplateSimpleNotFoundError({
                message: 'Template not found',
              }),
            ),
          ),
        ),
      );
    }),
  'templates.groupedByCategory': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:view');
      const { tenant } = yield* RpcAccess.current();
      const templateCategories = yield* databaseEffect((database) =>
        database.query.eventTemplateCategories.findMany({
          columns: {
            icon: true,
            id: true,
            title: true,
          },
          orderBy: (categories, { asc }) => [asc(categories.title)],
          where: { tenantId: tenant.id },
          with: {
            templates: {
              columns: {
                icon: true,
                id: true,
                title: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        }),
      );

      return templateCategories.map((templateCategory) => ({
        icon: templateCategory.icon,
        id: templateCategory.id,
        templates: templateCategory.templates.map((template) => ({
          icon: template.icon,
          id: template.id,
          title: template.title,
        })),
        title: templateCategory.title,
      }));
    }),
  'templates.update': ({ id, ...input }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:editAll');
      const { tenant } = yield* RpcAccess.current();

      return yield* Database.use((database) =>
        database
          .transaction((transaction) => {
            const transactionalDatabase = Object.assign(transaction, {
              $client: database.$client,
            });
            return Effect.gen(function* () {
              yield* lockTenantRoleGraph(transaction, tenant.id);
              yield* lockTenantCurrencyForFinancialConfiguration(
                transaction,
                tenant.id,
                tenant.currency,
              );
              const lockedTemplates = yield* transaction
                .select({ id: eventTemplates.id })
                .from(eventTemplates)
                .where(
                  and(
                    eq(eventTemplates.id, id),
                    eq(eventTemplates.tenantId, tenant.id),
                  ),
                )
                .for('update');
              if (lockedTemplates.length === 0) {
                return yield* Effect.fail(templateGraphNotFoundError(id));
              }

              const before = yield* loadTemplateGraphDetail(
                transaction,
                tenant.id,
                id,
              );
              yield* TemplateGraphService.updateTemplate({
                before,
                esnCardEnabled:
                  tenant.discountProviders?.esnCard?.status === 'enabled',
                input,
                templateId: id,
                tenantId: tenant.id,
              }).pipe(Effect.provideService(Database, transactionalDatabase));

              return yield* loadTemplateGraphDetail(transaction, tenant.id, id);
            });
          })
          .pipe(
            Effect.catch((error) =>
              error instanceof RpcBadRequestError
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );
    }),
  'templates.updateSimpleTemplate': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:editAll');
      const { tenant } = yield* RpcAccess.current();

      return yield* Database.use((database) =>
        database
          .transaction((transaction) => {
            const transactionalDatabase = Object.assign(transaction, {
              $client: database.$client,
            });
            return SimpleTemplateService.updateSimpleTemplate({
              esnCardEnabled:
                tenant.discountProviders?.esnCard?.status === 'enabled',
              input,
              tenantId: tenant.id,
            }).pipe(Effect.provideService(Database, transactionalDatabase));
          })
          .pipe(
            Effect.catch((error) =>
              isExpectedTemplateWriteError(error)
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );
    }),
} satisfies Partial<AppRpcHandlers>;
