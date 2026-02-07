import { Effect, Schema } from 'effect';

import {
  AppRpcs,
  ConfigPermissions,
} from '../../../shared/rpc-contracts/app-rpcs';
import { Tenant } from '../../../types/custom/tenant';
import { serverEnvironment } from '../../config/environment';
import { getPublicConfigEffect } from '../config/public-config.effect';

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(JSON.parse(value ?? 'null'));

export const appRpcHandlers = AppRpcs.toLayer(
  Effect.succeed({
    'config.isAuthenticated': (_payload, options) =>
      Effect.succeed(options.headers['x-evorto-authenticated'] === 'true'),
    'config.permissions': (_payload, options) =>
      Effect.sync(() =>
        decodeHeaderJson(options.headers['x-evorto-permissions'], ConfigPermissions),
      ),
    'config.public': () => getPublicConfigEffect(serverEnvironment),
    'config.tenant': (_payload, options) =>
      Effect.sync(() =>
        decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant),
      ),
  }),
);
