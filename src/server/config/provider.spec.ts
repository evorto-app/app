import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@effect/vitest';
import { Config, Effect, Option, Redacted } from 'effect';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { databaseConfig } from './database-config';
import { makeRuntimeConfigProvider } from './provider';

const readDatabaseUrl = (cwd: string) =>
  makeRuntimeConfigProvider({ cwd }).pipe(
    Effect.flatMap((provider) => databaseConfig.parse(provider)),
    Effect.map((config) => config.DATABASE_URL),
  );

describe('provider', () => {
  const originalDatabaseUrl = process.env['DATABASE_URL'];
  const originalDatabaseTlsRequired = process.env['DATABASE_TLS_REQUIRED'];

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env['DATABASE_URL'];
    } else {
      process.env['DATABASE_URL'] = originalDatabaseUrl;
    }

    if (originalDatabaseTlsRequired === undefined) {
      delete process.env['DATABASE_TLS_REQUIRED'];
    } else {
      process.env['DATABASE_TLS_REQUIRED'] = originalDatabaseTlsRequired;
    }
  });

  it.effect(
    'applies config precedence env > .env.dev.local > .env.dev > .env',
    () =>
      Effect.gen(function* () {
        const temporaryDirectory = fs.mkdtempSync(
          path.join(os.tmpdir(), 'evorto-config-provider-'),
        );

        try {
          fs.writeFileSync(
            path.join(temporaryDirectory, '.env'),
            'DATABASE_TLS_REQUIRED=false\nDATABASE_URL=postgresql://secrets.example/app\n',
          );
          fs.writeFileSync(
            path.join(temporaryDirectory, '.env.dev'),
            'DATABASE_TLS_REQUIRED=false\nDATABASE_URL=postgresql://worktree.example/app\n',
          );
          fs.writeFileSync(
            path.join(temporaryDirectory, '.env.dev.local'),
            'DATABASE_TLS_REQUIRED=false\nDATABASE_URL=postgresql://shared.example/app\n',
          );

          delete process.env['DATABASE_URL'];
          delete process.env['DATABASE_TLS_REQUIRED'];
          expect(yield* readDatabaseUrl(temporaryDirectory)).toBe(
            'postgresql://shared.example/app',
          );

          fs.unlinkSync(path.join(temporaryDirectory, '.env.dev.local'));
          expect(yield* readDatabaseUrl(temporaryDirectory)).toBe(
            'postgresql://worktree.example/app',
          );

          fs.unlinkSync(path.join(temporaryDirectory, '.env.dev'));
          expect(yield* readDatabaseUrl(temporaryDirectory)).toBe(
            'postgresql://secrets.example/app',
          );

          process.env['DATABASE_URL'] = 'postgresql://env.example/app';
          expect(yield* readDatabaseUrl(temporaryDirectory)).toBe(
            'postgresql://env.example/app',
          );
        } finally {
          fs.rmSync(temporaryDirectory, { force: true, recursive: true });
        }
      }),
  );
});

describe('runtime provider database TLS boundaries', () => {
  let temporaryDirectory: string;
  const certificate =
    '\n-----BEGIN CERTIFICATE-----\nsynthetic-ca\n-----END CERTIFICATE-----\n';
  const readConfig = () =>
    makeRuntimeConfigProvider({ cwd: temporaryDirectory }).pipe(
      Effect.flatMap((provider) => databaseConfig.parse(provider)),
    );
  const writeSetting = (
    file: string | undefined,
    name: string,
    value: string,
  ) => {
    if (file === undefined) vi.stubEnv(name, value);
    else
      fs.appendFileSync(
        path.join(temporaryDirectory, file),
        `${name}='${value}'\n`,
      );
  };

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-config-tls-'),
    );
    for (const name of [
      'DATABASE_POOL_CONNECT_TIMEOUT_MS',
      'DATABASE_POOL_IDLE_TIMEOUT_MS',
      'DATABASE_POOL_MAX',
      'DATABASE_POOL_MIN',
      'DATABASE_TLS_CA_CERTIFICATE',
      'DATABASE_TLS_SERVER_NAME',
    ])
      vi.stubEnv(name, undefined);
    vi.stubEnv('DATABASE_URL', 'postgresql://private.example/evorto');
    vi.stubEnv('DATABASE_TLS_REQUIRED', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  });

  for (const source of [
    { file: undefined, label: 'process environment' },
    { file: '.env.dev.local', label: '.env.dev.local' },
    { file: '.env.dev', label: '.env.dev' },
    { file: '.env', label: '.env' },
  ]) {
    for (const tlsRequired of ['false', 'true']) {
      for (const blank of [
        { label: 'empty', value: '' },
        { label: 'whitespace', value: ' \t ' },
      ]) {
        it.effect(
          `rejects ${blank.label} CA from ${source.label} when TLS required=${tlsRequired}`,
          () =>
            Effect.gen(function* () {
              vi.stubEnv('DATABASE_TLS_REQUIRED', tlsRequired);
              writeSetting(
                source.file,
                'DATABASE_TLS_CA_CERTIFICATE',
                blank.value,
              );
              const error = yield* readConfig().pipe(Effect.flip);
              expect(error).toBeInstanceOf(Config.ConfigError);
              expect(String(error)).toContain(
                'DATABASE_TLS_CA_CERTIFICATE must not be blank',
              );
            }),
        );
      }
    }
    it.effect(`preserves valid CA bytes from ${source.label}`, () =>
      Effect.gen(function* () {
        writeSetting(source.file, 'DATABASE_TLS_CA_CERTIFICATE', certificate);
        const config = yield* readConfig();
        expect(
          Redacted.value(Option.getOrThrow(config.DATABASE_TLS_CA_CERTIFICATE)),
        ).toBe(certificate);
      }),
    );
  }

  for (const source of [
    {
      fallback: '.env.dev.local',
      file: undefined,
      label: 'process environment',
    },
    { fallback: '.env.dev', file: '.env.dev.local', label: '.env.dev.local' },
    { fallback: '.env', file: '.env.dev', label: '.env.dev' },
  ]) {
    it.effect(
      `does not replace an empty CA from ${source.label} with a lower-priority certificate`,
      () =>
        Effect.gen(function* () {
          writeSetting(
            source.fallback,
            'DATABASE_TLS_CA_CERTIFICATE',
            certificate,
          );
          writeSetting(source.file, 'DATABASE_TLS_CA_CERTIFICATE', '');
          const error = yield* readConfig().pipe(Effect.flip);
          expect(error).toBeInstanceOf(Config.ConfigError);
          expect(String(error)).toContain(
            'DATABASE_TLS_CA_CERTIFICATE must not be blank',
          );
        }),
    );
  }

  it.effect('accepts an absent CA when TLS is explicitly optional', () =>
    Effect.gen(function* () {
      const config = yield* readConfig();
      expect(config.DATABASE_TLS_REQUIRED).toBe(false);
      expect(Option.isNone(config.DATABASE_TLS_CA_CERTIFICATE)).toBe(true);
    }),
  );

  it.effect(
    'keeps an explicitly blank optional server name absent instead of using a fallback',
    () =>
      Effect.gen(function* () {
        writeSetting('.env', 'DATABASE_TLS_SERVER_NAME', 'fallback.example');
        writeSetting(undefined, 'DATABASE_TLS_SERVER_NAME', '');
        const config = yield* readConfig();
        expect(Option.isNone(config.DATABASE_TLS_SERVER_NAME)).toBe(true);
      }),
  );

  it.effect(
    'rejects an explicit empty TLS choice instead of using a lower-priority value',
    () =>
      Effect.gen(function* () {
        writeSetting('.env', 'DATABASE_TLS_REQUIRED', 'false');
        writeSetting(undefined, 'DATABASE_TLS_REQUIRED', '');
        const error = yield* readConfig().pipe(Effect.flip);
        expect(error).toBeInstanceOf(Config.ConfigError);
        expect(String(error)).toContain('DATABASE_TLS_REQUIRED');
      }),
  );
});
