import { TemplateSimpleNotFoundError } from '@shared/rpc-contracts/app-rpcs/templates.errors';
import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { eventTemplates } from '../../../../db/schema';
import { RpcAccess } from './shared/rpc-access.service';
import { SimpleTemplateService } from './templates/simple-template.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const normalizeTemplateFindOneRecord = (
  template: {
    categoryId: string;
    description: string;
    icon: typeof eventTemplates.$inferSelect.icon;
    id: string;
    location: typeof eventTemplates.$inferSelect.location;
    registrationOptions: readonly {
      closeRegistrationOffset: number;
      description: null | string;
      id: string;
      isPaid: boolean;
      openRegistrationOffset: number;
      organizingRegistration: boolean;
      price: number;
      registeredDescription: null | string;
      registrationMode: 'application' | 'fcfs' | 'random';
      roleIds: string[];
      spots: number;
      stripeTaxRateId: null | string;
      title: string;
    }[];
    title: string;
  },
  rolesById: ReadonlyMap<string, { id: string; name: string }>,
): {
  categoryId: string;
  description: string;
  icon: typeof eventTemplates.$inferSelect.icon;
  id: string;
  location: null | typeof eventTemplates.$inferSelect.location;
  registrationOptions: {
    closeRegistrationOffset: number;
    description: null | string;
    id: string;
    isPaid: boolean;
    openRegistrationOffset: number;
    organizingRegistration: boolean;
    price: number;
    registeredDescription: null | string;
    registrationMode: 'application' | 'fcfs' | 'random';
    roleIds: string[];
    roles: { id: string; name: string }[];
    spots: number;
    stripeTaxRateId: null | string;
    title: string;
  }[];
  title: string;
} => ({
  categoryId: template.categoryId,
  description: template.description,
  icon: template.icon,
  id: template.id,
  location: template.location ?? null,
  registrationOptions: template.registrationOptions.map((option) => ({
    closeRegistrationOffset: option.closeRegistrationOffset,
    description: option.description ?? null,
    id: option.id,
    isPaid: option.isPaid,
    openRegistrationOffset: option.openRegistrationOffset,
    organizingRegistration: option.organizingRegistration,
    price: option.price,
    registeredDescription: option.registeredDescription ?? null,
    registrationMode: option.registrationMode,
    roleIds: option.roleIds,
    roles: option.roleIds.flatMap((roleId) => {
      const role = rolesById.get(roleId);
      return role ? [{ id: role.id, name: role.name }] : [];
    }),
    spots: option.spots,
    stripeTaxRateId: option.stripeTaxRateId ?? null,
    title: option.title,
  })),
  title: template.title,
});

export const templateHandlers = {
  'templates.createSimpleTemplate': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:create');
      const { tenant } = yield* RpcAccess.current();

      return yield* SimpleTemplateService.createSimpleTemplate({
        input,
        tenantId: tenant.id,
      });
    }),
  'templates.findOne': ({ id }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:view');
      const { tenant } = yield* RpcAccess.current();
      const template = yield* databaseEffect((database) =>
        database.query.eventTemplates.findFirst({
          columns: {
            categoryId: true,
            description: true,
            icon: true,
            id: true,
            location: true,
            title: true,
          },
          where: {
            id,
            tenantId: tenant.id,
          },
          with: {
            registrationOptions: {
              columns: {
                closeRegistrationOffset: true,
                description: true,
                id: true,
                isPaid: true,
                openRegistrationOffset: true,
                organizingRegistration: true,
                price: true,
                registeredDescription: true,
                registrationMode: true,
                roleIds: true,
                spots: true,
                stripeTaxRateId: true,
                title: true,
              },
            },
          },
        }),
      );
      if (!template) {
        return yield* Effect.fail(
          new TemplateSimpleNotFoundError({ message: 'Template not found' }),
        );
      }

      const combinedRegistrationOptionRoleIds =
        template.registrationOptions.flatMap((option) => option.roleIds);
      const templateRoles =
        combinedRegistrationOptionRoleIds.length > 0
          ? yield* databaseEffect((database) =>
              database.query.roles.findMany({
                columns: {
                  id: true,
                  name: true,
                },
                where: {
                  id: {
                    in: combinedRegistrationOptionRoleIds,
                  },
                  tenantId: tenant.id,
                },
              }),
            )
          : [];
      const rolesById = new Map(
        templateRoles.map((role) => [
          role.id,
          { id: role.id, name: role.name },
        ]),
      );

      return normalizeTemplateFindOneRecord(template, rolesById);
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
  'templates.updateSimpleTemplate': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:editAll');
      const { tenant } = yield* RpcAccess.current();

      return yield* SimpleTemplateService.updateSimpleTemplate({
        input,
        tenantId: tenant.id,
      });
    }),
} satisfies Partial<AppRpcHandlers>;
