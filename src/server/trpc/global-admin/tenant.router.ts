import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { tenants } from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

export const tenantRouter = router({
  create: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          domain: Schema.NonEmptyString,
          name: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return await database.insert(tenants).values(input).returning();
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
        .delete(tenants)
        .where(eq(tenants.id, input.id))
        .returning();
    }),

  findMany: authenticatedProcedure.query(async ({ ctx }) => {
    return await database.query.tenants.findMany({
      orderBy: (tenants, { asc }) => [asc(tenants.name)],
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
      const tenant = await database.query.tenants.findFirst({
        where: eq(tenants.id, input.id),
      });
      if (!tenant) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Tenant not found',
        });
      }
      return tenant;
    }),

  update: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          domain: Schema.NonEmptyString,
          id: Schema.NonEmptyString,
          name: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return await database
        .update(tenants)
        .set(data)
        .where(eq(tenants.id, id))
        .returning();
    }),
});
