import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { roles } from '../../../db/schema';
import { PermissionSchema } from '../../schemas/permission.schema';
import { authenticatedProcedure, router } from '../trpc-server';

export const roleRouter = router({
  create: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:manageRoles'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          defaultOrganizerRole: Schema.Boolean,
          defaultUserRole: Schema.Boolean,
          description: Schema.NullOr(Schema.NonEmptyString),
          name: Schema.NonEmptyString,
          permissions: Schema.mutable(Schema.Array(PermissionSchema)),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return await database
        .insert(roles)
        .values({
          defaultOrganizerRole: input.defaultOrganizerRole,
          defaultUserRole: input.defaultUserRole,
          description: input.description,
          name: input.name,
          permissions: input.permissions,
          tenantId: ctx.tenant.id,
        })
        .returning()
        .then((result) => result[0]);
    }),

  delete: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:manageRoles'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          id: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return await database
        .delete(roles)
        .where(and(eq(roles.id, input.id), eq(roles.tenantId, ctx.tenant.id)))
        .returning();
    }),

  findHubRoles: authenticatedProcedure.query(async ({ ctx }) => {
    return database.query.roles
      .findMany({
        columns: {
          description: true,
          id: true,
          name: true,
        },
        orderBy: (roles, { asc }) => [asc(roles.sortOrder), asc(roles.name)],
        where: {
          displayInHub: true,
          tenantId: ctx.tenant.id,
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
      })
      .then((result) =>
        result.map((role) => ({
          ...role,
          userCount: role.usersToTenants.length,
          users: role.usersToTenants.map((utt) => utt.user),
          usersToTenants: undefined,
        })),
      );
  }),

  findMany: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          defaultOrganizerRole: Schema.optional(Schema.Boolean),
          defaultUserRole: Schema.optional(Schema.Boolean),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      return await database.query.roles.findMany({
        orderBy: { name: 'asc' },
        where: {
          tenantId: ctx.tenant.id,
          ...(input.defaultUserRole !== undefined && {
            defaultUserRole: input.defaultUserRole,
          }),
          ...(input.defaultOrganizerRole !== undefined && {
            defaultOrganizerRole: input.defaultOrganizerRole,
          }),
        },
      });
    }),

  findOne: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:manageRoles'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          id: Schema.NonEmptyString,
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const role = await database.query.roles.findFirst({
        where: { id: input.id, tenantId: ctx.tenant.id },
      });
      if (!role) {
        throw new Error('Role not found');
      }
      return role;
    }),

  search: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:manageRoles'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          search: Schema.String,
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      return await database.query.roles.findMany({
        limit: 15,
        orderBy: { name: 'asc' },
        where: {
          name: { ilike: `%${input.search}%` },
          tenantId: ctx.tenant.id,
        },
      });
    }),

  update: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:manageRoles'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          defaultOrganizerRole: Schema.Boolean,
          defaultUserRole: Schema.Boolean,
          description: Schema.NullOr(Schema.NonEmptyString),
          id: Schema.NonEmptyString,
          name: Schema.NonEmptyString,
          permissions: Schema.mutable(Schema.Array(PermissionSchema)),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return await database
        .update(roles)
        .set({
          defaultOrganizerRole: input.defaultOrganizerRole,
          defaultUserRole: input.defaultUserRole,
          description: input.description,
          name: input.name,
          permissions: input.permissions,
          tenantId: ctx.tenant.id,
        })
        .where(and(eq(roles.id, input.id), eq(roles.tenantId, ctx.tenant.id)))
        .returning();
    }),
});
