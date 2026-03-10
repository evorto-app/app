import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadDatabaseConfigSync } from './database-config';
import { makeRuntimeConfigProviderSync } from './provider';

describe('provider', () => {
  const originalDatabaseUrl = process.env['DATABASE_URL'];

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env['DATABASE_URL'];
      return;
    }

    process.env['DATABASE_URL'] = originalDatabaseUrl;
  });

  it('applies config precedence env > .env.local > .env > .env.runtime', () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-config-provider-'),
    );

    try {
      fs.writeFileSync(
        path.join(temporaryDirectory, '.env.runtime'),
        'DATABASE_URL=postgresql://runtime.example/app\n',
      );
      fs.writeFileSync(
        path.join(temporaryDirectory, '.env'),
        'DATABASE_URL=postgresql://shared.example/app\n',
      );
      fs.writeFileSync(
        path.join(temporaryDirectory, '.env.local'),
        'DATABASE_URL=postgresql://local.example/app\n',
      );

      delete process.env['DATABASE_URL'];
      expect(
        loadDatabaseConfigSync(
          makeRuntimeConfigProviderSync({ cwd: temporaryDirectory }),
        ).DATABASE_URL,
      ).toBe('postgresql://local.example/app');

      fs.unlinkSync(path.join(temporaryDirectory, '.env.local'));
      expect(
        loadDatabaseConfigSync(
          makeRuntimeConfigProviderSync({ cwd: temporaryDirectory }),
        ).DATABASE_URL,
      ).toBe('postgresql://shared.example/app');

      fs.unlinkSync(path.join(temporaryDirectory, '.env'));
      expect(
        loadDatabaseConfigSync(
          makeRuntimeConfigProviderSync({ cwd: temporaryDirectory }),
        ).DATABASE_URL,
      ).toBe('postgresql://runtime.example/app');

      process.env['DATABASE_URL'] = 'postgresql://env.example/app';
      expect(
        loadDatabaseConfigSync(
          makeRuntimeConfigProviderSync({ cwd: temporaryDirectory }),
        ).DATABASE_URL,
      ).toBe('postgresql://env.example/app');
    } finally {
      fs.rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
