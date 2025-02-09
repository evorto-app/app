import type { SQLWrapper } from 'drizzle-orm/sql/sql';

import { and, eq, ilike, like } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { roles } from '../../../db/schema';
import { PermissionSchema } from '../../../shared/permissions/permissions';
import { authenticatedProcedure, router } from '../trpc-server';

export const roleRouter = router({
  create: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:manageRoles'] })
    .input(
      Schema.decodeUnknownSync(
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
      Schema.decodeUnknownSync(
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

  findMany: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          defaultOrganizerRole: Schema.optional(Schema.Boolean),
          defaultUserRole: Schema.optional(Schema.Boolean),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const conditions: SQLWrapper[] = [eq(roles.tenantId, ctx.tenant.id)];
      if (input.defaultUserRole !== undefined) {
        conditions.push(eq(roles.defaultUserRole, input.defaultUserRole));
      }
      if (input.defaultOrganizerRole !== undefined) {
        conditions.push(
          eq(roles.defaultOrganizerRole, input.defaultOrganizerRole),
        );
      }
      return await database.query.roles.findMany({
        orderBy: (roles, { asc }) => [asc(roles.name)],
        where: and(...conditions),
      });
    }),

  findOne: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:manageRoles'] })
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          id: Schema.NonEmptyString,
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const role = await database.query.roles.findFirst({
        where: and(eq(roles.id, input.id), eq(roles.tenantId, ctx.tenant.id)),
      });
      if (!role) {
        throw new Error('Role not found');
      }
      return role;
    }),

  search: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:manageRoles'] })
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          search: Schema.String,
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      return await database.query.roles.findMany({
        limit: 15,
        orderBy: (roles, { asc }) => [asc(roles.name)],
        where: and(
          eq(roles.tenantId, ctx.tenant.id),
          ilike(roles.name, `%${input.search}%`),
        ),
      });
    }),

  update: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:manageRoles'] })
    .input(
      Schema.decodeUnknownSync(
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
