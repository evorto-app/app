import { describe, expect, it } from '@effect/vitest';
import { Client } from 'pg';

import { resolveLocalDatabaseEnvironment } from './local-database-preflight';

const localEnvironment = {
  DATABASE_URL:
    'postgresql://evorto:local-secret@localhost:55432/appdb?sslmode=disable',
  LOCAL_DATABASE: 'true',
  POSTGRES_DB: 'appdb',
};

describe('local database preflight', () => {
  it.each([undefined, ''])(
    'requires a configured database name: %s',
    (name) => {
      expect(() =>
        resolveLocalDatabaseEnvironment({
          ...localEnvironment,
          POSTGRES_DB: name,
        }),
      ).toThrow('POSTGRES_DB is required');
    },
  );

  it.each([' reports % ü ', ' \t '])(
    'compares the literal configured database name: %j',
    (name) => {
      const databaseUrl = `postgresql://evorto:local-secret@localhost:55432/${encodeURIComponent(name)}?sslmode=disable`;
      // Constructing a client parses its target without opening a connection.
      expect(new Client({ connectionString: databaseUrl }).database).toBe(name);
      expect(
        resolveLocalDatabaseEnvironment({
          ...localEnvironment,
          DATABASE_URL: databaseUrl,
          POSTGRES_DB: name,
        }),
      ).toEqual({ databaseUrl });
      expect(() =>
        resolveLocalDatabaseEnvironment({
          ...localEnvironment,
          DATABASE_URL: databaseUrl,
          POSTGRES_DB: name.trim(),
        }),
      ).toThrow();
    },
  );

  it.each([
    { expected: 'appdb', driverName: '/appdb', pathname: '//appdb' },
    {
      expected: 'reports#1',
      driverName: 'reports%231',
      pathname: '/reports%231',
    },
  ])(
    'rejects a URL whose pg target differs: $pathname',
    ({ expected, driverName, pathname }) => {
      const databaseUrl = `postgresql://evorto:local-secret@localhost:55432${pathname}?sslmode=disable`;
      expect(new Client({ connectionString: databaseUrl }).database).toBe(
        driverName,
      );
      expect(() =>
        resolveLocalDatabaseEnvironment({
          ...localEnvironment,
          DATABASE_URL: databaseUrl,
          POSTGRES_DB: expected,
        }),
      ).toThrow(`configured local database (${expected})`);
    },
  );

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
