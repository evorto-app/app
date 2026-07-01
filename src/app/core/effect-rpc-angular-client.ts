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

const normalizeConfiguredOrigin = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('SSR_RPC_ORIGIN must use http or https');
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
  readonly headers?: Headers;
  readonly url: string;
}

const resolveConfiguredServerRpcOrigin = (): string | undefined => {
  const processLike = (
    globalThis as typeof globalThis & { readonly process?: ServerProcessLike }
  ).process;
  const configuredOrigin = processLike?.env?.['SSR_RPC_ORIGIN']?.trim();

  return configuredOrigin
    ? normalizeConfiguredOrigin(configuredOrigin)
    : undefined;
};

const resolveOriginFromHeaders = (headers?: Headers): string | undefined => {
  if (!headers) {
    return;
  }

  const protocol =
    headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
    headers.get('x-forwarded-protocol')?.split(',')[0]?.trim() ??
    'http';
  const host =
    headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    headers.get('host')?.trim();

  if (!host) {
    return;
  }

  return normalizeBaseUrl(`${protocol}://${host}`);
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
  const configuredOrigin = resolveConfiguredServerRpcOrigin();
  if (configuredOrigin) {
    return configuredOrigin;
  }

  if (request) {
    try {
      return normalizeBaseUrl(new URL(request.url).origin);
    } catch {
      const headerOrigin = resolveOriginFromHeaders(request.headers);
      if (headerOrigin) {
        return headerOrigin;
      }
    }
  }

  return 'http://localhost:4200';
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
