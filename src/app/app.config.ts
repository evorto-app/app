import {
  HttpClient,
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  ApplicationConfig,
  DEFAULT_CURRENCY_CODE,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideZonelessChangeDetection,
} from '@angular/core';
import { isDevMode } from '@angular/core';
import { provideLuxonDateAdapter } from '@angular/material-luxon-adapter';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import {
  provideRouter,
  Router,
  withComponentInputBinding,
  withRouterConfig,
  withViewTransitions,
} from '@angular/router';
import { FetchHttpClient } from '@effect/platform';
import * as RpcClient from '@effect/rpc/RpcClient';
import * as RpcSerialization from '@effect/rpc/RpcSerialization';
import { provideEffectRpcQueryClient } from '@heddendorp/effect-angular-query';
import {
  createTRPCClientFactory,
  provideTRPC,
} from '@heddendorp/tanstack-angular-query';
import { angularHttpLink } from '@heddendorp/trpc-link-angular';
import * as Sentry from '@sentry/angular';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { withDevtools } from '@tanstack/angular-query-experimental/devtools';
import { createTRPCClient } from '@trpc/client';
import { Layer } from 'effect';
import superjson from 'superjson';

import type { AppRouter } from '../server/trpc/app-router';

import { AppRpcs } from '../shared/rpc-contracts/app-rpcs';
import { routes } from './app.routes';
import { authTokenInterceptor } from './core/auth-token.interceptor';
import { ConfigService } from './core/config.service';

const effectRpcLayer = RpcClient.layerProtocolHttp({ url: '/rpc' }).pipe(
  Layer.provide([RpcSerialization.layerJson, FetchHttpClient.layer]),
);

export const appConfig: ApplicationConfig = {
  providers: [
    provideAnimationsAsync(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authTokenInterceptor])),
    provideTRPC(
      createTRPCClientFactory(() => {
        const http = inject(HttpClient);
        return createTRPCClient<AppRouter>({
          links: [
            angularHttpLink({
              httpClient: http,
              transformer: superjson,
              url: '/trpc',
            }),
          ],
        });
      }),
    ),
    provideClientHydration(withEventReplay()),
    // Enable TanStack Query devtools only in dev mode
    provideTanStackQuery(
      new QueryClient(),
      ...(isDevMode() ? ([withDevtools()] as const) : ([] as const)),
    ),
    provideEffectRpcQueryClient({
      group: AppRpcs,
      keyPrefix: 'rpc',
      rpcLayer: effectRpcLayer,
    }),
    provideLuxonDateAdapter(),
    // provideCloudflareLoader(
    //   'https://imagedelivery.net/DxTiV2GJoeCDYZ1DN5RPUA/',
    // ),
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: {
        appearance: 'outline',
      },
    },
    {
      provide: ErrorHandler,
      useValue: Sentry.createErrorHandler(),
    },
    {
      deps: [Router],
      provide: Sentry.TraceService,
    },
    provideAppInitializer(async () => {
      inject(Sentry.TraceService);
      const config = inject(ConfigService);
      await config.initialize();
    }),
    {
      deps: [ConfigService],
      provide: DEFAULT_CURRENCY_CODE,
      useFactory: (config: ConfigService) => config.tenant.currency,
    },
  ],
};
