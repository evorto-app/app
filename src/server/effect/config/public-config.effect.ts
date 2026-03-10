import { Effect } from 'effect';

import { type PublicConfig } from '../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { RuntimeConfig } from '../../config/runtime-config';

export const getPublicConfigEffect = Effect.gen(function* () {
  const runtimeConfig = yield* RuntimeConfig;

  return {
    googleMapsApiKey: runtimeConfig.server.PUBLIC_GOOGLE_MAPS_API_KEY ?? null,
    sentryDsn: runtimeConfig.server.PUBLIC_SENTRY_DSN ?? null,
  } satisfies PublicConfig;
});
