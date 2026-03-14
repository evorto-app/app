import { describe, expect, it } from 'vitest';

import {
  createNodePgPoolConfig,
  createPgClientConfig,
} from './pg-connection-config';

describe('pg-connection-config', () => {
  const databaseUrl =
    'postgresql://neon:npg@localhost:55432/appdb?sslmode=require';

  it('allows the Neon Local self-signed certificate when the proxy is enabled', () => {
    expect(
      createNodePgPoolConfig({
        databaseUrl,
        neonLocalProxy: true,
      }),
    ).toMatchObject({
      database: 'appdb',
      host: 'localhost',
      password: 'npg',
      port: 55_432,
      ssl: {
        rejectUnauthorized: false,
      },
      user: 'neon',
    });

    expect(
      createPgClientConfig({
        databaseUrl,
        neonLocalProxy: true,
      }),
    ).toMatchObject({
      ssl: {
        rejectUnauthorized: false,
      },
    });
  });

  it('does not override SSL settings when the proxy is disabled', () => {
    expect(
      createNodePgPoolConfig({
        databaseUrl,
        neonLocalProxy: false,
      }),
    ).toMatchObject({
      connectionString: databaseUrl,
    });
    expect(
      createNodePgPoolConfig({
        databaseUrl,
        neonLocalProxy: false,
      }).ssl,
    ).toBeUndefined();

    expect(
      createPgClientConfig({
        databaseUrl,
        neonLocalProxy: false,
      }).ssl,
    ).toBeUndefined();
  });

  it('rejects non-local hosts when the Neon Local proxy flag is enabled', () => {
    expect(() =>
      createNodePgPoolConfig({
        databaseUrl:
          'postgresql://neon:npg@branch-host.neon.tech:5432/appdb?sslmode=require',
        neonLocalProxy: true,
      }),
    ).toThrowError(
      'NEON_LOCAL_PROXY only supports localhost or docker db hosts. Received "branch-host.neon.tech".',
    );

    expect(() =>
      createPgClientConfig({
        databaseUrl:
          'postgresql://neon:npg@branch-host.neon.tech:5432/appdb?sslmode=require',
        neonLocalProxy: true,
      }),
    ).toThrowError(
      'NEON_LOCAL_PROXY only supports localhost or docker db hosts. Received "branch-host.neon.tech".',
    );
  });
});
