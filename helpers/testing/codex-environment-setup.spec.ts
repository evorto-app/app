import { describe, expect, it } from '@effect/vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const setupConfigPath = path.join(
  repositoryRoot,
  '.codex',
  'environments',
  'environment.toml',
);

const readSetupScript = (): string => {
  const config = fs.readFileSync(setupConfigPath, 'utf8');
  const scriptMatch = /\[setup\]\nscript = '''\n([\s\S]*?)\n'''/.exec(config);

  if (!scriptMatch) {
    throw new Error('Missing setup script in Codex environment config');
  }

  return scriptMatch[1];
};

const testEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => name !== 'CODEX_SOURCE_ROOT' && !name.startsWith('GIT_'),
  ),
);
const gitEnvironment = {
  ...testEnvironment,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};

const runGit = (cwd: string, ...commandArguments: readonly string[]): string =>
  execFileSync(
    'git',
    ['-c', `core.hooksPath=${os.devNull}`, ...commandArguments],
    {
      cwd,
      encoding: 'utf8',
      env: gitEnvironment,
    },
  );

const createFixture = () => {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto env setup '),
  );

  try {
    const mainCheckout = path.join(
      fixtureRoot,
      'main checkout\nwith a newline',
    );
    const worktree = path.join(fixtureRoot, 'linked worktree');
    const stubBin = path.join(fixtureRoot, 'stub bin');

    fs.mkdirSync(mainCheckout);
    fs.mkdirSync(stubBin);
    fs.writeFileSync(path.join(mainCheckout, '.gitignore'), '.env*\n');
    fs.writeFileSync(path.join(mainCheckout, 'tracked.txt'), 'fixture\n');

    runGit(mainCheckout, 'init', '--initial-branch=main');
    runGit(mainCheckout, 'config', 'user.email', 'codex@example.test');
    runGit(mainCheckout, 'config', 'user.name', 'Codex Test');
    runGit(mainCheckout, 'add', '.gitignore', 'tracked.txt');
    runGit(mainCheckout, 'commit', '--no-gpg-sign', '-m', 'Create fixture');
    runGit(mainCheckout, 'worktree', 'add', '-b', 'fixture-worktree', worktree);
    runGit(mainCheckout, 'remote', 'add', 'origin', mainCheckout);

    const bunStub = path.join(stubBin, 'bun');
    fs.writeFileSync(bunStub, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(bunStub, 0o755);

    return {
      fixtureRoot,
      mainCheckout,
      runSetup: (cwd = worktree) => {
        const environment = {
          ...gitEnvironment,
          FONT_AWESOME_TOKEN: 'fixture-token',
          PATH: `${stubBin}${path.delimiter}${process.env['PATH'] ?? ''}`,
        };

        const result = spawnSync('bash', ['-c', readSetupScript()], {
          cwd,
          encoding: 'utf8',
          env: environment,
        });

        if (result.error) {
          throw result.error;
        }
        if (result.status !== 0) {
          throw new Error(
            `Setup failed with status ${result.status}: ${result.stderr}`,
          );
        }

        return {
          stderr: result.stderr,
          stdout: result.stdout,
        };
      },
      worktree,
    };
  } catch (error) {
    fs.rmSync(fixtureRoot, { force: true, recursive: true });
    throw error;
  }
};

describe('Codex environment setup', () => {
  it('copies a missing .env from the main checkout into a linked worktree', () => {
    const fixture = createFixture();
    const secret = 'SECRET_VALUE=do-not-log-this\n';

    try {
      fs.writeFileSync(path.join(fixture.mainCheckout, '.env'), secret);

      const output = fixture.runSetup();
      const worktreeEnvironmentPath = path.join(fixture.worktree, '.env');

      expect(fs.readFileSync(worktreeEnvironmentPath, 'utf8')).toBe(secret);
      expect(fs.statSync(worktreeEnvironmentPath).mode & 0o777).toBe(0o600);
      expect(output.stdout).toContain('Copied .env from the main checkout.');
      expect(`${output.stdout}\n${output.stderr}`).not.toContain(secret.trim());
    } finally {
      fs.rmSync(fixture.fixtureRoot, { force: true, recursive: true });
    }
  }, 15_000);

  it('preserves an existing worktree .env', () => {
    const fixture = createFixture();
    const worktreeEnvironmentPath = path.join(fixture.worktree, '.env');

    try {
      fs.writeFileSync(
        path.join(fixture.mainCheckout, '.env'),
        'SOURCE=main\n',
      );
      fs.writeFileSync(worktreeEnvironmentPath, 'SOURCE=worktree\n');

      const output = fixture.runSetup();

      expect(fs.readFileSync(worktreeEnvironmentPath, 'utf8')).toBe(
        'SOURCE=worktree\n',
      );
      expect(output.stdout).not.toContain(
        'Copied .env from the main checkout.',
      );
    } finally {
      fs.rmSync(fixture.fixtureRoot, { force: true, recursive: true });
    }
  }, 15_000);

  it('succeeds when the main checkout has no .env', () => {
    const fixture = createFixture();

    try {
      expect(() => fixture.runSetup()).not.toThrow();
      expect(fs.existsSync(path.join(fixture.worktree, '.env'))).toBe(false);
    } finally {
      fs.rmSync(fixture.fixtureRoot, { force: true, recursive: true });
    }
  }, 15_000);

  it('does not copy over the main checkout .env when setup runs there', () => {
    const fixture = createFixture();
    const mainEnvironmentPath = path.join(fixture.mainCheckout, '.env');

    try {
      fs.writeFileSync(mainEnvironmentPath, 'SOURCE=main\n');

      expect(() => fixture.runSetup(fixture.mainCheckout)).not.toThrow();
      expect(fs.readFileSync(mainEnvironmentPath, 'utf8')).toBe(
        'SOURCE=main\n',
      );
    } finally {
      fs.rmSync(fixture.fixtureRoot, { force: true, recursive: true });
    }
  }, 15_000);
});
