import { DOCUMENT } from '@angular/common';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  ApplicationConfig,
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
} from '@tanstack/angular-query-experimental';

import { routes } from './app.routes';
import { authTokenInterceptor } from './core/auth-token.interceptor';
import { injectTrpcClient, provideTrpcClient } from './core/trpc-client';

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
    provideTanStackQuery(new QueryClient()),
    provideLuxonDateAdapter(),
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
      const trpcClient = injectTrpcClient();
      // The types of createRenderer only allow null
      // eslint-disable-next-line unicorn/no-null
      const renderer = inject(RendererFactory2).createRenderer(null, null);
      const document = inject(DOCUMENT);
      const tenantConfig = await trpcClient.config.tenant.query();
      const theme = tenantConfig.theme;
      // This sets the theme on the html element also on the server
      renderer.addClass(document.documentElement, `theme-${theme}`);
      // renderer.addClass(document.documentElement, `theme-esn`);
    }),
  ],
};
