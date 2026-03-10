import { Config, ConfigError, Either, Option } from 'effect';

const trimConfigString = (value: string): string => value.trim();

const nonEmptyValueError = (name: string) =>
  ConfigError.InvalidData([name], `Expected ${name} to be a non-empty string`);

export const trimmedString = (name: string) =>
  Config.string(name).pipe(Config.map((value) => trimConfigString(value)));

export const nonEmptyTrimmedString = (name: string) =>
  trimmedString(name).pipe(
    Config.mapOrFail((value) =>
      value.length > 0
        ? Either.right(value)
        : Either.left(nonEmptyValueError(name)),
    ),
  );

export const optionalTrimmedString = (name: string) =>
  Config.option(trimmedString(name)).pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => Option.none(),
        onSome: (configuredValue) =>
          Option.fromNullable(
            configuredValue.length > 0 ? configuredValue : undefined,
          ),
      }),
    ),
  );
