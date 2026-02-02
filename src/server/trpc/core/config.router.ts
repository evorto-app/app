import { Schema } from 'effect';

import { publicProcedure, router } from '../trpc-server';

export const configRouter = router({
  isAuthenticated: publicProcedure.query(
    ({ ctx }) => ctx.authentication.isAuthenticated,
  ),
  permissions: publicProcedure.query(({ ctx }) => ctx.user?.permissions ?? []),
  public: publicProcedure
    .output(
      Schema.standardSchemaV1(
        Schema.Struct({
          googleMapsApiKey: Schema.NullOr(Schema.NonEmptyString),
          sentryDsn: Schema.NullOr(Schema.NonEmptyString),
        }),
      ),
    )
    .query(() => {
      const googleMapsApiKey =
        process.env['PUBLIC_GOOGLE_MAPS_API_KEY'] ??
        process.env['GOOGLE_MAPS_API_KEY'] ??
        process.env['GOOGLE_API_KEY'] ??
        null;

      return {
        googleMapsApiKey,
        sentryDsn: process.env['PUBLIC_SENTRY_DSN'] ?? null,
      };
    }),
  tenant: publicProcedure.query(({ ctx }) => ctx.tenant),
});
