import { Effect, Option } from 'effect';

import { type PublicConfig } from '../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { RuntimeConfig } from '../../config/runtime-config';

export const getPublicConfigEffect = Effect.gen(function* () {
  const runtimeConfig = yield* RuntimeConfig;

  return {
    googleMapsApiKey: Option.getOrNull(
      runtimeConfig.server.PUBLIC_GOOGLE_MAPS_API_KEY,
    ),
    sentryDsn: Option.getOrNull(runtimeConfig.server.PUBLIC_SENTRY_DSN),
  } satisfies PublicConfig;
});
