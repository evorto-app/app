import { describe, expect, it } from '@effect/vitest';

import { resolveLocalDatabaseEnvironment } from './local-database-preflight';

const localEnvironment = {
  DATABASE_URL:
    'postgresql://evorto:local-secret@localhost:55432/appdb?sslmode=disable',
  LOCAL_DATABASE: 'true',
  POSTGRES_DB: 'appdb',
};

describe('local database preflight', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', 'db'])(
    'accepts the explicit local database through %s',
    (host) => {
      expect(
        resolveLocalDatabaseEnvironment({
          ...localEnvironment,
          DATABASE_URL: `postgresql://evorto:local-secret@${host}:5432/appdb?sslmode=disable`,
        }),
      ).toEqual({
        databaseUrl: `postgresql://evorto:local-secret@${host}:5432/appdb?sslmode=disable`,
      });
    },
  );

  it.each([
    {
      environment: {
        ...localEnvironment,
        LOCAL_DATABASE: 'false',
      },
      message: 'LOCAL_DATABASE=true',
    },
    {
      environment: {
        ...localEnvironment,
        DATABASE_URL:
          'postgresql://evorto:local-secret@database.example.com:5432/appdb',
      },
      message: 'non-local database host',
    },
    {
      environment: {
        ...localEnvironment,
        DATABASE_URL:
          'postgresql://evorto:local-secret@localhost:5432/production',
      },
      message: 'configured local database (appdb)',
    },
    {
      environment: {
        ...localEnvironment,
        DATABASE_URL:
          'postgresql://evorto:local-secret@localhost:5432/appdb?host=database.example.com',
      },
      message: 'unsupported connection parameters: host',
    },
  ])('rejects an unsafe target: $message', ({ environment, message }) => {
    expect(() => resolveLocalDatabaseEnvironment(environment)).toThrow(message);
  });
});
