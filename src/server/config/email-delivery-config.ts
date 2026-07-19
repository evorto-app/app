import { Config, Effect, Option, Redacted } from 'effect';

import { optionalTrimmedString } from './config-string';
import { applicationEnvironmentConfig } from './deployment-config';

const optionalRedactedString = (name: string) =>
  Config.option(Config.redacted(name)).pipe(
    Config.map(
      Option.map((value) => Redacted.make(Redacted.value(value).trim())),
    ),
    Config.map(Option.filter((value) => Redacted.value(value).length > 0)),
  );

export const emailDeliveryConfigState = Config.all({
  APP_ENVIRONMENT: applicationEnvironmentConfig,
  EMAIL_DELIVERY_PROVIDER: Config.literals(
    ['mailpit', 'tem'],
    'EMAIL_DELIVERY_PROVIDER',
  ).pipe(Config.withDefault('mailpit')),
  MAILPIT_API_URL: Config.url('MAILPIT_API_URL').pipe(
    Config.withDefault(new URL('http://mailpit:8025/api/v1/send')),
  ),
  STAGING_EMAIL_ALLOWLIST: Config.string('STAGING_EMAIL_ALLOWLIST').pipe(
    Config.withDefault(''),
    Config.map(
      (value) =>
        new Set(
          value
            .split(',')
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => entry.length > 0),
        ),
    ),
  ),
  TEM_API_TOKEN: optionalRedactedString('TEM_API_TOKEN'),
  TEM_PROJECT_ID: optionalTrimmedString('TEM_PROJECT_ID'),
});

export interface EmailDeliveryConfig {
  readonly environment: EmailDeliveryConfigState['APP_ENVIRONMENT'];
  readonly mailpitApiUrl: URL;
  readonly provider: EmailDeliveryConfigState['EMAIL_DELIVERY_PROVIDER'];
  readonly stagingAllowlist: ReadonlySet<string>;
  readonly temApiToken: Option.Option<Redacted.Redacted>;
  readonly temProjectId: Option.Option<string>;
}

export type EmailDeliveryConfigState = Config.Success<
  typeof emailDeliveryConfigState
>;

export const validateEmailDeliveryConfig = (
  state: EmailDeliveryConfigState,
): Effect.Effect<EmailDeliveryConfig, Error> => {
  if (
    state.APP_ENVIRONMENT !== 'local' &&
    state.EMAIL_DELIVERY_PROVIDER !== 'tem'
  ) {
    return Effect.fail(
      new Error(
        'EMAIL_DELIVERY_PROVIDER must be tem outside local development',
      ),
    );
  }
  if (
    state.EMAIL_DELIVERY_PROVIDER === 'tem' &&
    (Option.isNone(state.TEM_API_TOKEN) || Option.isNone(state.TEM_PROJECT_ID))
  ) {
    return Effect.fail(
      new Error(
        'TEM_API_TOKEN and TEM_PROJECT_ID are required for TEM delivery',
      ),
    );
  }
  if (
    state.APP_ENVIRONMENT === 'staging' &&
    state.STAGING_EMAIL_ALLOWLIST.size === 0
  ) {
    return Effect.fail(
      new Error(
        'STAGING_EMAIL_ALLOWLIST must contain at least one address in staging',
      ),
    );
  }

  return Effect.succeed({
    environment: state.APP_ENVIRONMENT,
    mailpitApiUrl: state.MAILPIT_API_URL,
    provider: state.EMAIL_DELIVERY_PROVIDER,
    stagingAllowlist: state.STAGING_EMAIL_ALLOWLIST,
    temApiToken: state.TEM_API_TOKEN,
    temProjectId: state.TEM_PROJECT_ID,
  });
};
