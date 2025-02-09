import { DOCUMENT, provideCloudflareLoader } from '@angular/common';
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
  provideExperimentalZonelessChangeDetection,
  RendererFactory2,
} from '@angular/core';
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
import * as Sentry from '@sentry/angular';
import {
  provideTanStackQuery,
  QueryClient,
  withDevtools,
} from '@tanstack/angular-query-experimental';

import { routes } from './app.routes';
import { authTokenInterceptor } from './core/auth-token.interceptor';
import { ConfigService } from './core/config.service';
import { provideTrpcClient } from './core/trpc-client';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAnimationsAsync(),
    provideExperimentalZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authTokenInterceptor])),
    provideTrpcClient(),
    provideClientHydration(withEventReplay()),
    provideTanStackQuery(new QueryClient(), withDevtools()),
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
      // The types of createRenderer only allow null
      // eslint-disable-next-line unicorn/no-null
      const renderer = inject(RendererFactory2).createRenderer(null, null);
      const document = inject(DOCUMENT);
      await config.initialize();
      const theme = config.tenant.theme;
      // This sets the theme on the html element also on the server
      renderer.addClass(document.documentElement, `theme-${theme}`);
      // renderer.addClass(document.documentElement, `theme-esn`);
    }),
    {
      deps: [ConfigService],
      provide: DEFAULT_CURRENCY_CODE,
      useFactory: (config: ConfigService) => config.tenant.currency,
    },
  ],
};
