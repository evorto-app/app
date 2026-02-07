import { Schema } from 'effect';

import {
  getPublicGoogleMapsApiKey,
  serverEnvironment,
} from '../../config/environment';
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
      const googleMapsApiKey = getPublicGoogleMapsApiKey(serverEnvironment);

      return {
        // eslint-disable-next-line unicorn/no-null
        googleMapsApiKey: googleMapsApiKey ?? null,
        // eslint-disable-next-line unicorn/no-null
        sentryDsn: serverEnvironment.PUBLIC_SENTRY_DSN ?? null,
      };
    }),
  tenant: publicProcedure.query(({ ctx }) => ctx.tenant),
});
