import {
  nonEmptyTrimmedString,
  optionalTrimmedString,
} from '@server/config/config-string';
import { Config, Option } from 'effect';

export const databaseConfig = Config.all({
  BRANCH_ID: optionalTrimmedString('BRANCH_ID'),
  DATABASE_URL: nonEmptyTrimmedString('DATABASE_URL'),
  DELETE_BRANCH: Config.boolean('DELETE_BRANCH').pipe(
    Config.withDefault(true),
  ),
  NEON_API_KEY: optionalTrimmedString('NEON_API_KEY'),
  NEON_DATABASE_NAME: optionalTrimmedString('NEON_DATABASE_NAME').pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => 'appdb',
        onSome: (databaseName) => databaseName,
      }),
    ),
  ),
  NEON_LOCAL_HOST_PORT: Config.port('NEON_LOCAL_HOST_PORT').pipe(
    Config.withDefault(55_432),
  ),
  NEON_LOCAL_PROXY: Config.boolean('NEON_LOCAL_PROXY').pipe(
    Config.withDefault(false),
  ),
  NEON_PROJECT_ID: optionalTrimmedString('NEON_PROJECT_ID'),
  PARENT_BRANCH_ID: optionalTrimmedString('PARENT_BRANCH_ID'),
});

export type DatabaseConfig = Config.Config.Success<typeof databaseConfig>;
