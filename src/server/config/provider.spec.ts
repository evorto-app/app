import { afterEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
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
