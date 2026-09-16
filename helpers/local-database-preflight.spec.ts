import { describe, expect, it } from '@effect/vitest';
import { Client } from 'pg';
import { vi } from 'vitest';

import {
  resolveLocalDatabaseEnvironment,
  resolveLocalHostDatabaseEnvironment,
} from './local-database-preflight';

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

describe('local host application database preflight', () => {
  const environment = { ...localEnvironment, POSTGRES_HOST_PORT: '55432' };

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'preserves explicit credentials and loopback alias %s on the configured port',
    (host) => {
      const databaseUrl = `postgresql://explicit:p%40ss@${host}:55432/appdb?sslmode=disable`;
      expect(
        resolveLocalHostDatabaseEnvironment({
          ...environment,
          DATABASE_URL: databaseUrl,
        }),
      ).toEqual({ databaseUrl });
    },
  );

  it('accepts an omitted default port only when it is the configured port', () => {
    const databaseUrl = 'postgresql://explicit:secret@localhost/appdb';
    expect(
      resolveLocalHostDatabaseEnvironment({
        ...environment,
        POSTGRES_HOST_PORT: '5432',
        DATABASE_URL: databaseUrl,
      }),
    ).toEqual({ databaseUrl });
    expect(() =>
      resolveLocalHostDatabaseEnvironment({
        ...environment,
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow('configured POSTGRES_HOST_PORT');
  });

  it('checks the driver PGPORT fallback when the URL omits a port', () => {
    const databaseUrl = 'postgresql://explicit:secret@localhost/appdb';
    vi.stubEnv('PGPORT', '55433');
    try {
      expect(new Client({ connectionString: databaseUrl }).port).toBe(55433);
      expect(() =>
        resolveLocalHostDatabaseEnvironment({
          ...environment,
          DATABASE_URL: databaseUrl,
          POSTGRES_HOST_PORT: '5432',
          PGPORT: process.env['PGPORT'],
        }),
      ).toThrow('configured POSTGRES_HOST_PORT');
      expect(
        resolveLocalHostDatabaseEnvironment({
          ...environment,
          DATABASE_URL: databaseUrl,
          POSTGRES_HOST_PORT: '55433',
          PGPORT: process.env['PGPORT'],
        }),
      ).toEqual({ databaseUrl });
      expect(
        resolveLocalHostDatabaseEnvironment({
          ...environment,
          PGPORT: '55433',
        }),
      ).toEqual({ databaseUrl: environment.DATABASE_URL });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    [
      'postgresql://explicit:secret@localhost:55433/appdb',
      'configured POSTGRES_HOST_PORT',
    ],
    [
      'postgresql://explicit:secret@db:55432/appdb',
      'configured loopback database',
    ],
    [
      'postgresql://explicit:secret@localhost:55432/appdb?host=remote.invalid',
      'unsupported connection parameters: host',
    ],
    [
      'postgresql://explicit:secret@localhost:55432/appdb?port=55433',
      'unsupported connection parameters: port',
    ],
  ])('rejects a host target override: %s', (databaseUrl, message) => {
    expect(() =>
      resolveLocalHostDatabaseEnvironment({
        ...environment,
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow(message);
  });

  it.each([undefined, '', 'bad', '1', '65536'])(
    'rejects an invalid configured port: %s',
    (port) => {
      expect(() =>
        resolveLocalHostDatabaseEnvironment({
          ...environment,
          POSTGRES_HOST_PORT: port,
        }),
      ).toThrow('POSTGRES_HOST_PORT');
    },
  );

  it('reserves the integration name for the integration runner, not app fixtures', () => {
    const integrationEnvironment = {
      ...environment,
      POSTGRES_DB: 'evorto_postgres_integration',
      DATABASE_URL:
        'postgresql://explicit:secret@localhost:55432/evorto_postgres_integration',
    };
    expect(resolveLocalDatabaseEnvironment(integrationEnvironment)).toEqual({
      databaseUrl: integrationEnvironment.DATABASE_URL,
    });
    expect(() =>
      resolveLocalHostDatabaseEnvironment(integrationEnvironment),
    ).toThrow('reserved integration database');
  });
});
