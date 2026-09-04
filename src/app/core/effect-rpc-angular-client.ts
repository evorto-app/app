import type { Layer } from 'effect';
import type * as RpcClient from 'effect/unstable/rpc/RpcClient';

import {
  createEnvironmentInjector,
  DestroyRef,
  EnvironmentInjector,
  inject,
  InjectionToken,
  makeEnvironmentProviders,
  runInInjectionContext,
} from '@angular/core';
import { createEffectRpcAngularClient } from '@heddendorp/effect-angular-query';
import { EFFECT_RPC_PROTOCOL_HTTP_LAYER } from '@heddendorp/effect-platform-angular';

import { AppRpcs } from '../../shared/rpc-contracts/app-rpcs';

export class ServerRpcOriginResolutionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ServerRpcOriginResolutionError';
  }
}

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname === '[::1]';

const normalizeInternalServerRpcOrigin = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServerRpcOriginResolutionError(
      'SSR_RPC_ORIGIN must be an absolute HTTP or HTTPS URL',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ServerRpcOriginResolutionError(
      'SSR_RPC_ORIGIN must use HTTP or HTTPS',
    );
  }

  if (!isLoopbackHostname(url.hostname)) {
    throw new ServerRpcOriginResolutionError(
      'SSR_RPC_ORIGIN must point to a loopback host',
    );
  }

  if (
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new ServerRpcOriginResolutionError(
      'SSR_RPC_ORIGIN must be an origin without credentials, a path, a query, or a fragment',
    );
  }

  return url.origin;
};

interface ServerProcessLike {
  readonly env?: Record<string, string | undefined>;
}

export const resolveTrustedServerRpcOrigin = (): string | undefined => {
  const processLike = (
    globalThis as typeof globalThis & { readonly process?: ServerProcessLike }
  ).process;
  const configuredOrigin = processLike?.env?.['SSR_RPC_ORIGIN']?.trim();

  return configuredOrigin
    ? normalizeInternalServerRpcOrigin(configuredOrigin)
    : undefined;
};

export const resolveServerRpcOrigin = (): string => {
  const configuredOrigin = resolveTrustedServerRpcOrigin();
  if (configuredOrigin) {
    return configuredOrigin;
  }

  throw new ServerRpcOriginResolutionError(
    'SSR RPC origin is unavailable: set SSR_RPC_ORIGIN to the app loopback origin',
  );
};

export const resolveRpcUrl = (): string =>
  'window' in globalThis ? '/rpc' : `${resolveServerRpcOrigin()}/rpc`;

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

type AppRpcClient = ReturnType<
  ReturnType<typeof createAppRpcFactory>['injectClient']
>;

export const APP_RPC_CLIENT = new InjectionToken<AppRpcClient>(
  'APP_RPC_CLIENT',
);

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

  return runInInjectionContext(scopedInjector, () =>
    appRpcFactory.injectClient(),
  );
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
