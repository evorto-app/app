import { describe, expect, it } from '@effect/vitest';

import {
  createRuntimeEnvironment,
  resolveRuntimePorts,
} from './runtime-environment';

const runtimePortKeys = [
  'APP_HOST_PORT',
  'MAILPIT_HOST_PORT',
  'MINIO_CONSOLE_HOST_PORT',
  'MINIO_HOST_PORT',
  'POSTGRES_HOST_PORT',
] as const;

describe('runtime environment ports', () => {
  it('keeps generated ports unique across many seeds, including a former MinIO collision', () => {
    const seeds = [
      // The previous overlapping ranges assigned both MinIO ports to 9235.
      '288',
      ...Array.from({ length: 10_000 }, (_, index) => `worktree-${index}`),
    ];

    for (const seed of seeds) {
      const ports = resolveRuntimePorts(seed, {});

      expect(new Set(Object.values(ports)).size, seed).toBe(5);
      expect(ports.mailpitHostPort, seed).toBeGreaterThanOrEqual(10_000);
      expect(ports.mailpitHostPort, seed).toBeLessThan(50_000);
      expect(ports.minioHostPort, seed).toBeGreaterThanOrEqual(9000);
      expect(ports.minioHostPort, seed).toBeLessThan(9400);
      expect(ports.minioConsoleHostPort, seed).toBeGreaterThanOrEqual(9400);
      expect(ports.minioConsoleHostPort, seed).toBeLessThan(9800);
      expect(ports.postgresHostPort, seed).toBeGreaterThanOrEqual(55_432);
      expect(ports.postgresHostPort, seed).toBeLessThan(55_832);
    }
  });

  it('keeps Mailpit distinct for worktree identities that shared the former narrow port slot', () => {
    // Both identities mapped to port 8058 in the former 400-port range.
    const first = resolveRuntimePorts('mailpit-worktree-21', {});
    const second = resolveRuntimePorts('mailpit-worktree-38', {});

    expect(first.mailpitHostPort).not.toBe(second.mailpitHostPort);
  });

  it('preserves valid explicit port overrides', () => {
    expect(
      resolveRuntimePorts('explicit-overrides', {
        APP_HOST_PORT: '4300',
        MAILPIT_HOST_PORT: '8200',
        MINIO_CONSOLE_HOST_PORT: '9800',
        MINIO_HOST_PORT: '9300',
        POSTGRES_HOST_PORT: '56000',
      }),
    ).toEqual({
      appHostPort: 4300,
      mailpitHostPort: 8200,
      minioConsoleHostPort: 9800,
      minioHostPort: 9300,
      postgresHostPort: 56_000,
    });
  });

  it.each(runtimePortKeys)(
    'rejects malformed or out-of-range explicit %s values',
    (name) => {
      for (const value of [
        '4200junk',
        '4200.5',
        '4e3',
        'not-a-port',
        '1023',
        '65536',
      ]) {
        expect(
          () => resolveRuntimePorts('invalid-overrides', { [name]: value }),
          `${name}=${value}`,
        ).toThrow(name);
      }
    },
  );

  it('canonicalizes whitespace and leading zeros while accepting both port boundaries', () => {
    const environment = {
      APP_HOST_PORT: ' 004300 ',
      MAILPIT_HOST_PORT: '\t08200 ',
      MINIO_CONSOLE_HOST_PORT: ' 0001024 ',
      MINIO_HOST_PORT: ' 009300\t',
      POSTGRES_HOST_PORT: ' 065535 ',
    };

    expect(resolveRuntimePorts('canonical-overrides', environment)).toEqual({
      appHostPort: 4300,
      mailpitHostPort: 8200,
      minioConsoleHostPort: 1024,
      minioHostPort: 9300,
      postgresHostPort: 65_535,
    });
    expect(
      createRuntimeEnvironment('/synthetic/canonical-overrides', environment),
    ).toMatchObject({
      APP_HOST_PORT: '4300',
      MAILPIT_HOST_PORT: '8200',
      MINIO_CONSOLE_HOST_PORT: '1024',
      MINIO_HOST_PORT: '9300',
      POSTGRES_HOST_PORT: '65535',
    });
  });

  it.each(['', ' \t\n '])(
    'treats blank port override %j as unset for every runtime port',
    (value) => {
      const environment = Object.fromEntries(
        runtimePortKeys.map((name) => [name, value]),
      );

      expect(resolveRuntimePorts('blank-overrides', environment)).toEqual(
        resolveRuntimePorts('blank-overrides', {}),
      );
      expect(
        createRuntimeEnvironment('/synthetic/blank-overrides', environment),
      ).toEqual(createRuntimeEnvironment('/synthetic/blank-overrides', {}));
    },
  );

  it('fails clearly when explicit overrides reuse a host port', () => {
    expect(() =>
      resolveRuntimePorts('conflicting-overrides', {
        MINIO_CONSOLE_HOST_PORT: '9300',
        MINIO_HOST_PORT: '9300',
      }),
    ).toThrow(
      'Runtime ports must be unique: 9300 is assigned to minioConsoleHostPort, minioHostPort',
    );
  });
});

describe('runtime database environment', () => {
  it.each([
    {
      label:
        'reserved characters and literal whitespace, dollars, and backslashes',
      environment: {
        POSTGRES_DB: ' reports /?#%+$ ${MISSING} ',
        POSTGRES_PASSWORD: ' secret $MISSING ${MISSING} \\$ @:/?#% ',
        POSTGRES_USER: ' user $MISSING ${MISSING} \\$ @:/?#% ',
      },
    },
    {
      label: 'nonempty whitespace-only values',
      environment: {
        POSTGRES_DB: ' \t ',
        POSTGRES_PASSWORD: ' \t ',
        POSTGRES_USER: ' \t ',
      },
    },
  ])(
    'preserves $label in generated database connections',
    ({ environment }) => {
      const runtime = createRuntimeEnvironment(
        '/synthetic/database-values',
        environment,
      );

      expect(runtime).toMatchObject(environment);
      for (const value of [
        runtime.DATABASE_URL,
        runtime.POSTGRES_INTEGRATION_DATABASE_URL,
      ]) {
        const url = new URL(value);

        expect(decodeURIComponent(url.username)).toBe(runtime.POSTGRES_USER);
        expect(decodeURIComponent(url.password)).toBe(
          runtime.POSTGRES_PASSWORD,
        );
        expect(url.hostname).toBe('localhost');
        expect(url.port).toBe(runtime.POSTGRES_HOST_PORT);
        expect(url.search).toBe('?sslmode=disable');
        expect(url.hash).toBe('');
      }
      expect(
        decodeURIComponent(new URL(runtime.DATABASE_URL).pathname.slice(1)),
      ).toBe(runtime.POSTGRES_DB);
      expect(new URL(runtime.POSTGRES_INTEGRATION_DATABASE_URL).pathname).toBe(
        '/evorto_postgres_integration',
      );
    },
  );

  it('uses the database defaults only when explicit database strings are empty', () => {
    const runtime = createRuntimeEnvironment(
      '/synthetic/empty-database-values',
      {
        POSTGRES_DB: '',
        POSTGRES_PASSWORD: '',
        POSTGRES_USER: '',
      },
    );

    expect(runtime).toEqual(
      createRuntimeEnvironment('/synthetic/empty-database-values', {}),
    );
    expect(runtime).toMatchObject({
      POSTGRES_DB: 'appdb',
      POSTGRES_PASSWORD: 'evorto-local',
      POSTGRES_USER: 'evorto',
    });
    const databaseUrl = new URL(runtime.DATABASE_URL);
    expect(decodeURIComponent(databaseUrl.username)).toBe(
      runtime.POSTGRES_USER,
    );
    expect(decodeURIComponent(databaseUrl.password)).toBe(
      runtime.POSTGRES_PASSWORD,
    );
    expect(decodeURIComponent(databaseUrl.pathname.slice(1))).toBe(
      runtime.POSTGRES_DB,
    );
  });
});
