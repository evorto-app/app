import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const dsn = process.env['SENTRY_DSN'] ?? process.env['SENTRY_NODE_DSN'];
if (dsn) {
  Sentry.init({
    dsn,
    integrations: [nodeProfilingIntegration()],
    // These should be tuned per environment
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 1),
    profilesSampleRate: Number(process.env['SENTRY_PROFILES_SAMPLE_RATE'] ?? 1),
  });
}
