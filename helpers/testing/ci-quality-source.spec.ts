import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_E2E_NOW_ISO,
  DEFAULT_E2E_SEED_KEY,
} from '@shared/testing/deterministic-test-defaults';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

describe('CI quality source', () => {
  it('starts Docker and Playwright with the same deterministic clock', () => {
    const source = readSource('.github/workflows/e2e-baseline.yml');

    expect(source).toContain(`E2E_NOW_ISO: "${DEFAULT_E2E_NOW_ISO}"`);
    expect(source).toContain(`E2E_SEED_KEY: ${DEFAULT_E2E_SEED_KEY}`);
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

  it('keeps repository-owned pull request quality gates complete', () => {
    const source = readSource('.github/workflows/pr-quality.yml');

    expect(source).toContain('pull_request:');
    expect(source).toContain('name: Knope and change files');
    expect(source).toContain('run: knope --validate');
    expect(source).toContain('name: Lint, unit tests, and build');
    expect(source).toContain('bun run lint');
    expect(source).toContain('git diff --exit-code');
    expect(source).toContain('bun run test:unit:server');
    expect(source).toMatch(/run: bun run test:unit\n/u);
    expect(source).toContain('bun run build:app');
  });
});
