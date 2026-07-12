import { DATE_PIPE_DEFAULT_OPTIONS, registerLocaleData } from '@angular/common';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import localeDe from '@angular/common/locales/de';
import {
  ApplicationConfig,
  DEFAULT_CURRENCY_CODE,
  ErrorHandler,
  inject,
  LOCALE_ID,
  provideAppInitializer,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideLuxonDateAdapter } from '@angular/material-luxon-adapter';
import { DateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
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

import { TENANT_FORMATTING_LOCALE } from '../types/custom/tenant';
import { routes } from './app.routes';
import { appQueryProviders } from './core/app-query-client';
import { authTokenInterceptor } from './core/auth-token.interceptor';
import { ConfigService } from './core/config.service';
import { AppRpc, resolveRpcUrl } from './core/effect-rpc-angular-client';
import { TenantLuxonDateAdapter } from './core/tenant-luxon-date-adapter';
import {
  tenantCurrencyCode,
  tenantDatePipeConfig,
} from './core/tenant-runtime';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAppInitializer(() => registerLocaleData(localeDe)),
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
    appQueryProviders,
    AppRpc.providers,
    provideLuxonDateAdapter(),
    {
      provide: DateAdapter,
      useClass: TenantLuxonDateAdapter,
    },
    {
      provide: MAT_DATE_LOCALE,
      useValue: TENANT_FORMATTING_LOCALE,
    },
    {
      provide: LOCALE_ID,
      useValue: TENANT_FORMATTING_LOCALE,
    },
    {
      deps: [ConfigService],
      provide: DATE_PIPE_DEFAULT_OPTIONS,
      useFactory: tenantDatePipeConfig,
    },
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
      useFactory: tenantCurrencyCode,
    },
  ],
};
