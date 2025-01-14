import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { roles } from '../../../db/schema';
import { PermissionSchema } from '../../../shared/permissions/permissions';
import { authenticatedProcedure, router } from '../trpc-server';

export const roleRouter = router({
  create: authenticatedProcedure
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

  findMany: authenticatedProcedure.query(async ({ ctx }) => {
    return await database.query.roles.findMany({
      orderBy: (roles, { asc }) => [asc(roles.name)],
      where: eq(roles.tenantId, ctx.tenant.id),
    });
  }),

  findOne: authenticatedProcedure
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

  update: authenticatedProcedure
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
