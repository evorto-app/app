import { Config, Option } from 'effect';

import { loadConfigSync } from './config-error';
import {
  nonEmptyTrimmedStringConfig,
  trimmedStringConfig,
} from './config-string';

const optionalAuthStringConfig = (name: string) =>
  Config.option(trimmedStringConfig(name)).pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => Option.none(),
        onSome: (entry) => {
          const trimmedEntry = entry;
          return Option.fromNullable(
            trimmedEntry.length > 0 ? trimmedEntry : undefined,
          );
        },
      }),
    ),
  );

export const authConfig = Config.all({
  AUDIENCE: optionalAuthStringConfig('AUDIENCE'),
  BASE_URL: nonEmptyTrimmedStringConfig('BASE_URL'),
  CLIENT_ID: nonEmptyTrimmedStringConfig('CLIENT_ID'),
  CLIENT_SECRET: nonEmptyTrimmedStringConfig('CLIENT_SECRET'),
  ISSUER_BASE_URL: nonEmptyTrimmedStringConfig('ISSUER_BASE_URL'),
  SECRET: nonEmptyTrimmedStringConfig('SECRET'),
});

export type AuthConfig = Config.Config.Success<typeof authConfig>;

export const loadAuthConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): AuthConfig => loadConfigSync('auth', authConfig, provider);
