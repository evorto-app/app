import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { roles } from '../../../db/schema';
import { PermissionSchema } from '../../../shared/permissions/permissions';
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
