import { Schema } from 'effect';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { primaryCheckoutProviderCredentialNames } from './primary-provider-credentials';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const wallClockTimeoutScript = path.join(
  repositoryRoot,
  'helpers/testing/run-with-wall-clock-timeout.ts',
);
const providerWrapperScript = path.join(
  repositoryRoot,
  'helpers/testing/run-with-primary-provider-credentials.ts',
);
const packageJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ scripts: Schema.Record(Schema.String, Schema.String) }),
  ),
)(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const bunPathResult = spawnSync('/bin/sh', ['-c', 'command -v bun'], {
  encoding: 'utf8',
});
const bunPath = bunPathResult.stdout.trim();
if (bunPathResult.error) throw bunPathResult.error;
if (bunPathResult.status !== 0 || !path.isAbsolute(bunPath)) {
  throw new Error('Bun is required for package-script argument tests');
}

const withOwnedWrapperDirectory = async <T>(
  prefix: string,
  run: (directory: string) => Promise<T>,
): Promise<T> => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  const failures: unknown[] = [];
  let result: { value: T } | undefined;
  try {
    result = { value: await run(directory) };
  } catch (error) {
    failures.push(error);
  }
  try {
    rmSync(directory, { force: true, recursive: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      'Provider wrapper fixture action and cleanup failed',
      { cause: failures[0] },
    );
  }
  if (!result) throw new Error('Provider wrapper fixture produced no result');
  return result.value;
};

const captureOwnedCommand = async (
  directory: string,
  environment: NodeJS.ProcessEnv,
  command: readonly string[],
) => {
  const failures: unknown[] = [];
  let stdout = '';
  let stderr = '';
  const child = spawn(
    bunPath,
    ['run', '--no-env-file', wallClockTimeoutScript, '30', '2', ...command],
    { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const onError = (error: Error) => failures.push(error);
  const onStdout = (chunk: string) => {
    stdout += chunk;
  };
  const onStderr = (chunk: string) => {
    stderr += chunk;
  };
  const closed = new Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once('close', (status, signal) => resolve({ status, signal }));
  });
  child.on('error', onError);
  child.stdout.on('error', onError);
  child.stderr.on('error', onError);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);

  // The accepted helper owns command timeout, grace, and descendant settlement.
  // Its close event also waits for these captured streams to drain. Keep waiting
  // after a process/stream error; never remove fixture files while it is live.
  const outcome = await closed;
  for (const cleanup of [
    () => child.removeListener('error', onError),
    () => child.stdout.removeListener('error', onError),
    () => child.stderr.removeListener('error', onError),
    () => child.stdout.removeListener('data', onStdout),
    () => child.stderr.removeListener('data', onStderr),
  ]) {
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
      'Owned wrapper process and stream cleanup failed',
      { cause: failures[0] },
    );
  }
  return { ...outcome, stdout, stderr };
};

const fakeBun = String.raw`#!/bin/sh
set -eu
case "$1" in
  run)
    case "$2" in
      env:run)
        shift 2
        exec fixture-env-run "$@"
        ;;
      test:e2e:check|test:unit:esncard-provider-error)
        [ "$#" -eq 2 ] || exit 61
        printf 'run:%s\n' "$2" >> "$WRAPPER_TRACE"
        ;;
      *) exit 62 ;;
    esac
    ;;
  helpers/testing/runtime-preflight.ts)
    [ "$#" -eq 2 ] && [ "$2" = esncard-release ] || exit 63
    printf '%s\n' preflight:esncard-release >> "$WRAPPER_TRACE"
    ;;
  helpers/testing/run-with-primary-provider-credentials.ts)
    shift
    [ "$1" = -- ] || exit 64
    shift
    [ "$1" = sh ] && [ "$2" = -c ] || exit 65
    printf '%s\n' provider-wrapper >> "$WRAPPER_TRACE"
    exec "$@"
    ;;
  *) exit 66 ;;
esac
`;
const fakeEnvironmentRunner = String.raw`#!/bin/sh
set -eu
if [ "$1" = -- ]; then shift; fi
[ "$1" = bun ] || exit 68
printf '%s\n' run:env:run >> "$WRAPPER_TRACE"
exec "$@"
`;
const fakePlaywright = String.raw`#!/bin/sh
set -eu
printf '%s\0' "$@" > "$PLAYWRIGHT_ARGUMENTS"
printf '%s\0' "$E2E_SELECTED_PROJECTS" "$PLAYWRIGHT_SELECTED_PROJECTS" "$DOCS_OUT_DIR" "$DOCS_IMG_OUT_DIR" > "$PLAYWRIGHT_ENVIRONMENT"
printf '%s\n' playwright >> "$WRAPPER_TRACE"
`;
const fakeCredentialWrapper = String.raw`
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const [command, ...args] = process.argv.slice(2);
if (command !== 'sh' || args[0] !== '-c') {
  throw new Error('Unexpected fake credential-wrapper command');
}
const trace = process.env['WRAPPER_TRACE'];
const bin = process.env['FAKE_BINARY_DIRECTORY'];
if (!trace || !bin) throw new Error('Missing fake wrapper paths');
appendFileSync(trace, 'provider-wrapper\n');
const result = spawnSync(command, args, {
  env: { ...process.env, PATH: bin },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
`;

const captureWrapper = (scriptName: string, forwarded: readonly string[]) => {
  const script = packageJson.scripts[scriptName];
  if (!script) throw new Error(`Missing package script: ${scriptName}`);
  return withOwnedWrapperDirectory(
    'evorto-playwright-arguments-',
    async (directory) => {
      const binDirectory = path.join(directory, 'node_modules', '.bin');
      mkdirSync(binDirectory, { recursive: true });
      for (const [name, source] of [
        ['bun', fakeBun],
        ['fixture-bun', fakeBun],
        ['fixture-env-run', fakeEnvironmentRunner],
        ['playwright', fakePlaywright],
      ]) {
        if (!name || !source) throw new Error('Incomplete fake executable');
        const executable = path.join(binDirectory, name);
        writeFileSync(executable, source);
        chmodSync(executable, 0o700);
      }
      symlinkSync('/bin/sh', path.join(binDirectory, 'sh'));
      const helperDirectory = path.join(directory, 'helpers', 'testing');
      mkdirSync(helperDirectory, { recursive: true });
      writeFileSync(
        path.join(helperDirectory, 'run-with-primary-provider-credentials.ts'),
        fakeCredentialWrapper,
      );
      writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify({
          private: true,
          scripts: {
            'env:run': 'fixture-env-run',
            'test:e2e:check': 'fixture-bun run test:e2e:check',
            'test:unit:esncard-provider-error':
              'fixture-bun run test:unit:esncard-provider-error',
            [scriptName]: script,
          },
        }),
      );
      const argumentsPath = path.join(directory, 'playwright-arguments');
      const environmentPath = path.join(directory, 'playwright-environment');
      const tracePath = path.join(directory, 'wrapper-trace');
      const result = await captureOwnedCommand(
        directory,
        {
          FAKE_BINARY_DIRECTORY: binDirectory,
          PATH: binDirectory,
          PLAYWRIGHT_ARGUMENTS: argumentsPath,
          PLAYWRIGHT_ENVIRONMENT: environmentPath,
          WRAPPER_TRACE: tracePath,
        },
        [bunPath, 'run', scriptName, ...forwarded],
      );
      expect(result.status, result.stderr).toBe(0);
      return {
        arguments: readFileSync(argumentsPath, 'utf8').split('\0').slice(0, -1),
        environment: readFileSync(environmentPath, 'utf8')
          .split('\0')
          .slice(0, -1),
        trace: readFileSync(tracePath, 'utf8').trimEnd().split('\n'),
      };
    },
  );
};

const liveArguments = [
  'test',
  'tests/specs/profile/user-profile-live-esncard.spec.ts',
  'tests/docs/profile/discounts.doc.ts',
  '--project=local-chrome-live-esncard',
  '--project=docs-live-esncard',
  '--grep',
  '@needs-live-esncard',
];
const wrappers = [
  {
    name: 'test:e2e:integration',
    arguments: [
      'test',
      '--project=local-chrome-integration',
      '--project=docs-integration',
    ],
    projects: 'local-chrome-integration,docs-integration',
    trace: [
      'run:test:e2e:check',
      'run:env:run',
      'provider-wrapper',
      'playwright',
    ],
  },
  {
    name: 'test:e2e:live-esncard',
    arguments: liveArguments,
    projects: 'local-chrome-live-esncard,docs-live-esncard',
    trace: [
      'run:env:run',
      'provider-wrapper',
      'preflight:esncard-release',
      'playwright',
    ],
  },
  {
    name: 'test:e2e:live-esncard:release',
    arguments: [
      ...liveArguments,
      '--trace=off',
      '--reporter=./tests/support/reporters/protected-value-sanitizer-reporter.ts,github,dot,./tests/support/reporters/complete-playwright-run-reporter.ts',
    ],
    projects: 'local-chrome-live-esncard,docs-live-esncard',
    trace: [
      'run:env:run',
      'provider-wrapper',
      'preflight:esncard-release',
      'run:test:unit:esncard-provider-error',
      'playwright',
    ],
  },
];
const invocations = [
  { label: 'keeps its canonical arguments', arguments: [] },
  { label: 'forwards --list', arguments: ['--list'] },
  {
    label: 'forwards a spaced --grep pattern as one argument',
    arguments: ['--grep', 'participant profile .* card'],
  },
];

describe('Playwright package wrapper arguments', () => {
  for (const wrapper of wrappers) {
    for (const invocation of invocations) {
      it(`${wrapper.name} ${invocation.label}`, async () => {
        const captured = await captureWrapper(
          wrapper.name,
          invocation.arguments,
        );
        expect(captured.arguments).toEqual([
          ...wrapper.arguments,
          ...invocation.arguments,
        ]);
        expect(captured.environment).toEqual([
          wrapper.projects,
          wrapper.projects,
          'test-results/docs',
          'test-results/docs/images',
        ]);
        expect(captured.trace).toEqual(wrapper.trace);
      }, 45_000);
    }
  }
});

const withActualProviderWrapper = async (
  argumentsFor: (directory: string) => readonly string[],
  check: (
    result: Awaited<ReturnType<typeof captureOwnedCommand>>,
    fixture: { directory: string; gitTracePath: string },
  ) => void,
): Promise<void> => {
  await withOwnedWrapperDirectory(
    'evorto-provider-wrapper-',
    async (directory) => {
      const binDirectory = path.join(directory, 'bin');
      mkdirSync(binDirectory, { mode: 0o700 });
      // A loader regression must use this owned Git and reject this owned .env,
      // rather than discover a real checkout or read real provider values.
      mkdirSync(path.join(directory, '.env'), { mode: 0o700 });
      const gitTracePath = path.join(directory, 'git-access');
      writeFileSync(
        path.join(binDirectory, 'git'),
        String.raw`#!/bin/sh
set -eu
printf '%s\n' 'unexpected Git lookup' >> "$PROVIDER_WRAPPER_GIT_TRACE"
printf 'worktree %s\0' "$PROVIDER_WRAPPER_ROOT"
`,
        { mode: 0o700 },
      );
      const environment: NodeJS.ProcessEnv = {
        ...Object.fromEntries(
          primaryCheckoutProviderCredentialNames.map((name) => [
            name,
            `synthetic-${name}`,
          ]),
        ),
        HOME: directory,
        PATH: binDirectory,
        PROVIDER_WRAPPER_GIT_TRACE: gitTracePath,
        PROVIDER_WRAPPER_ROOT: directory,
      };
      const result = await captureOwnedCommand(directory, environment, [
        bunPath,
        'run',
        '--no-env-file',
        providerWrapperScript,
        ...argumentsFor(directory),
      ]);
      check(result, { directory, gitTracePath });
    },
  );
};

describe('primary provider wrapper failures', () => {
  it('rejects a missing command at the actual wrapper boundary', async () => {
    await withActualProviderWrapper(
      () => [],
      (result, { gitTracePath }) => {
        expect(result.status).toBe(1);
        expect(result.signal).toBeNull();
        expect(result.stderr).toContain(
          'Expected a command to run with local provider credentials',
        );
        expect(result.stdout).toBe('');
        expect(existsSync(gitTracePath)).toBe(false);
      },
    );
  }, 45_000);

  it('preserves a child spawn failure at the actual wrapper boundary', async () => {
    await withActualProviderWrapper(
      (directory) => [path.join(directory, 'missing-command')],
      (result, { directory, gitTracePath }) => {
        expect(result.status).toBe(1);
        expect(result.signal).toBeNull();
        expect(result.stderr).toContain('ENOENT');
        expect(result.stderr).toContain(
          path.join(directory, 'missing-command'),
        );
        expect(result.stdout).toBe('');
        expect(existsSync(gitTracePath)).toBe(false);
      },
    );
  }, 45_000);

  it('preserves the child status and both output streams', async () => {
    await withActualProviderWrapper(
      () => [
        '/bin/sh',
        '-c',
        "printf '%s\\n' 'owned child stdout'; printf '%s\\n' 'owned child stderr' >&2; exit 37",
      ],
      (result, { gitTracePath }) => {
        expect(result.status).toBe(37);
        expect(result.signal).toBeNull();
        expect(result.stdout).toBe('owned child stdout\n');
        expect(result.stderr).toBe('owned child stderr\n');
        expect(existsSync(gitTracePath)).toBe(false);
      },
    );
  }, 45_000);
});
