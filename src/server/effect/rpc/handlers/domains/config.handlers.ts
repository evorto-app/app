 






import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import {
  ConfigPermissions,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { Tenant } from '../../../../../types/custom/tenant';
import { serverEnvironment } from '../../../../config/environment';
import { getPublicConfigEffect } from '../../../config/public-config.effect';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../../rpc-context-headers';

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

export const configHandlers = {
    'config.isAuthenticated': (_payload, options) =>
      Effect.succeed(
        options.headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true',
      ),
    'config.permissions': (_payload, options) =>
      Effect.sync(() =>
        decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
          ConfigPermissions,
        ),
      ),
    'config.public': () => getPublicConfigEffect(serverEnvironment),
    'config.tenant': (_payload, options) =>
      Effect.sync(() =>
        decodeHeaderJson(options.headers[RPC_CONTEXT_HEADERS.TENANT], Tenant),
      ),
} satisfies Partial<AppRpcHandlers>;
