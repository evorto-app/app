import {
  DEFAULT_E2E_NOW_ISO,
  DEFAULT_E2E_SEED_KEY,
} from '@shared/testing/deterministic-test-defaults';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const workflowPaths = readdirSync(
  path.join(repositoryRoot, '.github/workflows'),
)
  .filter((fileName) => fileName.endsWith('.yml'))
  .map((fileName) => `.github/workflows/${fileName}`);

const broadEnvironmentBlocks = (workflow: string): readonly string[] => {
  const lines = workflow.split('\n');
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    if (line !== 'env:' && line !== '    env:') {
      continue;
    }

    const indentation = line.length - line.trimStart().length;
    const block = [line];
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next];
      if (candidate === undefined) {
        continue;
      }
      const candidateIndentation =
        candidate.length - candidate.trimStart().length;
      if (candidate.trim() && candidateIndentation <= indentation) {
        break;
      }
      block.push(candidate);
    }
    blocks.push(block.join('\n'));
  }

  return blocks;
};

const actionStepBlocks = (workflow: string): readonly string[] => {
  const lines = workflow.split('\n');
  const stepStarts = lines.flatMap((line, index) =>
    line.startsWith('      - ') ? [index] : [],
  );

  return stepStarts.map((start, index) => {
    const end = stepStarts[index + 1] ?? lines.length;
    return lines.slice(start, end).join('\n');
  });
};

describe('CI quality source', () => {
  it('pins every external workflow action and keeps secrets out of broad env', () => {
    for (const sourcePath of workflowPaths) {
      const workflow = readSource(sourcePath);
      expect(workflow, sourcePath).toContain('permissions:');

      for (const line of workflow.split('\n')) {
        if (!line.includes('uses:')) {
          continue;
        }
        const match = line.match(
          /^\s*(?:-\s+)?uses:\s+(\S+?)(?:\s+#\s+(.+))?$/u,
        );
        expect(match, `${sourcePath}: ${line.trim()}`).not.toBeNull();
        const actionReference = match?.[1];
        if (!actionReference || actionReference.startsWith('./')) {
          continue;
        }

        const separator = actionReference.lastIndexOf('@');
        expect(separator, `${sourcePath}: ${actionReference}`).toBeGreaterThan(
          0,
        );
        expect(actionReference.slice(separator + 1)).toMatch(/^[a-f0-9]{40}$/u);
        expect(match?.[2]?.trim(), `${sourcePath}: ${actionReference}`).toMatch(
          /\S/u,
        );
      }

      for (const environmentBlock of broadEnvironmentBlocks(workflow)) {
        expect(environmentBlock, sourcePath).not.toContain('${{ secrets.');
      }
      for (const stepBlock of actionStepBlocks(workflow)) {
        if (!stepBlock.includes('uses:') || stepBlock.includes('uses: ./')) {
          continue;
        }
        expect(stepBlock, sourcePath).not.toContain('${{ secrets.');
      }
    }
  });

  it('starts Docker and Playwright with the same deterministic clock', () => {
    for (const sourcePath of [
      '.github/workflows/e2e-baseline.yml',
      '.github/workflows/esncard-release-certification.yml',
    ]) {
      const source = readSource(sourcePath);
      expect(source, sourcePath).toContain(
        `E2E_NOW_ISO: "${DEFAULT_E2E_NOW_ISO}"`,
      );
      expect(source, sourcePath).toContain(
        `E2E_SEED_KEY: ${DEFAULT_E2E_SEED_KEY}`,
      );
    }
  });

  it('enables the Playwright-only runtime mode only in E2E launch paths', () => {
    const composeSource = readSource('docker-compose.yml');
    const webserverSource = readSource('helpers/testing/docker-webserver.sh');
    const ciDockerStartSource = readSource(
      'helpers/testing/ci-start-docker-stack.sh',
    );

    expect(composeSource).toContain('E2E_RUNTIME_MODE:');
    expect(composeSource).not.toContain('E2E_RUNTIME_MODE: "playwright"');
    expect(webserverSource).toContain('export E2E_RUNTIME_MODE=playwright');
    expect(ciDockerStartSource).toContain('export E2E_RUNTIME_MODE=playwright');
    for (const sourcePath of [
      '.github/workflows/e2e-baseline.yml',
      '.github/workflows/esncard-release-certification.yml',
    ]) {
      expect(readSource(sourcePath), sourcePath).toContain(
        'E2E_RUNTIME_MODE: playwright',
      );
    }
  });

  it('uses a redirect-safe SSR application readiness endpoint', () => {
    const playwrightConfig = readSource('playwright.config.ts');
    const serverSource = readSource('src/server.ts');

    expect(playwrightConfig).toContain(
      "import { APPLICATION_READINESS_PATH } from '@server/http/application-readiness'",
    );
    expect(playwrightConfig).toContain(
      'new URL(\n    APPLICATION_READINESS_PATH,\n    environment.BASE_URL,\n  ).toString()',
    );
    expect(playwrightConfig).toContain('url: readinessUrl');
    expect(serverSource).toContain('applicationReadinessRouteLayer');
    expect(serverSource).toContain('createApplicationReadinessSsrRequest');
    expect(serverSource).toContain('createApplicationReadinessResponse');

    for (const sourcePath of [
      '.github/workflows/e2e-baseline.yml',
      '.github/workflows/esncard-release-certification.yml',
    ]) {
      const workflow = readSource(sourcePath);

      expect(workflow).toContain('APP_READY_PATH: /readyz');
      expect(workflow).toContain('--write-out \'%{http_code}\' "${ready_url}"');
      expect(workflow).toContain('if [ "${ready_status}" = "204" ]; then');
      expect(workflow).not.toContain('curl --fail --location');
      expect(workflow).not.toContain('APP_READY_PATH: /robots.txt');
    }
  });

  it('collects only the explicit non-secret Docker service log allowlist', () => {
    const sourcePaths = [
      '.github/workflows/e2e-baseline.yml',
      '.github/workflows/esncard-release-certification.yml',
      'helpers/testing/ci-start-docker-stack.sh',
    ];
    const dockerLogCommands = sourcePaths.flatMap((sourcePath) =>
      readSource(sourcePath)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('docker compose logs')),
    );

    expect(dockerLogCommands).toEqual([
      'docker compose logs --no-color --tail=100 db-expiration db-setup minio minio-init evorto',
      'docker compose logs --no-color --tail=100 db-expiration db-setup minio minio-init evorto',
      'docker compose logs -f --no-color db-expiration db-setup minio minio-init evorto 2>&1 | tee test-results/docker-logs/live-docker.log &',
      'docker compose logs --no-color db-expiration db-setup minio minio-init evorto > test-results/docker-logs/docker-compose.log || true',
      'node_modules/.bin/dotenv -c dev -- docker compose logs --no-color --tail=100 db-expiration db-setup minio minio-init evorto || true',
    ]);

    for (const command of dockerLogCommands) {
      expect(command).not.toMatch(/(?:^|\s)(?:db|stripe)(?=\s|$)/u);
    }
  });

  it('runs every deterministic generated-docs flow in baseline CI', () => {
    const source = readSource('.github/workflows/e2e-baseline.yml');

    expect(source).toContain('bunx playwright test --project=docs-baseline');
    expect(source).not.toMatch(/--grep-invert\s+["']?@finance/u);
  });

  it('avoids completeness-neutral Playwright and artifact overhead', () => {
    const playwrightConfig = readSource('playwright.config.ts');
    const baselineWorkflow = readSource('.github/workflows/e2e-baseline.yml');
    const copilotWorkflow = readSource(
      '.github/workflows/copilot-setup-steps.yml',
    );

    expect(playwrightConfig).toContain('retries: 0');
    expect(playwrightConfig).not.toContain('environment.CI ? 1 : 0');
    expect(baselineWorkflow).toContain(
      'bunx playwright install --with-deps chromium',
    );
    expect(copilotWorkflow).toContain(
      'bunx playwright install --with-deps chromium',
    );
    expect(copilotWorkflow).toContain('push:\n    branches: [main]');
    expect(baselineWorkflow).toContain('!test-results/docs/**');
  });

  it('does not retain or upload authenticated Playwright traces', () => {
    const baselineWorkflow = readSource('.github/workflows/e2e-baseline.yml');
    const cancellationDocumentation = readSource(
      'tests/docs/events/registration-cancellation.doc.ts',
    );

    expect(baselineWorkflow).toContain('bun run test:e2e -- --trace=off');
    expect(baselineWorkflow).toContain(
      'bunx playwright test --project=docs-baseline \\\n            --trace=off',
    );
    expect(baselineWorkflow).toContain('!test-results/**/trace.zip');
    expect(baselineWorkflow).toContain('!test-results/docs/**/trace.zip');
    expect(baselineWorkflow).not.toContain('playwright-report/**');
    expect(cancellationDocumentation).toContain("test.use({ trace: 'off' })");
    expect(cancellationDocumentation).not.toContain(
      "trace: 'retain-on-failure'",
    );
  });

  it('keeps repository-owned pull request quality gates complete', () => {
    const source = readSource('.github/workflows/pr-quality.yml');
    const packageJson = JSON.parse(readSource('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(source).toContain('pull_request:');
    expect(source).toContain('name: Knope and change files');
    expect(source).toContain('run: knope --validate');
    expect(source).toContain('name: Lint, unit tests, and build');
    expect(packageJson.scripts?.['format:check']).toBe('prettier --check .');
    expect(source).toContain('run: bun run format:check');
    expect(source).toContain('bun run lint');
    expect(source).toContain('git diff --exit-code');
    expect(source).toContain('bun run test:unit:server');
    expect(source).toContain('name: PostgreSQL integration tests');
    expect(source).toContain('postgres:17.10-alpine3.23@sha256:');
    expect(source).toContain('POSTGRES_INTEGRATION_DISPOSABLE: "true"');
    expect(source).toContain('bun run test:integration:postgres');
    expect(source).toMatch(/run: bun run test:unit\n/u);
    expect(source).toContain('bun run build:app');
  });

  it('lints repository-owned tooling without traversing vendored sources', () => {
    const workspace = JSON.parse(readSource('angular.json')) as {
      projects?: {
        evorto?: {
          architect?: {
            lint?: {
              options?: { lintFilePatterns?: string[] };
            };
          };
        };
      };
    };
    const eslintConfig = readSource('eslint.config.mjs');
    const lintFilePatterns =
      workspace.projects?.evorto?.architect?.lint?.options?.lintFilePatterns ??
      [];

    expect(lintFilePatterns).toEqual([
      '*.config.ts',
      'helpers/**/*.ts',
      'migration/**/*.ts',
      'src/**/*.ts',
      'src/**/*.html',
      'tests/**/*.ts',
    ]);
    expect(lintFilePatterns).not.toContain('repos/**/*.ts');
    expect(eslintConfig).toContain('const toolingFiles = [');
    for (const sourcePattern of [
      '"*.config.ts"',
      '"helpers/**/*.ts"',
      '"migration/**/*.ts"',
    ]) {
      expect(eslintConfig).toContain(sourcePattern);
    }
    expect(eslintConfig).toContain('...tseslint.configs.strict');
    expect(eslintConfig).toContain('process: "readonly"');
    expect(eslintConfig).toContain('files: ["migration/**/*.ts"]');
    expect(eslintConfig).toContain('ignores: ["repos/**/*"]');
  });

  it('retries frozen dependency installs in required pull request workflows', () => {
    for (const sourcePath of [
      '.github/workflows/e2e-baseline.yml',
      '.github/workflows/pr-quality.yml',
    ]) {
      const source = readSource(sourcePath);

      expect(source).toContain('for attempt in 1 2 3; do');
      expect(source).toContain('if bun install --frozen-lockfile; then');
      expect(source).toContain('sleep "${retry_delay_seconds}"');
    }
  });
});
