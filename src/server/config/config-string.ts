import { Config, ConfigProvider, Effect, Option } from 'effect';

const configFailure = (message: string) =>
  new Config.ConfigError(new ConfigProvider.SourceError({ message }));

export const trimmedString = (name: string) =>
  Config.string(name).pipe(Config.map((value) => value.trim()));

export const nonEmptyTrimmedString = (name: string) =>
  trimmedString(name).pipe(
    Config.mapOrFail((value) =>
      value.length > 0
        ? Effect.succeed(value)
        : Effect.fail(configFailure(`Expected ${name} to be non-empty`)),
    ),
  );

export const optionalTrimmedString = (name: string) =>
  Config.option(trimmedString(name)).pipe(
    Config.map(Option.filter((configuredValue) => configuredValue.length > 0)),
  );
