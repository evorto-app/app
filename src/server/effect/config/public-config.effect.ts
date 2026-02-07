import { Context, Effect, Layer, Schema } from 'effect';

import {
  getPublicGoogleMapsApiKey,
  type ServerEnvironment,
} from '../../config/environment';

export const PublicConfig = Schema.Struct({
  googleMapsApiKey: Schema.NullOr(Schema.NonEmptyString),
  sentryDsn: Schema.NullOr(Schema.NonEmptyString),
});

export type PublicConfig = Schema.Schema.Type<typeof PublicConfig>;

class RuntimeEnvironment extends Context.Tag('RuntimeEnvironment')<
  RuntimeEnvironment,
  ServerEnvironment
>() {}

const makePublicConfig = Effect.gen(function* () {
  const environment = yield* RuntimeEnvironment;
  const googleMapsApiKey = getPublicGoogleMapsApiKey(environment);

  return {
    // eslint-disable-next-line unicorn/no-null
    googleMapsApiKey: googleMapsApiKey ?? null,
    // eslint-disable-next-line unicorn/no-null
    sentryDsn: environment.PUBLIC_SENTRY_DSN ?? null,
  } satisfies PublicConfig;
});

const provideEnvironment = (environment: ServerEnvironment) =>
  Layer.succeed(RuntimeEnvironment, environment);

export const getPublicConfigEffect = (environment: ServerEnvironment) =>
  makePublicConfig.pipe(Effect.provide(provideEnvironment(environment)));
