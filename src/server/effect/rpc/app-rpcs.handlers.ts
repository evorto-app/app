import { Effect } from 'effect';

import { AppRpcs } from '../../../shared/rpc-contracts/app-rpcs';
import { serverEnvironment } from '../../config/environment';
import { getPublicConfigEffect } from '../config/public-config.effect';

export const appRpcHandlers = AppRpcs.toLayer(
  Effect.succeed({
    'config.public': () => getPublicConfigEffect(serverEnvironment),
  }),
);
