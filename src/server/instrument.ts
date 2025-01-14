import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: 'https://28bafd3b2a87dd85c93977c93b6d9108@o4508116711112704.ingest.us.sentry.io/4508642230861824',
  integrations: [
    // Add our Profiling integration
    nodeProfilingIntegration(),
  ],

  // Set sampling rate for profiling
  // This is relative to tracesSampleRate
  profilesSampleRate: 1,

  // Add Tracing by setting tracesSampleRate
  // We recommend adjusting this value in production
  tracesSampleRate: 1,
});
