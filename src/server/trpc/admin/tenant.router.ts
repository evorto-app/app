import { eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

export const tenantRouter = router({
  currentSettings: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:changeSettings'] })
    .query(async ({ ctx }) => {
      const tenant = await database.query.tenants.findFirst({
        where: {
          id: ctx.tenant.id,
        },
      });

      return tenant;
    }),

  updateSettings: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:changeSettings'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          defaultLocation: Schema.NullOr(Schema.Any),
          theme: Schema.mutable(Schema.Literal('evorto', 'esn')),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const tenant = await database
        .update(schema.tenants)
        .set({
          defaultLocation: input.defaultLocation,
          theme: input.theme,
        })
        .where(eq(schema.tenants.id, ctx.tenant.id))
        .returning()
        .then((result) => result[0]);

      return tenant;
    }),
});
