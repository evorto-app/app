import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const playwrightCliPath = path.join(
  repositoryRoot,
  'node_modules/@playwright/test/cli.js',
);
const reporterPath = path.join(
  repositoryRoot,
  'tests/support/reporters/complete-playwright-run-reporter.ts',
);

const controlledTestCall = (
  control: 'fail' | 'skip',
  argumentsSource: string,
) => `${['test', control].join('.')}(${argumentsSource})`;

const fixtureSource = `
import { test } from '@playwright/test';

${controlledTestCall('skip', "'skipped fixture', () => undefined")};

test('expected failure fixture', () => {
  ${controlledTestCall('fail', '')};
  throw new Error('expected fixture failure');
});

test('retried fixture', ({}, testInfo) => {
  if (testInfo.retry === 0) {
    throw new Error('first attempt fixture failure');
  }
});
`;

const runFixture = (withCompletenessReporter: boolean) => {
  const fixtureDirectory = mkdtempSync(
    path.join(repositoryRoot, '.tmp-playwright-completeness-'),
  );
  const configPath = path.join(fixtureDirectory, 'playwright.config.mjs');
  const testPath = path.join(fixtureDirectory, 'fixture.spec.ts');
  const outputDirectory = path.join(fixtureDirectory, 'test-results');
  const reporters = withCompletenessReporter
    ? [['dot'], [reporterPath]]
    : [['dot']];

  try {
    writeFileSync(
      configPath,
      `export default {
  failOnFlakyTests: false,
  forbidOnly: true,
  outputDir: ${JSON.stringify(outputDirectory)},
  reporter: ${JSON.stringify(reporters)},
  retries: 1,
  testDir: ${JSON.stringify(fixtureDirectory)},
  testMatch: 'fixture.spec.ts',
  timeout: 5_000,
  workers: 1,
};\n`,
    );
    writeFileSync(testPath, fixtureSource);

    const result = spawnSync(
      process.execPath,
      [playwrightCliPath, 'test', '--config', configPath],
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

describe('complete Playwright run reporter', () => {
  it('forces otherwise-successful incomplete outcomes to fail the runner', () => {
    const unguarded = runFixture(false);
    const guarded = runFixture(true);

    expect(unguarded.status).toBe(0);
    expect(guarded.status).toBe(1);
    expect(guarded.output).toContain('Complete Playwright run required');
    expect(guarded.output).toContain(
      'skipped fixture (skipped, expected-skipped)',
    );
    expect(guarded.output).toContain(
      'expected failure fixture (expected-failed)',
    );
    expect(guarded.output).toContain('retried fixture (retry-1)');
  }, 30_000);
});
