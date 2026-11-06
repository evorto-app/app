import { registerLocaleData } from '@angular/common';
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
  type ActivatedRouteSnapshot,
  provideRouter,
  TitleStrategy,
  withComponentInputBinding,
  withInMemoryScrolling,
  withRouterConfig,
  withViewTransitions,
} from '@angular/router';
import { IS_DISCOVERING_ROUTES } from '@angular/ssr';
import {
  provideEffectHttpClient,
  provideEffectRpcProtocolHttpLayer,
} from '@heddendorp/effect-platform-angular';

import { TENANT_FORMATTING_LOCALE } from '../types/custom/tenant';
import { routes } from './app.routes';
import { appQueryProviders } from './core/app-query-client';
import { authTokenInterceptor } from './core/auth-token.interceptor';
import { BrowserErrorHandler } from './core/browser-error-handler';
import { ConfigService } from './core/config.service';
import { AppRpc, resolveRpcUrl } from './core/effect-rpc-angular-client';
import { PageTitleStrategy } from './core/page-title-strategy';
import { TENANT_DATE_PIPE_TIMEZONE } from './core/tenant-date.pipe';
import { TenantLuxonDateAdapter } from './core/tenant-luxon-date-adapter';
import {
  tenantCurrencyCode,
  tenantDatePipeTimezone,
} from './core/tenant-runtime';

export const initializeApplicationConfig = async (): Promise<void> => {
  if (inject(IS_DISCOVERING_ROUTES)) {
    return;
  }

  await inject(ConfigService).initialize();
};

// Native page snapshots crossfade raster images. Event-to-event navigation
// keeps the SVG live so its CSS path transition can visibly interpolate.
const hasEventShapeMorph = (route: ActivatedRouteSnapshot): boolean =>
  route.data['eventShapeMorph'] === true ||
  route.children.some((child) => hasEventShapeMorph(child));

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: TitleStrategy, useClass: PageTitleStrategy },
    provideAppInitializer(() => registerLocaleData(localeDe)),
    provideAnimationsAsync(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      withViewTransitions({
        onViewTransitionCreated: ({ from, to, transition }) => {
          if (hasEventShapeMorph(from) && hasEventShapeMorph(to))
            transition.skipTransition();
        },
      }),
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
      provide: TENANT_DATE_PIPE_TIMEZONE,
      useFactory: tenantDatePipeTimezone,
    },
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: {
        appearance: 'outline',
      },
    },
    {
      provide: ErrorHandler,
      useClass: BrowserErrorHandler,
    },
    provideAppInitializer(initializeApplicationConfig),
    {
      deps: [ConfigService],
      provide: DEFAULT_CURRENCY_CODE,
      useFactory: tenantCurrencyCode,
    },
  ],
};
