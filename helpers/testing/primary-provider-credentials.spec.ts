import { describe, expect, it } from '@effect/vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  primaryCheckoutProviderCredentialNames,
  providerEnvironmentFromPrimaryCheckout,
  resolvePrimaryCheckoutRoot,
} from './primary-provider-credentials';

const withOwnedFixture = (
  prefix: string,
  run: (
    directory: string,
    registerCleanup: (cleanup: () => void) => void,
  ) => void,
): void => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const cleanups: Array<() => void> = [
    () => fs.rmSync(directory, { force: true, recursive: true }),
  ];
  const failures: unknown[] = [];
  try {
    run(directory, (cleanup) => cleanups.push(cleanup));
  } catch (error) {
    failures.push(error);
  }
  for (const cleanup of cleanups.toReversed()) {
    try {
      cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      'Primary provider fixture action and cleanup failed',
      { cause: failures[0] },
    );
  }
};

const withPrimaryEnvironment = (
  contents: string,
  run: (primaryCheckoutRoot: string) => void,
): void => {
  withOwnedFixture('evorto primary provider env ', (primaryCheckoutRoot) => {
    fs.writeFileSync(path.join(primaryCheckoutRoot, '.env'), contents, {
      mode: 0o600,
    });
    run(primaryCheckoutRoot);
  });
};

interface GitFixture {
  readonly primaryCheckoutRoot: string;
  readonly reportedCheckoutRoot: string;
  readonly repositoryRoot: string;
  readonly tracePath: string;
}

const fakeGit = String.raw`#!/bin/sh
set -eu
printf '%s\0' "$PWD" "$@" > "$PRIMARY_PROVIDER_GIT_TRACE_PATH"
/bin/cat "$PRIMARY_PROVIDER_GIT_OUTPUT_PATH"
printf '%s' "$PRIMARY_PROVIDER_GIT_STDERR" >&2
exit "$PRIMARY_PROVIDER_GIT_STATUS"
`;

const withGitFixture = (
  output: (fixture: GitFixture) => string,
  run: (fixture: GitFixture) => void,
  result: { readonly status: number; readonly stderr: string } = {
    status: 0,
    stderr: '',
  },
): void => {
  withOwnedFixture(
    'evorto primary provider git ',
    (directory, registerCleanup) => {
      const binDirectory = path.join(directory, 'bin');
      const primaryCheckoutRoot = path.join(directory, 'primary checkout');
      const repositoryRoot = path.join(directory, 'linked checkout');
      for (const pathname of [
        binDirectory,
        primaryCheckoutRoot,
        repositoryRoot,
      ]) {
        fs.mkdirSync(pathname, { mode: 0o700 });
      }
      const reportedCheckoutRoot = path.join(directory, 'primary link');
      fs.symlinkSync(primaryCheckoutRoot, reportedCheckoutRoot, 'dir');
      const tracePath = path.join(directory, 'git-trace');
      const outputPath = path.join(directory, 'git-output');
      const fixture = {
        primaryCheckoutRoot,
        reportedCheckoutRoot,
        repositoryRoot,
        tracePath,
      };
      fs.writeFileSync(path.join(binDirectory, 'git'), fakeGit, {
        mode: 0o700,
      });
      fs.writeFileSync(outputPath, output(fixture), { mode: 0o600 });
      const environment = {
        PATH: binDirectory,
        PRIMARY_PROVIDER_GIT_OUTPUT_PATH: outputPath,
        PRIMARY_PROVIDER_GIT_STATUS: String(result.status),
        PRIMARY_PROVIDER_GIT_STDERR: result.stderr,
        PRIMARY_PROVIDER_GIT_TRACE_PATH: tracePath,
      };
      for (const [name, value] of Object.entries(environment)) {
        const originalValue = process.env[name];
        registerCleanup(() => {
          if (originalValue === undefined) {
            if (!Reflect.deleteProperty(process.env, name)) {
              throw new TypeError(
                `Could not delete environment variable ${name}`,
              );
            }
          } else process.env[name] = originalValue;
        });
        process.env[name] = value;
      }
      run(fixture);
    },
  );
};

describe('primary checkout provider credentials', () => {
  it('loads only missing provider values and leaves worktree settings unchanged', () => {
    withPrimaryEnvironment(
      [
        'DATABASE_URL=postgresql://primary.example/unsafe',
        'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER=expired-card',
        'E2E_LIVE_ESN_CARD_IDENTIFIER=active-card',
        'PUBLIC_GOOGLE_MAPS_API_KEY=maps-key',
      ].join('\n'),
      (primaryCheckoutRoot) => {
        const result = providerEnvironmentFromPrimaryCheckout({
          environment: {
            DATABASE_URL: 'postgresql://localhost/worktree',
            E2E_LIVE_ESN_CARD_IDENTIFIER: 'explicit-active-card',
          },
          primaryCheckoutRoot,
        });

        expect(result.loadedNames).toEqual([
          'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER',
          'PUBLIC_GOOGLE_MAPS_API_KEY',
        ]);
        expect(result.environment).toMatchObject({
          DATABASE_URL: 'postgresql://localhost/worktree',
          E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER: 'expired-card',
          E2E_LIVE_ESN_CARD_IDENTIFIER: 'explicit-active-card',
          PUBLIC_GOOGLE_MAPS_API_KEY: 'maps-key',
        });
      },
    );
  });

  it('does not read the primary file when every provider value is already set', () => {
    const result = providerEnvironmentFromPrimaryCheckout({
      environment: Object.fromEntries(
        primaryCheckoutProviderCredentialNames.map((name) => [name, name]),
      ),
      primaryCheckoutRoot: '/does/not/exist',
    });

    expect(result.loadedNames).toEqual([]);
  });

  it('leaves missing values visible when the primary checkout has no local env', () => {
    withOwnedFixture('evorto empty primary env ', (primaryCheckoutRoot) => {
      const result = providerEnvironmentFromPrimaryCheckout({
        environment: { DATABASE_URL: 'postgresql://localhost/worktree' },
        primaryCheckoutRoot,
      });

      expect(result.loadedNames).toEqual([]);
      expect(result.environment).toEqual({
        DATABASE_URL: 'postgresql://localhost/worktree',
      });
    });
  });
});

describe('primary checkout resolution', () => {
  it('uses the first NUL-delimited Git worktree and resolves its real path', () => {
    withGitFixture(
      ({ reportedCheckoutRoot, repositoryRoot }) =>
        `worktree ${reportedCheckoutRoot}\0HEAD primary-head\0\0worktree ${repositoryRoot}\0HEAD linked-head\0`,
      ({ primaryCheckoutRoot, repositoryRoot, tracePath }) => {
        expect(resolvePrimaryCheckoutRoot(repositoryRoot)).toBe(
          fs.realpathSync(primaryCheckoutRoot),
        );
        const [workingDirectory, ...gitArguments] = fs
          .readFileSync(tracePath, 'utf8')
          .split('\0')
          .slice(0, -1);
        if (!workingDirectory) throw new Error('Expected the Git fixture cwd');
        expect(fs.realpathSync(workingDirectory)).toBe(
          fs.realpathSync(repositoryRoot),
        );
        expect(gitArguments).toEqual(['worktree', 'list', '--porcelain', '-z']);
      },
    );
  });

  it('preserves the Git failure detail instead of guessing a checkout', () => {
    withGitFixture(
      () => '',
      ({ repositoryRoot }) => {
        expect(() => resolvePrimaryCheckoutRoot(repositoryRoot)).toThrow(
          'Could not locate the primary checkout: Synthetic Git fixture failure',
        );
      },
      { status: 23, stderr: 'Synthetic Git fixture failure\n' },
    );
  });

  it('rejects a malformed empty primary worktree path', () => {
    withGitFixture(
      () => 'worktree \0HEAD fixture-head\0',
      ({ repositoryRoot }) => {
        expect(() => resolvePrimaryCheckoutRoot(repositoryRoot)).toThrow(
          'Git did not report a primary checkout',
        );
      },
    );
  });

  it('rejects Git output without a worktree record', () => {
    withGitFixture(
      () => 'HEAD fixture-head\0branch refs/heads/fixture\0',
      ({ repositoryRoot }) => {
        expect(() => resolvePrimaryCheckoutRoot(repositoryRoot)).toThrow(
          'Git did not report a primary checkout',
        );
      },
    );
  });
});

describe('primary provider environment file ownership', () => {
  it('rejects a symbolic-link env file', () => {
    withOwnedFixture('evorto linked provider env ', (primaryCheckoutRoot) => {
      const target = path.join(primaryCheckoutRoot, 'fixture-provider-values');
      fs.writeFileSync(
        target,
        'PUBLIC_GOOGLE_MAPS_API_KEY=fixture-maps-key\n',
        {
          mode: 0o600,
        },
      );
      fs.symlinkSync(target, path.join(primaryCheckoutRoot, '.env'));

      expect(() =>
        providerEnvironmentFromPrimaryCheckout({
          environment: {},
          primaryCheckoutRoot,
        }),
      ).toThrow('The primary checkout .env must be a regular file');
    });
  });

  it('rejects a directory at the env-file path', () => {
    withOwnedFixture(
      'evorto directory provider env ',
      (primaryCheckoutRoot) => {
        fs.mkdirSync(path.join(primaryCheckoutRoot, '.env'), { mode: 0o700 });

        expect(() =>
          providerEnvironmentFromPrimaryCheckout({
            environment: {},
            primaryCheckoutRoot,
          }),
        ).toThrow('The primary checkout .env must be a regular file');
      },
    );
  });
});
