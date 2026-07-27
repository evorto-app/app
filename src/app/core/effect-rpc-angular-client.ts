import type { Layer } from 'effect';
import type * as RpcClient from 'effect/unstable/rpc/RpcClient';

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

export class ServerRpcOriginResolutionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ServerRpcOriginResolutionError';
  }
}

const normalizeHttpOrigin = (value: string, source: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServerRpcOriginResolutionError(
      `${source} must be an absolute HTTP or HTTPS URL`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ServerRpcOriginResolutionError(
      `${source} must use HTTP or HTTPS`,
    );
  }

  return normalizeBaseUrl(url.origin);
};

const injectionContextErrorPattern = /\bNG0203\b/;

const isMissingInjectionContextError = (error: unknown): boolean =>
  error instanceof Error && injectionContextErrorPattern.test(error.message);

interface ServerProcessLike {
  readonly env?: Record<string, string | undefined>;
}

interface ServerRequestLike {
  readonly url: string;
}

export const resolveTrustedServerRpcOrigin = (): string | undefined => {
  const processLike = (
    globalThis as typeof globalThis & { readonly process?: ServerProcessLike }
  ).process;
  const configuredOrigin = processLike?.env?.['SSR_RPC_ORIGIN']?.trim();

  return configuredOrigin
    ? normalizeHttpOrigin(configuredOrigin, 'SSR_RPC_ORIGIN')
    : undefined;
};

const resolveRequest = (): ServerRequestLike | undefined => {
  try {
    const request = inject(REQUEST, { optional: true });
    if (request && typeof request.url === 'string') {
      return request;
    }
  } catch (error) {
    if (isMissingInjectionContextError(error)) {
      return;
    }
    throw error;
  }

  return;
};

export const resolveServerRpcOrigin = (request?: ServerRequestLike): string => {
  const configuredOrigin = resolveTrustedServerRpcOrigin();
  if (configuredOrigin) {
    return configuredOrigin;
  }

  if (request) {
    return normalizeHttpOrigin(request.url, 'Angular REQUEST URL');
  }

  throw new ServerRpcOriginResolutionError(
    'SSR RPC origin is unavailable: set SSR_RPC_ORIGIN or provide an absolute Angular REQUEST URL',
  );
};

export const resolveRpcUrl = (): string =>
  'window' in globalThis
    ? '/rpc'
    : `${resolveServerRpcOrigin(resolveRequest())}/rpc`;

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
