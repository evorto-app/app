import { FetchHttpClient } from '@effect/platform';
import * as RpcClient from '@effect/rpc/RpcClient';
import * as RpcSerialization from '@effect/rpc/RpcSerialization';
import { createEffectRpcAngularClient } from '@heddendorp/effect-angular-query';
import { Layer } from 'effect';

import { AppRpcs } from '../../shared/rpc-contracts/app-rpcs';

const normalizeBaseUrl = (value: string): string =>
  value.endsWith('/') ? value.slice(0, -1) : value;

const resolveServerBaseUrl = (): string => {
  const processEnvironment = (
    globalThis as {
      process?: {
        env?: Record<string, string | undefined>;
      };
    }
  ).process?.env;

  const configuredBaseUrl = processEnvironment?.['BASE_URL']?.trim();
  if (configuredBaseUrl) {
    return normalizeBaseUrl(configuredBaseUrl);
  }

  return 'http://localhost:4200';
};

export const resolveRpcUrl = (): string =>
  'window' in globalThis ? '/rpc' : `${resolveServerBaseUrl()}/rpc`;

const effectRpcLayer = RpcClient.layerProtocolHttp({
  url: resolveRpcUrl(),
}).pipe(Layer.provide([RpcSerialization.layerJson, FetchHttpClient.layer]));

export const AppRpc = createEffectRpcAngularClient({
  group: AppRpcs,
  keyPrefix: 'rpc',
  mutationDefaults: {},
  queryDefaults: {},
  rpcLayer: effectRpcLayer,
});
