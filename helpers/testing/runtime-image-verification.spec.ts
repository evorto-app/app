import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const imageReference = 'registry.example.invalid/evorto:test';
const verifier = path.join(
  process.cwd(),
  'ops/scaleway/verify-runtime-image.sh',
);
const requiredArtifacts = [
  'app/dist/evorto/server/server.mjs',
  'app/dist/evorto/ops/schema.mjs',
  'app/dist/evorto/ops/database-prerequisites.mjs',
  'app/dist/evorto/ops/reset-staging-database.mjs',
  'app/dist/evorto/ops/seed-staging.mjs',
  'app/ops/drizzle.config.mjs',
  'app/ops/drizzle-kit.cjs',
];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

const makeFixture = (
  options: {
    files?: Record<string, string>;
    omit?: string;
    symlink?: { path: string; external?: boolean };
  } = {},
) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-runtime-image-'),
  );
  temporaryDirectories.push(directory);
  const bin = path.join(directory, 'bin');
  const root = path.join(directory, 'archive root');
  const temporaryRoot = path.join(directory, 'verifier temp');
  for (const target of [bin, root, temporaryRoot]) {
    fs.mkdirSync(target, { recursive: true });
  }
  const callLog = path.join(directory, 'calls.log');
  const cacheLog = path.join(directory, 'cache.log');
  const cacheDirectory = path.join(root, 'app/.cache/evorto/server-kv');
  const cacheHooks = path.join(directory, 'cache-hooks.cjs');
  const archive = path.join(directory, 'image.tar');
  fs.writeFileSync(callLog, '');
  fs.writeFileSync(cacheLog, '');
  fs.writeFileSync(
    cacheHooks,
    String.raw`
const fs = require('node:fs');
const writeFileSync = fs.writeFileSync;
const readFileSync = fs.readFileSync;
const unlinkSync = fs.unlinkSync;
fs.writeFileSync = (...args) => {
  fs.appendFileSync(process.env.CACHE_LOG, 'write\n');
  if (process.env.CACHE_FAILURE === 'write') {
    writeFileSync(args[0], 'partial cache write');
    throw new Error('Injected cache write failure');
  }
  return writeFileSync(...args);
};
fs.readFileSync = (...args) => {
  fs.appendFileSync(process.env.CACHE_LOG, 'read\n');
  if (process.env.CACHE_FAILURE === 'read') throw new Error('Injected cache read failure');
  const contents = readFileSync(...args);
  return process.env.CACHE_FAILURE === 'mismatch' ? 'incorrect contents' : contents;
};
fs.unlinkSync = (...args) => {
  fs.appendFileSync(process.env.CACHE_LOG, 'delete\n');
  return unlinkSync(...args);
};
`,
  );
  const files: Record<string, string> = {
    ...Object.fromEntries(
      requiredArtifacts.map((artifact) => [artifact, 'export default {};\n']),
    ),
    'app/dist/evorto/browser/shell-guide.txt': 'Bun starts directly.\n',
    'usr/local/bin/bun': 'runtime fixture\n',
    ...options.files,
  };
  const entries = Object.entries(files).filter(
    ([file]) => file !== options.omit,
  );
  for (const [file, contents] of entries) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  const linkedTarget = path.join(
    options.symlink?.external ? directory : root,
    'linked-artifact',
  );
  if (options.symlink) {
    const linkedPath = path.join(root, options.symlink.path);
    fs.renameSync(linkedPath, linkedTarget);
    fs.symlinkSync(
      options.symlink.external
        ? linkedTarget
        : path.relative(path.dirname(linkedPath), linkedTarget),
      linkedPath,
    );
  }
  const tarPath = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-c', 'command -v tar'],
    { encoding: 'utf8' },
  );
  expect(tarPath.status, tarPath.stderr).toBe(0);
  const realTar = tarPath.stdout.trim();
  const archived = spawnSync(
    realTar,
    ['--create', `--file=${archive}`, `--directory=${root}`, '.'],
    { encoding: 'utf8' },
  );
  expect(archived.status, archived.stderr).toBe(0);
  fs.writeFileSync(
    path.join(bin, 'docker'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  image)
    [ "$#" -eq 5 ]
    [ "$2" = inspect ]
    [ "$3" = --format ]
    [ "$5" = "$EXPECTED_IMAGE_REFERENCE" ]
    case "$4" in
      '{{.Size}}')
        printf '%s\n' image-size >> "$CALL_LOG"
        printf '%s\n' "$IMAGE_SIZE"
        ;;
      '{{.Os}}/{{.Architecture}}') printf '%s\n' "$IMAGE_PLATFORM" ;;
      *) exit 90 ;;
    esac
    ;;
  create)
    [ "$#" -eq 2 ]
    [ "$2" = "$EXPECTED_IMAGE_REFERENCE" ]
    printf '%s\n' create >> "$CALL_LOG"
    printf '%s\n' runtime-container
    ;;
  inspect)
    [ "$#" -eq 4 ]
    [ "$2" = --format ]
    [ "$4" = runtime-container ]
    case "$3" in
      '{{.Config.User}}') printf '%s\n' "$RUNTIME_USER" ;;
      '{{.Config.WorkingDir}}') printf '%s\n' "$RUNTIME_WORKDIR" ;;
      '{{json .Config.Entrypoint}}') printf '%s\n' "$RUNTIME_ENTRYPOINT" ;;
      '{{json .Config.Cmd}}') printf '%s\n' "$RUNTIME_COMMAND" ;;
      *) exit 90 ;;
    esac
    ;;
  export)
    [ "$#" -eq 2 ]
    [ "$2" = runtime-container ]
    printf '%s\n' export >> "$CALL_LOG"
    cat "$ARCHIVE_FIXTURE"
    if [ "$FAIL_STAGE" = export ]; then exit 41; fi
    ;;
  run)
    shift
    [ "$1" = --rm ]
    shift
    [ "$1" = --pull=never ]
    shift
    [[ "$1" = --platform && "$2" = "$IMAGE_PLATFORM" ]]
    shift 2
    [[ "$1" = --network && "$2" = none ]]
    shift 2
    read_only=false
    if [ "$1" = --read-only ]; then read_only=true; shift; fi
    [[ "$1" = --entrypoint && "$2" = /usr/local/bin/bun ]]
    shift 2
    [ "$1" = "$EXPECTED_IMAGE_REFERENCE" ]
    shift
    [ "$1" = --eval ]
    shift
    runtime_script="$1"
    shift
    if [ "$read_only" = false ]; then
      [ "$#" -eq 0 ]
      printf '%s\n' cache >> "$CALL_LOG"
      cd "$FIXTURE_ROOT$RUNTIME_WORKDIR"
      exec bun --preload "$CACHE_HOOKS" --eval "$runtime_script"
    fi
    [ "$#" -eq 7 ]
    printf '%s\n' readability >> "$CALL_LOG"
    if [ "$FAIL_STAGE" = readability ]; then exit 44; fi
    if [ -n "$UNREADABLE_ARTIFACT" ]; then chmod 000 "$FIXTURE_ROOT/$UNREADABLE_ARTIFACT"; fi
    for artifact in "$@"; do
      [[ "$artifact" = /app/* ]]
      set -- "$@" "$FIXTURE_ROOT$artifact"
      shift
    done
    exec bun --eval "$runtime_script" "$@"
    ;;
  rm)
    [ "$#" -eq 2 ]
    [ "$2" = runtime-container ]
    printf '%s\n' remove >> "$CALL_LOG"
    if [ "$CLEANUP_FAILS" = true ]; then exit 45; fi
    ;;
  *) exit 90 ;;
esac
`,
    { mode: 0o700 },
  );
  fs.writeFileSync(
    path.join(bin, 'tar'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  --list)
    printf '%s\n' list >> "$CALL_LOG"
    if [ "$FAIL_STAGE" = list ]; then exit 42; fi
    ;;
  --extract)
    printf '%s\n' extract >> "$CALL_LOG"
    if [ "$FAIL_STAGE" = extract ]; then exit 43; fi
    ;;
  *) exit 90 ;;
esac
exec "$REAL_TAR" "$@"
`,
    { mode: 0o700 },
  );
  const calls = () => fs.readFileSync(callLog, 'utf8').trim().split('\n');

  return {
    cacheFiles: () =>
      fs.existsSync(cacheDirectory) ? fs.readdirSync(cacheDirectory) : [],
    cacheOperations: () => fs.readFileSync(cacheLog, 'utf8').trim().split('\n'),
    calls,
    expectCleanup: () => {
      expect(calls().at(-1)).toBe('remove');
      expect(fs.readdirSync(temporaryRoot)).toEqual([]);
      if (options.symlink?.external) {
        expect(fs.existsSync(linkedTarget)).toBe(true);
      }
    },
    run: (
      settings: {
        cacheFailure?: 'mismatch' | 'read' | 'write';
        cleanupFails?: boolean;
        command?: string;
        entrypoint?: string;
        failStage?: 'export' | 'extract' | 'list' | 'readability';
        platform?: string;
        size?: number;
        unreadableArtifact?: string;
        user?: string;
        workdir?: string;
      } = {},
    ) =>
      spawnSync('bash', ['--noprofile', '--norc', verifier, imageReference], {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ARCHIVE_FIXTURE: archive,
          CACHE_FAILURE: settings.cacheFailure ?? '',
          CACHE_HOOKS: cacheHooks,
          CACHE_LOG: cacheLog,
          CALL_LOG: callLog,
          CLEANUP_FAILS: String(settings.cleanupFails ?? false),
          EXPECTED_IMAGE_REFERENCE: imageReference,
          FAIL_STAGE: settings.failStage ?? '',
          FIXTURE_ROOT: root,
          IMAGE_PLATFORM: settings.platform ?? 'linux/amd64',
          IMAGE_SIZE: String(settings.size ?? 999_999_999),
          PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
          REAL_TAR: realTar,
          RUNTIME_COMMAND:
            settings.command ?? '["dist/evorto/server/server.mjs"]',
          RUNTIME_ENTRYPOINT: settings.entrypoint ?? '["/usr/local/bin/bun"]',
          RUNTIME_USER: settings.user ?? '65532:65532',
          RUNTIME_WORKDIR: settings.workdir ?? '/app',
          TMPDIR: temporaryRoot,
          UNREADABLE_ARTIFACT: settings.unreadableArtifact ?? '',
        },
        timeout: 10_000,
      }),
  };
};

describe('runtime image verification', () => {
  it('accepts a complete non-root Bun image and preserves existing cache files', () => {
    const fixture = makeFixture({
      files: { 'app/.cache/evorto/server-kv/existing-key': 'existing value' },
    });
    const result = fixture.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Runtime image verification passed');
    expect(fixture.calls()).toEqual([
      'image-size',
      'create',
      'export',
      'list',
      'extract',
      'readability',
      'cache',
      'remove',
    ]);
    fixture.expectCleanup();
    expect(fixture.cacheOperations()).toEqual(['write', 'read', 'delete']);
    expect(fixture.cacheFiles()).toEqual(['existing-key']);
  });

  it.each(['', '/', '/other', '/app/'])(
    'rejects working directory %j before inspecting artifacts',
    (workdir) => {
      const fixture = makeFixture();
      const result = fixture.run({ workdir });
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain('must use /app as its working directory');
      expect(fixture.calls()).not.toContain('export');
      fixture.expectCleanup();
    },
  );

  it.each(['write', 'read', 'mismatch'] as const)(
    'removes its cache probe after a cache %s failure',
    (cacheFailure) => {
      const fixture = makeFixture();
      const result = fixture.run({ cacheFailure });
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stderr).toContain(
        'must be able to create, write, read, and delete files in .cache/evorto/server-kv',
      );
      expect(result.stdout).not.toContain('verification passed');
      expect(fixture.cacheOperations()).toEqual(
        cacheFailure === 'write'
          ? ['write', 'delete']
          : ['write', 'read', 'delete'],
      );
      expect(fixture.cacheFiles()).toEqual([]);
      fixture.expectCleanup();
    },
  );

  it('fails when the runtime cache directory cannot be created', () => {
    const fixture = makeFixture({ files: { 'app/.cache': 'not a directory' } });
    const result = fixture.run();
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain('ENOTDIR');
    expect(result.stderr).toContain(
      'must be able to create, write, read, and delete files in .cache/evorto/server-kv',
    );
    expect(result.stdout).not.toContain('verification passed');
    fixture.expectCleanup();
  });

  it('fails closed when inspection-container cleanup fails', () => {
    const fixture = makeFixture();
    const result = fixture.run({ cleanupFails: true });
    expect(result.status, result.stderr).toBe(45);
    expect(result.stderr).toContain('verification cleanup failed');
    expect(result.stdout).not.toContain('verification passed');
    fixture.expectCleanup();
  });

  it('preserves a probe failure when inspection-container cleanup also fails', () => {
    const fixture = makeFixture();
    const result = fixture.run({
      cleanupFails: true,
      failStage: 'readability',
    });
    expect(result.status, result.stderr).toBe(44);
    expect(result.stderr).toContain('verification cleanup failed');
    expect(result.stdout).not.toContain('verification passed');
    fixture.expectCleanup();
  });

  it('rejects every forbidden shell path in the image', () => {
    const shellPaths = [
      'busybox',
      'opt/tools/sh',
      'app/debug/bash',
      'usr/bin/dash',
      'sbin/ash',
      'usr/local/bin/ZSH',
      'usr/local/sbin/ksh',
      'usr/sbin/csh',
      './bin/tcsh',
      'usr/bin/fish',
    ];
    const fixture = makeFixture({
      files: Object.fromEntries(
        shellPaths.map((file) => [file, 'shell fixture\n']),
      ),
    });
    const result = fixture.run();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('Runtime image contains a shell');
    // The verifier reports every match before rejecting this image.
    for (const shellPath of shellPaths) {
      expect(result.stderr).toContain(shellPath);
    }
    expect(result.stdout).not.toContain('verification passed');
    fixture.expectCleanup();
  });

  it.each([
    { path: 'app' },
    { path: 'app/dist' },
    { path: 'app/dist/evorto' },
    { path: 'app/dist/evorto/server' },
    { path: 'app/dist/evorto/server/server.mjs' },
    { path: 'app/ops' },
    { path: 'app/ops/drizzle.config.mjs' },
    { path: 'app', external: true },
    { path: 'app/dist/evorto/server/server.mjs', external: true },
  ])(
    'rejects a symlink in required path $path (external: $external)',
    (symlink) => {
      const fixture = makeFixture({ symlink });
      const result = fixture.run();
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain(
        'required artifact path contains a symlink',
      );
      expect(result.stderr).toContain(symlink.path);
      expect(result.stdout).not.toContain('verification passed');
      fixture.expectCleanup();
    },
  );

  it.each(requiredArtifacts)(
    'rejects a missing packaged artifact %s',
    (file) => {
      const fixture = makeFixture({ omit: file });
      const result = fixture.run();
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain('missing a required regular artifact');
      expect(result.stderr).toContain(file);
      expect(result.stdout).not.toContain('verification passed');
      fixture.expectCleanup();
    },
  );

  it.each(requiredArtifacts)(
    'rejects an artifact that the image user cannot read: %s',
    (unreadableArtifact) => {
      const fixture = makeFixture();
      const result = fixture.run({ unreadableArtifact });
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stderr).toContain(unreadableArtifact);
      expect(result.stderr).toContain('EACCES');
      expect(result.stderr).toContain(
        'Runtime artifacts must be readable by the configured image user',
      );
      expect(result.stdout).not.toContain('verification passed');
      expect(fixture.calls()).toContain('readability');
      fixture.expectCleanup();
    },
  );

  it('uses the inspected image platform for the runtime check', () => {
    const fixture = makeFixture();
    const result = fixture.run({ platform: 'linux/arm64' });
    expect(result.status, result.stderr).toBe(0);
    expect(fixture.calls()).toContain('readability');
    fixture.expectCleanup();
  });

  it('rejects every forbidden packaged path in the image', () => {
    const forbiddenPaths = [
      'app/.env.production',
      'app/instrument.mjs',
      'app/node_modules/@sentry/core/index.js',
      'app/node_modules/@neondatabase/serverless/index.js',
      'app/node_modules/resend/index.js',
      'app/dist/evorto/server/server.mjs.map',
    ];
    const fixture = makeFixture({
      files: Object.fromEntries(
        forbiddenPaths.map((file) => [file, 'forbidden fixture\n']),
      ),
    });
    const result = fixture.run();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      'forbidden secret, provider, instrumentation',
    );
    for (const file of forbiddenPaths) {
      expect(result.stderr).toContain(file);
    }
    expect(result.stdout).not.toContain('verification passed');
    fixture.expectCleanup();
  });

  it('rejects removed provider content across the runtime scan roots', () => {
    const files = {
      'app/dist/evorto/server/server.mjs': 'https://api.resend.com',
      'app/dist/evorto/ops/schema.mjs': '@neondatabase/serverless',
      'app/ops/drizzle.config.mjs': 'CLOUDFLARE_R2_ACCESS_KEY_ID',
    };
    const fixture = makeFixture({ files });
    const result = fixture.run();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('removed provider dependency');
    for (const [file, contents] of Object.entries(files)) {
      expect(result.stderr).toContain(file);
      expect(result.stderr).toContain(contents);
    }
    expect(result.stdout).not.toContain('verification passed');
    fixture.expectCleanup();
  });

  it.each(['', '0:0', '65532'])('rejects runtime user %j', (user) => {
    const fixture = makeFixture();
    const result = fixture.run({ user });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('explicit non-root user 65532:65532');
    expect(fixture.calls()).not.toContain('export');
    fixture.expectCleanup();
  });

  it('rejects an indirect Bun entrypoint', () => {
    const fixture = makeFixture();
    const result = fixture.run({ entrypoint: '["/bin/sh","-c"]' });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('must start Bun directly');
    fixture.expectCleanup();
  });

  it('rejects a different default command', () => {
    const fixture = makeFixture();
    const result = fixture.run({ command: '["another-server.mjs"]' });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('unexpected default command');
    fixture.expectCleanup();
  });

  it('rejects an image at the size limit before creating a container', () => {
    const fixture = makeFixture();
    const result = fixture.run({ size: 1_000_000_000 });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('must be below 1000000000 bytes');
    expect(fixture.calls()).toEqual(['image-size']);
  });

  it.each([
    { stage: 'export', status: 41, calls: ['export'] },
    { stage: 'list', status: 42, calls: ['export', 'list'] },
    { stage: 'extract', status: 43, calls: ['export', 'list', 'extract'] },
    {
      stage: 'readability',
      status: 44,
      calls: ['export', 'list', 'extract', 'readability'],
    },
  ] satisfies {
    stage: 'export' | 'extract' | 'list' | 'readability';
    status: number;
    calls: string[];
  }[])('stops and cleans up after $stage fails', ({ stage, status, calls }) => {
    const fixture = makeFixture();
    const result = fixture.run({ failStage: stage });
    expect(result.status, result.stderr).toBe(status);
    expect(result.stdout).not.toContain('verification passed');
    expect(fixture.calls()).toEqual([
      'image-size',
      'create',
      ...calls,
      'remove',
    ]);
    fixture.expectCleanup();
  });
});
