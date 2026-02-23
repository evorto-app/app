import type * as RpcClient from '@effect/rpc/RpcClient';
import type * as Layer from 'effect/Layer';

import {
  createEnvironmentInjector,
  DestroyRef,
  EnvironmentInjector,
  inject,
  InjectionToken,
  makeEnvironmentProviders,
  REQUEST,
  runInInjectionContext,
} from '@angular/core';
import { createEffectRpcAngularClient } from '@heddendorp/effect-angular-query';
import { EFFECT_RPC_PROTOCOL_HTTP_LAYER } from '@heddendorp/effect-platform-angular';

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

const resolveRequestOrigin = (): string | undefined => {
  try {
    const request = inject(REQUEST, { optional: true });
    if (request && typeof request.url === 'string') {
      return new URL(request.url).origin;
    }
  } catch {
    // Ignore missing DI context while resolving fallback URL.
  }

  return;
};

export const resolveRpcUrl = (): string =>
  'window' in globalThis
    ? '/rpc'
    : `${normalizeBaseUrl(resolveRequestOrigin() ?? resolveServerBaseUrl())}/rpc`;

const createAppRpcFactory = (
  rpcLayer: Layer.Layer<RpcClient.Protocol, never, never>,
) =>
  createEffectRpcAngularClient({
    group: AppRpcs,
    keyPrefix: 'rpc',
    mutationDefaults: {},
    queryDefaults: {
      retry: false,
    },
    rpcLayer,
  });

type AppRpcClient = ReturnType<ReturnType<typeof createAppRpcFactory>['injectClient']>;

const APP_RPC_CLIENT = new InjectionToken<AppRpcClient>('APP_RPC_CLIENT');

const createAppRpcClient = (): AppRpcClient => {
  const rpcLayer = inject(EFFECT_RPC_PROTOCOL_HTTP_LAYER);
  const environmentInjector = inject(EnvironmentInjector);
  const destroyReference = inject(DestroyRef);

  const appRpcFactory = createAppRpcFactory(rpcLayer);

  const scopedInjector = createEnvironmentInjector(
    [appRpcFactory.providers],
    environmentInjector,
  );
  destroyReference.onDestroy(() => scopedInjector.destroy());

  return runInInjectionContext(scopedInjector, () => appRpcFactory.injectClient());
};

export const AppRpc = {
  injectClient: (): AppRpcClient => inject(APP_RPC_CLIENT),
  providers: makeEnvironmentProviders([
    {
      provide: APP_RPC_CLIENT,
      useFactory: createAppRpcClient,
    },
  ]),
} as const;
