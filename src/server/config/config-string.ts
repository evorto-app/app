import { Config, ConfigError, Either } from 'effect';

const trimConfigString = (value: string): string => value.trim();
const isNonEmptyString = (value: string): boolean => value.length > 0;

const nonEmptyValueError = (name: string) =>
  ConfigError.InvalidData([name], `Expected ${name} to be a non-empty string`);

export const trimmedStringConfig = (name: string) =>
  Config.string(name).pipe(Config.map((value) => trimConfigString(value)));

export const nonEmptyTrimmedStringConfig = (name: string) =>
  trimmedStringConfig(name).pipe(
    Config.mapOrFail((value) =>
      value.length > 0
        ? Either.right(value)
        : Either.left(nonEmptyValueError(name)),
    ),
  );

export const toOptionalString = (
  value: string | undefined,
): string | undefined => {
  if (value === undefined) {
    return;
  }

  return isNonEmptyString(value) ? value : undefined;
};
