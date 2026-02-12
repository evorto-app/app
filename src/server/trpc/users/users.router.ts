import { eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import {
  authenticatedProcedure,
  router,
} from '../trpc-server';

export const userRouter = router({
  findOne: authenticatedProcedure
    .meta({ requiredPermissions: ['users:viewAll'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          id: Schema.NonEmptyString,
        }),
      ),
    )
    .query(async ({ input }) => {
      const result = await database
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, input.id))
        .limit(1);
      return result[0];
    }),

});
