import * as Sentry from "@sentry/bun";

const dsn = process.env["SENTRY_DSN"] ?? process.env["SENTRY_NODE_DSN"];
if (dsn) {
  Sentry.init({
    dsn,
    // These should be tuned per environment
    tracesSampleRate: Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? 1),
    profilesSampleRate: Number(process.env["SENTRY_PROFILES_SAMPLE_RATE"] ?? 1),
    enableLogs: true,
  });
}
