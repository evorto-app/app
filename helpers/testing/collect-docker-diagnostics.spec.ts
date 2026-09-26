import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const script = path.join(import.meta.dirname, 'collect-docker-diagnostics.sh');
const fixture = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'evorto-diagnostics-'));
  directories.push(directory);
  const argumentsPath = path.join(directory, 'arguments');
  writeFileSync(
    path.join(directory, 'docker'),
    `#!/usr/bin/env bash
printf '%s\n' "$@" > "$DOCKER_ARGUMENTS"
printf 'diagnostic output'
printf 'diagnostic error' >&2
exit "$DOCKER_EXIT"
`,
    { mode: 0o700 },
  );
  return {
    argumentsPath,
    run: (args: string[], exit = 0) =>
      spawnSync('bash', [script, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          DOCKER_ARGUMENTS: argumentsPath,
          DOCKER_EXIT: String(exit),
          PATH: `${directory}:${process.env['PATH'] ?? ''}`,
        },
        timeout: 5000,
      }),
  };
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('Docker diagnostic collection', () => {
  it('collects only approved services for snapshots, tailing, and streaming', () => {
    const { argumentsPath, run } = fixture();
    for (const args of [
      [],
      ['--tail=100'],
      ['--follow'],
      ['--follow', '--tail=0'],
    ]) {
      const result = run(args);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(readFileSync(argumentsPath, 'utf8').trim().split('\n')).toEqual([
        'compose',
        'logs',
        '--no-color',
        ...args,
        'db-setup',
        'mailpit',
        'minio',
        'minio-init',
        'worker',
        'evorto',
      ]);
    }
  });

  it('rejects service names and unsupported options before invoking Docker', () => {
    const { argumentsPath, run } = fixture();
    for (const args of [
      ['db'],
      ['stripe'],
      ['--tail=all'],
      ['--tail='],
      ['--help'],
    ]) {
      const result = run(args);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      expect(existsSync(argumentsPath)).toBe(false);
    }
  });

  it('preserves Docker output and failure status', () => {
    const { run } = fixture();
    const result = run([], 42);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(42);
    expect(result.stdout).toBe('diagnostic output');
    expect(result.stderr).toBe('diagnostic error');
  });
});
