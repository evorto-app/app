import { InjectionToken, isDevMode } from '@angular/core';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { withDevtools } from '@tanstack/angular-query-experimental/devtools';

export const APP_QUERY_CLIENT = new InjectionToken<QueryClient>(
  'APP_QUERY_CLIENT',
);

export const appQueryProviders = [
  // The factory scopes cached permissions and data to one browser or SSR app.
  {
    provide: APP_QUERY_CLIENT,
    useFactory: () => new QueryClient(),
  },
  provideTanStackQuery(
    APP_QUERY_CLIENT,
    ...(isDevMode() ? [withDevtools()] : []),
  ),
];
