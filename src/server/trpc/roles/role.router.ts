import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { roles } from '../../../db/schema';
import { roleSchema, roleUpdateSchema } from '../../../shared/role';
import { authenticatedProcedure, router } from '../trpc-server';

export const roleRouter = router({
  create: authenticatedProcedure
    .input(Schema.decodeUnknownSync(roleSchema))
    .mutation(async ({ ctx, input }) => {
      return await database
        .insert(roles)
        .values({
          ...input,
          tenantId: ctx.tenant.id,
        })
        .returning();
    }),

  delete: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString })),
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
      Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString })),
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
    .input(Schema.decodeUnknownSync(roleUpdateSchema))
    .mutation(async ({ ctx, input }) => {
      return await database
        .update(roles)
        .set({
          ...input.role,
          tenantId: ctx.tenant.id,
        })
        .where(and(eq(roles.id, input.id), eq(roles.tenantId, ctx.tenant.id)))
        .returning();
    }),
});
