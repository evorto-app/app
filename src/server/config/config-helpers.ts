import { Config, ConfigError, Either, Option } from 'effect';

const trimConfigValue = (value: string): string => value.trim();
const missingOptionalValue = undefined;

const nonEmptyValueError = (name: string) =>
  ConfigError.InvalidData([name], `Expected ${name} to be a non-empty string`);

export const requiredStringConfig = (name: string) =>
  Config.string(name).pipe(
    Config.map((value) => trimConfigValue(value)),
    Config.mapOrFail((value) =>
      value.length > 0
        ? Either.right(value)
        : Either.left(nonEmptyValueError(name)),
    ),
  );

export const optionalStringConfig = (name: string) =>
  Config.option(Config.string(name)).pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => missingOptionalValue,
        onSome: (raw) => {
          const trimmed = trimConfigValue(raw);
          return trimmed.length > 0 ? trimmed : undefined;
        },
      }),
    ),
  );

export const booleanWithDefaultConfig = (name: string, value: boolean) =>
  Config.boolean(name).pipe(Config.withDefault(value));

export const portWithDefaultConfig = (name: string, value: number) =>
  Config.port(name).pipe(Config.withDefault(value));
