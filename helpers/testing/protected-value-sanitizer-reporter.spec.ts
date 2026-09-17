import type { TestError, TestResult } from '@playwright/test/reporter';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ProtectedValueSanitizerReporter, {
  redactProtectedValues,
} from '../../tests/support/reporters/protected-value-sanitizer-reporter';

const requestFailure = [
  'route.fetch: Request context disposed.',
  'Call log:',
  '  - GET http://localhost:4200/rpc',
  '    - Cookie: session=cookie-sentinel',
  '    - sEt-CoOkIe: session=response-sentinel; HttpOnly',
  '    - AUTHORIZATION: Bearer authorization-sentinel',
  '    - proxy-authorization: Basic proxy-sentinel',
  '    - accept: application/json',
  'at tenant-request-routing.ts:26:34',
].join('\n');
const formattedRequestFailure = requestFailure
  .split('\n')
  .map((line) => `\u001b[2m${line}\u001b[22m`)
  .join('\n');
const headerSentinels = [
  'cookie-sentinel',
  'response-sentinel',
  'authorization-sentinel',
  'proxy-sentinel',
];

const expectSafeDiagnostics = (value: string) => {
  for (const sentinel of headerSentinels) expect(value).not.toContain(sentinel);
  expect(value).toContain('route.fetch: Request context disposed.');
  expect(value).toContain('GET http://localhost:4200/rpc');
  expect(value).toContain('accept: application/json');
  expect(value).toContain('at tenant-request-routing.ts:26:34');
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('protected request diagnostics', () => {
  it('redacts credential headers without needing their values in an environment inventory', () => {
    expectSafeDiagnostics(redactProtectedValues(requestFailure, []));
    expect(redactProtectedValues('ordinary failure\nstack line', [])).toBe(
      'ordinary failure\nstack line',
    );
    expect(redactProtectedValues('known password', ['password'])).toBe(
      'known [protected value]',
    );
  });

  it('recognizes headers through the per-line ANSI formatting used by Playwright call logs', () => {
    expectSafeDiagnostics(redactProtectedValues(formattedRequestFailure, []));
  });

  it('sanitizes every error field and nested cause before another reporter observes it', () => {
    const nested: TestError = {
      message: requestFailure,
      stack: requestFailure,
      snippet: requestFailure,
      value: requestFailure,
    };
    const error: TestError = {
      message: requestFailure,
      stack: requestFailure,
      snippet: requestFailure,
      value: requestFailure,
      cause: nested,
    };
    new ProtectedValueSanitizerReporter().onError(error);
    for (const item of [error, nested]) {
      for (const key of ['message', 'stack', 'snippet', 'value'] as const)
        expectSafeDiagnostics(item[key] ?? '');
    }
  });

  it.each(['stdout', 'stderr'] as const)(
    'redacts split %s header lines and flushes ordinary unterminated diagnostics',
    async (stream) => {
      const chunks: string[] = [];
      vi.spyOn(process[stream], 'write').mockImplementation((chunk) => {
        chunks.push(String(chunk));
        return true;
      });
      const reporter = new ProtectedValueSanitizerReporter();
      const write = (chunk: string | Buffer) =>
        stream === 'stdout'
          ? reporter.onStdOut(chunk)
          : reporter.onStdErr(chunk);
      const text = `${requestFailure}\nnormal final diagnostic`;
      for (let index = 0; index < text.length; index += 3)
        write(Buffer.from(text.slice(index, index + 3)));
      expect(chunks.join('')).not.toContain('normal final diagnostic');
      await reporter.onEnd();
      expectSafeDiagnostics(chunks.join(''));
      expect(chunks.join('')).toContain('normal final diagnostic');
    },
  );

  it('sanitizes captured output chunks and text attachments without hiding safe attachments or test failures', () => {
    vi.stubEnv('PROTECTED_INPUT_SENTINEL', 'fake-protected-osc-target');
    const protectedLink =
      '\u001b]8;;https://example.invalid/fake-protected-osc-target\u0007ordinary link\u001b]8;;\u0007';
    const reporter = new ProtectedValueSanitizerReporter();
    const result: TestResult = {
      annotations: [],
      attachments: [
        {
          name: 'request log',
          contentType: 'text/plain',
          body: Buffer.from(requestFailure),
        },
        {
          name: 'safe log',
          contentType: 'text/plain',
          body: Buffer.from('normal diagnostic'),
        },
        {
          name: 'formatted safe attachment',
          contentType: 'application/octet-stream',
          body: Buffer.from('\u001b[2mordinary attachment\u001b[22m'),
        },
        {
          name: 'protected control-sequence binary',
          contentType: 'application/octet-stream',
          body: Buffer.from(protectedLink),
        },
        {
          name: 'protected control-sequence text',
          contentType: 'text/plain',
          body: Buffer.from(protectedLink),
        },
      ],
      duration: 1,
      errors: [{ message: requestFailure }],
      parallelIndex: 0,
      retry: 0,
      startTime: new Date(0),
      status: 'failed',
      stderr: [
        requestFailure.slice(0, 97),
        Buffer.from(requestFailure.slice(97)),
      ],
      stdout: [
        requestFailure.slice(0, 103),
        Buffer.from(requestFailure.slice(103)),
      ],
      steps: [],
      workerIndex: 0,
    };
    reporter.onTestEnd(undefined, result);
    expectSafeDiagnostics(result.errors[0]?.message ?? '');
    expectSafeDiagnostics(result.stdout.join(''));
    expectSafeDiagnostics(result.stderr.join(''));
    expectSafeDiagnostics(result.attachments[0]?.body?.toString() ?? '');
    expect(result.attachments[1]?.body?.toString()).toBe('normal diagnostic');
    expect(result.attachments[2]?.body?.toString()).toBe(
      '\u001b[2mordinary attachment\u001b[22m',
    );
    expect(result.attachments).toHaveLength(4);
    expect(result.attachments[3]?.body?.toString()).toBe('ordinary link');
    expect(result.status).toBe('failed');
  });
});

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const runFinalErrorFixture = (color: '0' | '1') => {
  const directory = mkdtempSync(
    path.join(repositoryRoot, '.tmp-playwright-protected-errors-'),
  );
  try {
    const configPath = path.join(directory, 'playwright.config.mjs');
    writeFileSync(
      configPath,
      `export default ${JSON.stringify({
        outputDir: path.join(directory, 'results'),
        quiet: true,
        reporter: [
          [
            path.join(
              repositoryRoot,
              'tests/support/reporters/protected-value-sanitizer-reporter.ts',
            ),
          ],
          ['dot'],
        ],
        retries: 0,
        testDir: directory,
        testMatch: 'fixture.spec.ts',
        timeout: 5_000,
        workers: 1,
      })};\n`,
    );
    // Keep fake header values outside the failure snippet so this exercises
    // request diagnostics, not deliberate literal credentials in source code.
    writeFileSync(
      path.join(directory, 'diagnostics.ts'),
      `export const plain = ${JSON.stringify(requestFailure)};\n` +
        `export const formatted = ${JSON.stringify(formattedRequestFailure)};\n`,
    );
    writeFileSync(
      path.join(directory, 'fixture.spec.ts'),
      `import { test } from '@playwright/test';
import { plain, formatted } from './diagnostics';
test('plain request failure', () => { throw new Error(plain); });
test('formatted request failure', () => { throw new Error(formatted); });
test('nested cause failure', () => {
  throw new Error('context cleanup failed', { cause: new Error(formatted) });
});
test('aggregate cleanup failure', () => {
  throw new AggregateError([
    new Error(formatted),
    new AggregateError([new Error(formatted)], 'nested routing cleanup failed'),
  ], 'routing cleanup failed');
});
`,
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(repositoryRoot, 'node_modules/@playwright/test/cli.js'),
        'test',
        '--config',
        configPath,
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        // Synthetic headers deliberately have no environment inventory entry.
        env: { PATH: process.env['PATH'], FORCE_COLOR: color },
        timeout: 30_000,
      },
    );
    if (result.error) throw result.error;
    return {
      output: `${result.stdout}${result.stderr}`,
      status: result.status,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

describe('final Playwright failure output', () => {
  it.each(['0', '1'] as const)(
    'redacts formatted headers in final and aggregate errors with FORCE_COLOR=%s',
    (color) => {
      const result = runFinalErrorFixture(color);
      expect(result.status).toBe(1);
      expect(result.output).toContain('4 failed');
      expectSafeDiagnostics(result.output);
      expect(result.output).toContain('context cleanup failed');
      expect(result.output).toContain('AggregateError: routing cleanup failed');
      expect(result.output).toContain(
        'AggregateError: nested routing cleanup failed',
      );
      expect(result.output.match(/\[protected header\]/g)?.length).toBe(20);
    },
    30_000,
  );
});
