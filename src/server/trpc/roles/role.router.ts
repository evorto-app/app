import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { roles } from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

export const roleRouter = router({
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
});
