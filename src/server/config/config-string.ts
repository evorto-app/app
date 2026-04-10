import { Config, ConfigError, Either, Option } from 'effect';

export const trimmedString = (name: string) =>
  Config.string(name).pipe(Config.map((value) => value.trim()));

export const nonEmptyTrimmedString = (name: string) =>
  trimmedString(name).pipe(
    Config.mapOrFail((value) =>
      value.length > 0
        ? Either.right(value)
        : Either.left(
            ConfigError.MissingData(
              [name],
              `Expected ${name} to be a non-empty string`,
            ),
          ),
    ),
  );

export const optionalTrimmedString = (name: string) =>
  Config.option(trimmedString(name)).pipe(
    Config.map(Option.filter((configuredValue) => configuredValue.length > 0)),
  );
