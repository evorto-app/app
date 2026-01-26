import { bootstrapApplication } from '@angular/platform-browser';
import * as Sentry from '@sentry/angular';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

const isE2E = typeof window !== 'undefined' && !!window.navigator?.webdriver;

if (!isE2E) {
  Sentry.init({
    dsn: 'https://d5d2f5fb92034473ae598a357ce3eb5c@o541164.ingest.us.sentry.io/6366795',
    integrations: [
      Sentry.browserTracingIntegration(),
      // Sentry.replayIntegration(),
    ],
    replaysOnErrorSampleRate: 1,
    replaysSessionSampleRate: 0.1,
    tracePropagationTargets: ['localhost', /^https:\/\/evorto\.fly\.dev/],
    tracesSampleRate: 1,
  });
}

bootstrapApplication(AppComponent, appConfig).catch((error) => console.error(error));
