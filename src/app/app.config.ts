import {
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
import {
  provideEffectHttpClient,
  provideEffectRpcProtocolHttpLayer,
} from '@heddendorp/effect-platform-angular';
import * as Sentry from '@sentry/angular';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { withDevtools } from '@tanstack/angular-query-experimental/devtools';

import { routes } from './app.routes';
import { authTokenInterceptor } from './core/auth-token.interceptor';
import { ConfigService } from './core/config.service';
import { AppRpc, resolveRpcUrl } from './core/effect-rpc-angular-client';

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
    provideEffectHttpClient(),
    provideEffectRpcProtocolHttpLayer({ url: resolveRpcUrl }),
    provideClientHydration(withEventReplay()),
    // Enable TanStack Query devtools only in dev mode
    provideTanStackQuery(
      new QueryClient(),
      ...(isDevMode() ? ([withDevtools()] as const) : ([] as const)),
    ),
    AppRpc.providers,
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
