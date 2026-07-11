import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  incompleteVitestRunReason,
  incompleteVitestTestReasons,
} from './complete-vitest-run-reporter';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const reporterPath = path.join(
  repositoryRoot,
  'helpers/testing/complete-vitest-run-reporter.ts',
);
const vitestCliPath = path.join(
  repositoryRoot,
  'node_modules/vitest/vitest.mjs',
);

const controlledTestCall = (
  control: 'fails' | 'only' | 'skip' | 'todo',
  name: string,
  body = '() => undefined',
) => `${['test', control].join('.')}(${JSON.stringify(name)}, ${body});`;

const runReporterFixture = (
  testSource: string,
  options: Readonly<{ allowOnly?: boolean }> = {},
) => {
  const fixtureDirectory = mkdtempSync(
    path.join(repositoryRoot, '.tmp-vitest-completeness-'),
  );
  const fixtureRelativeDirectory = path.relative(
    repositoryRoot,
    fixtureDirectory,
  );
  const configPath = path.join(fixtureDirectory, 'vitest.config.mjs');
  const testPath = path.join(fixtureDirectory, 'fixture.spec.ts');

  try {
    writeFileSync(
      configPath,
      `export default {
  root: ${JSON.stringify(repositoryRoot)},
  test: {
    allowOnly: ${options.allowOnly ?? false},
    include: [${JSON.stringify(`${fixtureRelativeDirectory}/fixture.spec.ts`)}],
    reporters: ['dot', ${JSON.stringify(reporterPath)}],
  },
};\n`,
    );
    writeFileSync(testPath, testSource);

    const result = spawnSync(
      process.execPath,
      [vitestCliPath, 'run', '--config', configPath],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
        timeout: 30_000,
      },
    );

    if (result.error !== undefined) {
      throw result.error;
    }

    return {
      output: `${result.stdout}${result.stderr}`,
      status: result.status,
    };
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
};

describe('complete Vitest run reporter', () => {
  it('classifies every incomplete per-test outcome', () => {
    expect(
      incompleteVitestTestReasons({
        expectedFailure: false,
        flaky: false,
        mode: 'skip',
        retryCount: 0,
        state: 'skipped',
      }),
    ).toEqual(['skipped:skip']);
    expect(
      incompleteVitestTestReasons({
        expectedFailure: false,
        flaky: false,
        mode: 'todo',
        retryCount: 0,
        state: 'skipped',
      }),
    ).toEqual(['skipped:todo']);
    expect(
      incompleteVitestTestReasons({
        expectedFailure: true,
        flaky: false,
        mode: 'run',
        retryCount: 0,
        state: 'passed',
      }),
    ).toEqual(['expected-failure']);
    expect(
      incompleteVitestTestReasons({
        expectedFailure: false,
        flaky: true,
        mode: 'run',
        retryCount: 1,
        state: 'passed',
      }),
    ).toEqual(['flaky-after-1-retries']);
    expect(
      incompleteVitestTestReasons({
        expectedFailure: false,
        flaky: false,
        mode: 'only',
        retryCount: 0,
        state: 'passed',
      }),
    ).toEqual(['focused-only']);
  });

  it('treats an interrupted run as incomplete', () => {
    expect(incompleteVitestRunReason('interrupted')).toBe(
      'test run (interrupted)',
    );
    expect(incompleteVitestRunReason('passed')).toBeUndefined();
    expect(incompleteVitestRunReason('failed')).toBeUndefined();
  });

  it('forces skip, todo, expected-failure, and flaky fixtures to fail', () => {
    const result = runReporterFixture(`
import { expect, test } from 'vitest';

${controlledTestCall('skip', 'skipped fixture')}
${controlledTestCall('todo', 'todo fixture')}
${controlledTestCall('fails', 'expected failure fixture', "() => { throw new Error('expected'); }")}
let attempts = 0;
test('flaky fixture', { retry: 1 }, () => {
  attempts += 1;
  expect(attempts).toBe(2);
});
`);

    expect(result.status).toBe(1);
    expect(result.output).toContain('Complete Vitest run required');
    expect(result.output).toContain('skipped:skip');
    expect(result.output).toContain('skipped:todo');
    expect(result.output).toContain('expected-failure');
    expect(result.output).toContain('flaky-after-1-retries');
  });

  it('forces an otherwise-passing focused fixture to fail', () => {
    const result = runReporterFixture(
      `
import { test } from 'vitest';

${controlledTestCall('only', 'focused fixture')}
`,
      { allowOnly: true },
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain('Complete Vitest run required');
    expect(result.output).toContain(
      'focused tests are allowed by project configuration',
    );
  });
});
