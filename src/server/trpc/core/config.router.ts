import { Effect, Schema } from 'effect';

import { serverEnvironment } from '../../config/environment';
import {
  getPublicConfigEffect,
  PublicConfig,
} from '../../effect/config/public-config.effect';
import { publicProcedure, router } from '../trpc-server';

export const configRouter = router({
  isAuthenticated: publicProcedure.query(
    ({ ctx }) => ctx.authentication.isAuthenticated,
  ),
  permissions: publicProcedure.query(({ ctx }) => ctx.user?.permissions ?? []),
  public: publicProcedure
    .output(Schema.standardSchemaV1(PublicConfig))
    .query(() => Effect.runPromise(getPublicConfigEffect(serverEnvironment))),
  tenant: publicProcedure.query(({ ctx }) => ctx.tenant),
});
