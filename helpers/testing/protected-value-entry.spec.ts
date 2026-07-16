import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolvePlaywrightProjectPolicy } from '../../tests/support/config/playwright-project-policy';
import {
  completePlaywrightRunReporterPath,
  documentationReporterPath,
  protectedValueSanitizerReporterPath,
  resolvePlaywrightReporters,
  resolveProtectedValueSanitizerState,
} from '../../tests/support/config/protected-value-reporters';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const playwrightCliPath = path.join(
  repositoryRoot,
  'node_modules/@playwright/test/cli.js',
);
const fillProtectedValuePath = path.join(
  repositoryRoot,
  'tests/support/utils/fill-protected-value.ts',
);
const protectedValueSanitizerReporterFixturePath = path.join(
  repositoryRoot,
  'tests/support/reporters/protected-value-sanitizer-reporter.ts',
);
const protectedInputSentinel = `SENTINEL-${randomUUID()}`;
const safeFailureDetails =
  'Protected input failure reproduced with value-free diagnostics.';
const protectedInputArtifactError =
  'Protected input requires Playwright trace, screenshot, video, HAR, and context video capture to be off and protected-value artifact sanitization to be enabled';
const protectedInputTestFiles = [
  'tests/setup/authentication.setup.ts',
  'tests/docs/profile/discounts.doc.ts',
  'tests/docs/users/create-account.doc.ts',
  'tests/specs/profile/create-account.spec.ts',
  'tests/specs/profile/user-profile-live-esncard.spec.ts',
];

const findFiles = (directory: string): string[] => {
  if (!statSync(directory, { throwIfNoEntry: false })) return [];

  return readdirSync(directory).flatMap((entry) => {
    const entryPath = path.join(directory, entry);
    return statSync(entryPath).isDirectory() ? findFiles(entryPath) : entryPath;
  });
};

const fileContainsValue = (filePath: string, value: string): boolean => {
  const needle = Buffer.from(value);
  if (!filePath.endsWith('.zip')) {
    return readFileSync(filePath).includes(needle);
  }

  const extracted = spawnSync('unzip', ['-p', filePath], {
    maxBuffer: 50 * 1024 * 1024,
  });
  if (extracted.error !== undefined) throw extracted.error;
  if (extracted.status !== 0) {
    throw new Error(`Unable to inspect Playwright trace ${filePath}`);
  }
  return Buffer.isBuffer(extracted.stdout) && extracted.stdout.includes(needle);
};

const runProtectedInputFixture = (options: {
  forceAttachmentInspectionFailure?: boolean;
  forceFailure?: boolean;
  traceOverride?: boolean;
}) => {
  const fixtureDirectory = mkdtempSync(
    path.join(repositoryRoot, '.tmp-playwright-protected-input-'),
  );
  const configPath = path.join(fixtureDirectory, 'playwright.config.mjs');
  const testPath = path.join(fixtureDirectory, 'fixture.spec.ts');
  const outputDirectory = path.join(fixtureDirectory, 'test-results');
  const helperImport = `../${path
    .relative(repositoryRoot, fillProtectedValuePath)
    .split(path.sep)
    .join('/')}`;

  try {
    writeFileSync(
      configPath,
      `process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
process.env.PLAYWRIGHT_PROTECTED_VALUE_SANITIZER = '1';

export default {
  expect: { timeout: 250 },
  forbidOnly: true,
  outputDir: ${JSON.stringify(outputDirectory)},
  quiet: true,
  reporter: [[${JSON.stringify(protectedValueSanitizerReporterFixturePath)}], ['dot']],
  retries: 0,
  testDir: ${JSON.stringify(fixtureDirectory)},
  testMatch: 'fixture.spec.ts',
  timeout: 10_000,
  use: {
    browserName: 'chromium',
    headless: true,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  workers: 1,
};
`,
    );
    writeFileSync(
      testPath,
      `import { rmSync, writeFileSync } from 'node:fs';
import { expect, test as base } from '@playwright/test';
import { fillProtectedValue, withProtectedValueCaptureOptions } from ${JSON.stringify(helperImport)};

const test = base.extend<{ protectedValueCapturePolicy: void }>({
  protectedValueCapturePolicy: [
    async ({ contextOptions, screenshot, trace, video }, use) => {
      await withProtectedValueCaptureOptions(
        { contextOptions, screenshot, trace, video },
        () => use(),
      );
    },
    { auto: true },
  ],
});

test('enters a protected value without exposing it', async ({ page }, testInfo) => {
  const value = process.env['PROTECTED_INPUT_SENTINEL'];
  if (!value) throw new Error('Missing protected-input sentinel');

  await page.setContent(\`
    <label for="protected">Password</label>
    <input id="protected" type="password" />
    <p id="rendered-value"></p>
    <script>
      const input = document.querySelector('#protected');
      for (const type of ['input', 'change']) {
        input.addEventListener(type, () => {
          const events = document.body.dataset.events;
          document.body.dataset.events = events ? events + ',' + type : type;
        });
      }
    </script>
  \`);

  const input = page.locator('#protected');
  try {
    await fillProtectedValue(input, 'PROTECTED_INPUT_SENTINEL');
  } catch (error) {
    await expect(input).toHaveValue('');
    expect(await page.locator('body').getAttribute('data-events')).toBeNull();
    throw error;
  }

  const state = await input.evaluate((element) => ({
    eventTypes: document.body.dataset.events?.split(',') ?? [],
    focused: document.activeElement === element,
    hasValue: element.value.length > 0,
  }));
  expect(state).toEqual({
    eventTypes: ['input', 'change'],
    focused: true,
    hasValue: true,
  });

  console.log('redacted stdout fixture:', value);
  console.error('redacted stderr fixture:', value);

  if (process.env['FORCE_ATTACHMENT_INSPECTION_FAILURE'] === '1') {
    const diagnosticPath = testInfo.outputPath('removed-before-reporting.txt');
    writeFileSync(diagnosticPath, 'safe attachment contents');
    await testInfo.attach('removed-before-reporting', {
      contentType: 'text/plain',
      path: diagnosticPath,
    });
    const copiedAttachmentPath = testInfo.attachments.at(-1)?.path;
    if (!copiedAttachmentPath) {
      throw new Error('Expected Playwright to register the copied attachment');
    }
    rmSync(copiedAttachmentPath);
  }

  if (process.env['FORCE_PROTECTED_INPUT_FAILURE'] === '1') {
    const diagnosticPath = testInfo.outputPath('safe-failure-details.txt');
    writeFileSync(diagnosticPath, ${JSON.stringify(safeFailureDetails)});
    await testInfo.attach('safe-failure-details', {
      contentType: 'text/plain',
      path: diagnosticPath,
    });
    await input.evaluate((element) => {
      const renderedValue = document.querySelector('#rendered-value');
      if (renderedValue) renderedValue.textContent = element.value;
    });
    await expect(
      page.getByRole('heading', { name: 'Forced protected input failure' }),
    ).toBeVisible();
  }
});
`,
    );

    const result = spawnSync(
      process.execPath,
      [
        playwrightCliPath,
        'test',
        '--config',
        configPath,
        ...(options.traceOverride ? ['--trace=on'] : []),
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          FORCE_ATTACHMENT_INSPECTION_FAILURE:
            options.forceAttachmentInspectionFailure ? '1' : '0',
          FORCE_PROTECTED_INPUT_FAILURE: options.forceFailure ? '1' : '0',
          PROTECTED_INPUT_SENTINEL: protectedInputSentinel,
        },
        timeout: 45_000,
      },
    );
    if (result.error !== undefined) throw result.error;

    const artifactFiles = findFiles(outputDirectory);
    const errorContextFiles = artifactFiles.filter(
      (filePath) => path.basename(filePath) === 'error-context.md',
    );
    const safeFailureArtifacts = artifactFiles.filter(
      (filePath) => path.basename(filePath) === 'safe-failure-details.txt',
    );
    return {
      artifactContainsSentinel: artifactFiles.some((filePath) =>
        fileContainsValue(filePath, protectedInputSentinel),
      ),
      errorContextContents: errorContextFiles.map((filePath) =>
        readFileSync(filePath, 'utf8'),
      ),
      output: `${result.stdout}${result.stderr}`,
      safeFailureArtifactContents: safeFailureArtifacts.map((filePath) =>
        readFileSync(filePath, 'utf8'),
      ),
      status: result.status,
      traceFileCount: artifactFiles.filter((filePath) =>
        filePath.endsWith('trace.zip'),
      ).length,
    };
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
};

describe('protected Playwright value entry', () => {
  it('uses native form events without exposing the value', () => {
    for (const filePath of protectedInputTestFiles) {
      const source = readFileSync(path.join(repositoryRoot, filePath), 'utf8');
      expect(source).toContain('fillProtectedValue');
    }

    const result = runProtectedInputFixture({});

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      'redacted stdout fixture: [protected value]',
    );
    expect(result.output).toContain(
      'redacted stderr fixture: [protected value]',
    );
    expect(result.output).not.toContain(protectedInputSentinel);
    expect(result.artifactContainsSentinel).toBe(false);
  }, 45_000);

  it('fails closed when an attachment cannot be inspected', () => {
    const result = runProtectedInputFixture({
      forceAttachmentInspectionFailure: true,
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      'Protected-value attachment sanitization failed closed for 1 attachment(s).',
    );
    expect(result.output).not.toContain(protectedInputSentinel);
    expect(result.artifactContainsSentinel).toBe(false);
  }, 45_000);

  it('fails before entry when a CLI override enables tracing', () => {
    const result = runProtectedInputFixture({ traceOverride: true });

    expect(result.status).toBe(1);
    expect(result.output).toContain(protectedInputArtifactError);
    expect(result.output).not.toContain(protectedInputSentinel);
    expect(result.traceFileCount).toBeGreaterThan(0);
    expect(result.artifactContainsSentinel).toBe(false);
  }, 45_000);

  it('keeps protected values out of artifacts after a forced failure', () => {
    const result = runProtectedInputFixture({ forceFailure: true });

    expect(result.status).toBe(1);
    expect(result.output).toContain('Forced protected input failure');
    expect(result.output).not.toContain(protectedInputSentinel);
    expect(result.errorContextContents).toHaveLength(0);
    expect(result.artifactContainsSentinel).toBe(false);
    expect(result.safeFailureArtifactContents).toContain(safeFailureDetails);
  }, 45_000);

  it('runs the sanitizer before every built-in reporter set', () => {
    const ciReporters = resolvePlaywrightReporters({
      ci: true,
      listOnly: false,
    });
    const listReporters = resolvePlaywrightReporters({
      ci: false,
      listOnly: true,
    });
    const localReporters = resolvePlaywrightReporters({
      ci: false,
      listOnly: false,
    });

    expect(ciReporters).toEqual([
      [protectedValueSanitizerReporterPath],
      ['github'],
      ['dot'],
      [completePlaywrightRunReporterPath],
    ]);
    expect(listReporters).toEqual([
      [protectedValueSanitizerReporterPath],
      ['dot'],
      [completePlaywrightRunReporterPath],
    ]);
    expect(localReporters).toEqual([
      [protectedValueSanitizerReporterPath],
      ['dot'],
      [documentationReporterPath],
      [completePlaywrightRunReporterPath],
    ]);
    for (const reporters of [ciReporters, listReporters, localReporters]) {
      expect(reporters[0]).toEqual([protectedValueSanitizerReporterPath]);
    }
  });

  it('only enables protected input when every reporter sink is approved', () => {
    const resolve = (
      argv: readonly string[],
      environmentOverride?: string,
      currentState?: string,
    ) =>
      resolveProtectedValueSanitizerState({
        argv,
        currentState,
        environmentOverride,
      });

    expect(
      resolve([`--reporter=${protectedValueSanitizerReporterPath},dot`]),
    ).toBe('1');
    expect(
      resolve([`--reporter=dot,${protectedValueSanitizerReporterPath}`]),
    ).toBe('0');
    expect(
      resolve([
        `--reporter=${protectedValueSanitizerReporterPath},dot`,
        '--reporter=github',
      ]),
    ).toBe('0');
    expect(
      resolve([
        '--reporter=blob',
        '--',
        `--reporter=${protectedValueSanitizerReporterPath},dot`,
      ]),
    ).toBe('0');
    for (const option of ['--grep', '--output']) {
      expect(
        resolve([
          '--reporter=blob',
          option,
          `--reporter=${protectedValueSanitizerReporterPath},dot`,
        ]),
      ).toBe('0');
    }
    expect(
      resolve(
        ['--reporter', `${protectedValueSanitizerReporterPath},github`],
        'dot',
      ),
    ).toBe('1');
    expect(
      resolve(
        [`--reporter=${protectedValueSanitizerReporterPath},dot`],
        'blob',
      ),
    ).toBe('0');
    expect(resolve([], 'github')).toBe('1');
    expect(resolve([], undefined, '0')).toBe('0');
    expect(resolve([], undefined, '1')).toBe('1');
  });

  it('selects database-only dependencies for trace-off baseline UI mode', () => {
    const packageJson: unknown = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
    );
    if (
      !packageJson ||
      typeof packageJson !== 'object' ||
      !('scripts' in packageJson) ||
      !packageJson.scripts ||
      typeof packageJson.scripts !== 'object'
    ) {
      throw new Error('Expected package scripts');
    }
    const uiScript = packageJson.scripts['test:e2e:ui'];
    if (typeof uiScript !== 'string') {
      throw new Error('Expected the test:e2e:ui package script');
    }

    expect(uiScript).toContain('playwright test --project=setup --trace=off');
    expect(uiScript).toContain('PLAYWRIGHT_SAFE_UI_BASELINE=1');
    expect(uiScript.indexOf('--project=setup')).toBeLessThan(
      uiScript.lastIndexOf('playwright test --ui'),
    );
    expect(resolvePlaywrightProjectPolicy(true)).toEqual({
      includeAuthenticatedProjects: false,
      modeDependencies: ['database-setup'],
    });
    expect(resolvePlaywrightProjectPolicy(false)).toEqual({
      includeAuthenticatedProjects: true,
      modeDependencies: ['setup'],
    });
  });
});
