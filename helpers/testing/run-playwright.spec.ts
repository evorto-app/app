import type { spawnSync } from 'node:child_process';

import { describe, expect, it } from '@effect/vitest';

import { localDocumentationEnvironment, runPlaywright } from './run-playwright';

interface SpawnCall {
  args: readonly string[];
  command: string;
  options: Parameters<typeof spawnSync>[2];
}

const createSpawn = (calls: SpawnCall[], status = 0): typeof spawnSync =>
  ((command, arguments_, options) => {
    calls.push({
      args: arguments_ ?? [],
      command,
      options,
    });

    return {
      output: [],
      pid: 1,
      signal: null,
      status,
      stderr: Buffer.from(''),
      stdout: Buffer.from(''),
    };
  }) as typeof spawnSync;

describe('runPlaywright', () => {
  it('runs Playwright through dotenv with local generated-doc output paths', () => {
    const calls: SpawnCall[] = [];
    const status = runPlaywright({
      argv: ['tests/specs/smoke/page-layout-helper.test.ts', '--no-deps'],
      env: {
        DOCS_OUT_DIR: '/outside/docs',
        EXISTING: 'kept',
      },
      spawn: createSpawn(calls),
    });

    expect(status).toBe(0);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({
      args: ['run', 'env:copy-main', '--', '--if-missing'],
      command: 'bun',
      options: {
        env: {
          DOCS_OUT_DIR: '/outside/docs',
          EXISTING: 'kept',
        },
        stdio: 'inherit',
      },
    });
    expect(calls[1]).toEqual({
      args: ['run', 'env:runtime'],
      command: 'bun',
      options: {
        env: {
          DOCS_OUT_DIR: '/outside/docs',
          EXISTING: 'kept',
        },
        stdio: 'inherit',
      },
    });
    expect(calls[2].command).toBe('node_modules/.bin/dotenv');
    expect(calls[2].args).toEqual([
      '-c',
      'dev',
      '--',
      'node_modules/.bin/playwright',
      'test',
      'tests/specs/smoke/page-layout-helper.test.ts',
      '--no-deps',
    ]);
    expect(calls[2].options).toEqual({
      env: {
        DOCS_IMG_OUT_DIR: localDocumentationEnvironment.DOCS_IMG_OUT_DIR,
        DOCS_OUT_DIR: localDocumentationEnvironment.DOCS_OUT_DIR,
        EXISTING: 'kept',
      },
      stdio: 'inherit',
    });
  });

  it('does not refresh runtime environment when the guarded .env copy fails', () => {
    const calls: SpawnCall[] = [];
    const status = runPlaywright({
      argv: ['--list'],
      env: {},
      spawn: createSpawn(calls, 1),
    });

    expect(status).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      args: ['run', 'env:copy-main', '--', '--if-missing'],
      command: 'bun',
    });
  });

  it('does not run Playwright when the runtime environment refresh fails', () => {
    const calls: SpawnCall[] = [];
    const createRuntimeFailureSpawn = (): typeof spawnSync =>
      ((command, arguments_, options) => {
        calls.push({
          args: arguments_ ?? [],
          command,
          options,
        });

        return {
          output: [],
          pid: 1,
          signal: null,
          status: calls.length === 2 ? 1 : 0,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        };
      }) as typeof spawnSync;
    const status = runPlaywright({
      argv: ['--list'],
      env: {},
      spawn: createRuntimeFailureSpawn(),
    });

    expect(status).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      args: ['run', 'env:runtime'],
      command: 'bun',
    });
  });

  it('maps the helper no-webserver flag to the Playwright environment', () => {
    const calls: SpawnCall[] = [];

    runPlaywright({
      argv: [
        '--no-webserver',
        'tests/setup/mcp-browser.seed.ts',
        '--project=mcp-browser-planner',
      ],
      env: {},
      spawn: createSpawn(calls),
    });

    expect(calls[2].args).toEqual([
      '-c',
      'dev',
      '--',
      'node_modules/.bin/playwright',
      'test',
      'tests/setup/mcp-browser.seed.ts',
      '--project=mcp-browser-planner',
    ]);
    expect(calls[2].options?.env).toMatchObject({
      NO_WEBSERVER: 'true',
    });
  });

  it('returns the Playwright process status', () => {
    const calls: SpawnCall[] = [];
    const createStatusSpawn = (): typeof spawnSync =>
      ((command, arguments_, options) => {
        calls.push({
          args: arguments_ ?? [],
          command,
          options,
        });

        return {
          output: [],
          pid: 1,
          signal: null,
          status: calls.length === 3 ? 1 : 0,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        };
      }) as typeof spawnSync;
    const status = runPlaywright({
      argv: ['--list'],
      env: {},
      spawn: createStatusSpawn(),
    });

    expect(status).toBe(1);
    expect(calls).toHaveLength(3);
  });
});
