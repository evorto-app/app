import { describe, expect, it } from '@effect/vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  evaluateRuntimePreflight,
  optionalByTarget,
  requiredByTarget,
} from './runtime-preflight';

// Keeps Docker preflight failures readable by pinning the checks operators see
// before the stack starts rebuilding containers or touching local data.
const requiredDockerEnvironment = Object.fromEntries(
  requiredByTarget.docker.map(({ name }) => [
    name,
    `${name.toLowerCase()}-value`,
  ]),
);

const successfulCommand = (
  command: string,
  commandArguments: readonly string[],
) => {
  const joined = [command, ...commandArguments].join(' ');

  if (joined === 'bun --version') {
    return {
      status: 0,
      stderr: '',
      stdout: '1.3.11\n',
    };
  }

  if (joined === 'docker compose version') {
    return {
      status: 0,
      stderr: '',
      stdout: 'Docker Compose version v5.1.1\n',
    };
  }

  if (joined === 'docker compose config --quiet') {
    return {
      status: 0,
      stderr: '',
      stdout: '',
    };
  }

  if (joined === 'bunx playwright --version') {
    return {
      status: 0,
      stderr: '',
      stdout: 'Version 1.59.1\n',
    };
  }

  if (joined === 'bunx playwright install --dry-run chromium') {
    return {
      status: 0,
      stderr: '',
      stdout: `
Chrome for Testing
  Install location:    /playwright/chromium
Chrome Headless Shell
  Install location:    /playwright/headless
FFmpeg
  Install location:    /playwright/ffmpeg
`,
    };
  }

  throw new Error(`Unexpected command ${joined}`);
};

const serviceBlock = (composeFile: string, service: string): string => {
  const match = new RegExp(
    String.raw`^  ${service}:\n([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:|^secrets:|^volumes:)`,
    'm',
  ).exec(composeFile);

  if (!match) {
    throw new Error(`Missing Docker Compose service ${service}`);
  }

  return match[0];
};

describe('evaluateRuntimePreflight', () => {
  it('keeps Docker and local Font Awesome installs on the public registry', () => {
    const dockerfile = fs.readFileSync(
      path.join(process.cwd(), 'Dockerfile'),
      'utf8',
    );
    const bunfig = fs.readFileSync(
      path.join(process.cwd(), 'bunfig.toml'),
      'utf8',
    );

    expect(fs.existsSync(path.join(process.cwd(), '.npmrc'))).toBe(false);
    expect(dockerfile).not.toContain('FONT_AWESOME_TOKEN');
    expect(dockerfile).not.toContain('npm.fontawesome.com');
    expect(dockerfile).toContain(
      'NPM_CONFIG_USERCONFIG=/tmp/npmrc-public-fontawesome',
    );
    expect(dockerfile).toContain(
      "'@fortawesome:registry=https://registry.npmjs.org/'",
    );

    expect(bunfig).toContain('[install.scopes]');
    expect(bunfig).toContain('"@fortawesome" = "https://registry.npmjs.org/"');
  });

  it('keeps Font Awesome packages on public npm artifacts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const lockfile = fs.readFileSync(
      path.join(process.cwd(), 'bun.lock'),
      'utf8',
    );

    expect(packageJson.dependencies).toEqual(
      expect.objectContaining({
        '@fortawesome/duotone-regular-svg-icons': expect.any(String),
        '@fortawesome/free-brands-svg-icons': expect.any(String),
      }),
    );
    expect(
      packageJson.dependencies['@fortawesome/duotone-regular-svg-icons'],
    ).toBe('npm:@fortawesome/free-solid-svg-icons@^7.2.0');

    for (const packageName of [
      '@fortawesome/duotone-regular-svg-icons',
      '@fortawesome/free-brands-svg-icons',
    ]) {
      expect(lockfile).toContain(`"${packageName}"`);
    }
    expect(lockfile).toContain('@fortawesome/free-solid-svg-icons@7.2.0');
    expect(lockfile).not.toContain('npm.fontawesome.com');
  });

  it('keeps Docker startup scripts behind the non-mutating preflight', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['docker:check']).toBe(
      'bun run env:runtime && dotenv -c dev -- bun helpers/testing/runtime-preflight.ts docker',
    );
    expect(packageJson.scripts['docker:ps']).toBe(
      'bun run env:runtime && dotenv -c dev -- docker compose ps',
    );

    for (const scriptName of [
      'docker:start',
      'docker:start:watch',
      'docker:start:foreground',
    ]) {
      expect(packageJson.scripts[scriptName]).toMatch(
        /^bun run docker:check && dotenv -c dev -- docker compose down && /,
      );
    }

    expect(packageJson.scripts['docker:resume']).toBe(
      'bun run docker:check && dotenv -c dev -- docker compose up --no-recreate -d',
    );
    expect(packageJson.scripts['docker:webserver']).toBe(
      'bun run docker:check && dotenv -c dev -- docker compose up --build',
    );

    const playwrightConfig = fs.readFileSync(
      path.join(process.cwd(), 'playwright.config.ts'),
      'utf8',
    );
    expect(playwrightConfig).toContain("command: 'bun run docker:webserver'");
    expect(playwrightConfig).not.toContain(
      "command: 'bun run docker:start:foreground'",
    );

    const testsGuidance = fs.readFileSync(
      path.join(process.cwd(), 'tests/AGENTS.md'),
      'utf8',
    );
    expect(testsGuidance).toContain('`bun run docker:webserver`');
    expect(testsGuidance).not.toContain('`bun run docker:start:foreground`');

    const rootAgentGuidance = fs.readFileSync(
      path.join(process.cwd(), 'AGENTS.md'),
      'utf8',
    );
    expect(rootAgentGuidance).toContain('`bun run docker:clean-stale`');
    expect(rootAgentGuidance).toContain(
      'project containers stuck in `created`, `dead`, `removing`, or unhealthy state',
    );
    expect(rootAgentGuidance).toContain(
      'if an unhealthy running container still cannot',
    );

    const testsReadme = fs.readFileSync(
      path.join(process.cwd(), 'tests/README.md'),
      'utf8',
    );
    expect(testsReadme).toContain('`bun run docker:clean-stale`');
    expect(testsReadme).toContain('generated `COMPOSE_PROJECT_NAME`');
    expect(testsReadme).toContain('stale, unhealthy, or uninspectable');
    expect(testsReadme).toMatch(/unhealthy running\s+generated container/u);
    expect(testsReadme).toMatch(/times\s+out Docker inspect\/remove/u);
    expect(testsReadme).toContain('restart Docker Desktop');
    expect(testsReadme).toMatch(/blocked below\s+the app tooling layer/u);

    const helpersReadme = fs.readFileSync(
      path.join(process.cwd(), 'helpers/README.md'),
      'utf8',
    );
    expect(helpersReadme).toContain('`bun run docker:clean-stale`');
    expect(helpersReadme).toContain('com.docker.compose.project');
    expect(helpersReadme).toContain('instead of relying on GNU\n`timeout`');
    expect(helpersReadme).toContain(
      'removes stale or unhealthy containers one at a time',
    );
    expect(helpersReadme).toMatch(/unhealthy\s+running generated container/u);
    expect(helpersReadme).toContain('bounded cleanup cannot stop an unhealthy');
    expect(helpersReadme).toMatch(/restart\s+Docker Desktop/u);
    expect(helpersReadme).toMatch(/blocked below the app tooling layer/u);
    expect(helpersReadme).toContain('Docker container start path');
    expect(helpersReadme).toContain('disposable Alpine container');

    const staleCleanupHelper = fs.readFileSync(
      path.join(
        process.cwd(),
        'helpers/testing/remove-stale-compose-containers.ts',
      ),
      'utf8',
    );
    expect(staleCleanupHelper).toContain(
      "const staleStates = new Set(['created', 'dead', 'removing']);",
    );
    expect(staleCleanupHelper).toContain('Health?: unknown');
    expect(staleCleanupHelper).toContain("normalizedHealth === 'unhealthy'");
    expect(staleCleanupHelper).toContain(
      "normalizedStatus.includes('unhealthy')",
    );
    expect(staleCleanupHelper).toContain('Array.isArray(parsed)');
    expect(staleCleanupHelper).toContain('[parsed as ComposeContainer]');
    expect(staleCleanupHelper).toContain('const uniqueContainerNames');
    expect(staleCleanupHelper).toContain(
      'for (const containerName of containerNames)',
    );
    expect(staleCleanupHelper).toContain('failedRemovals.push');
    expect(staleCleanupHelper).toContain("process.env['COMPOSE_PROJECT_NAME']");
    expect(staleCleanupHelper).toContain(
      '`label=com.docker.compose.project=${composeProjectName}`',
    );
    expect(staleCleanupHelper).toContain(
      'Unable to inspect Docker Compose project containers through docker ps',
    );
    expect(staleCleanupHelper).toContain(
      'Removing stale or unhealthy Docker Compose project containers',
    );
    expect(staleCleanupHelper).toContain("child.kill('SIGTERM')");
    expect(staleCleanupHelper).toContain("child.kill('SIGKILL')");
    expect(staleCleanupHelper).toContain("'docker'");
    expect(staleCleanupHelper).toContain("'rm'");
    expect(staleCleanupHelper).toContain("'-f'");
    expect(staleCleanupHelper).toContain("'-v'");
    expect(staleCleanupHelper).not.toContain('...containerNames');

    const runtimePreflight = fs.readFileSync(
      path.join(process.cwd(), 'helpers/testing/runtime-preflight.ts'),
      'utf8',
    );
    expect(runtimePreflight).toContain('Health?: unknown');
    expect(runtimePreflight).toContain('[parsed as ComposeContainer]');
    expect(runtimePreflight).toContain("health === 'unhealthy'");
    expect(runtimePreflight).toContain(
      'created/dead/removing or unhealthy containers',
    );
    expect(runtimePreflight).toContain('Docker container start path');
    expect(runtimePreflight).toContain(
      'evorto-runtime-preflight-${process.pid}',
    );
    expect(runtimePreflight).toContain(
      'docker run --name "$container_name" --rm --pull missing alpine:latest true',
    );
    expect(runtimePreflight).toContain('docker-container-start-check');
    expect(runtimePreflight).toContain('Attempted bounded cleanup');
    expect(runtimePreflight).toContain('cleanupTimeoutSeconds');
    expect(runtimePreflight).toContain('commandTimeoutMs * 2');
    expect(runtimePreflight).toContain(
      'Docker can inspect local configuration but cannot start containers',
    );
  });

  it('keeps Neon Local branch expiration wired into Docker and CI startup', () => {
    const composeFile = fs.readFileSync(
      path.join(process.cwd(), 'docker-compose.yml'),
      'utf8',
    );
    const databaseService = serviceBlock(composeFile, 'db');
    const expirationService = serviceBlock(composeFile, 'db-expiration');
    const databaseSetupService = serviceBlock(composeFile, 'db-setup');
    const evortoService = serviceBlock(composeFile, 'evorto');
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/e2e-baseline.yml'),
      'utf8',
    );
    const cleanupWorkflow = fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/neon-branch-cleanup.yml'),
      'utf8',
    );
    const copilotSetupWorkflow = fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/copilot-setup-steps.yml'),
      'utf8',
    );
    const fontAwesomeCiHelper = fs.readFileSync(
      path.join(
        process.cwd(),
        'helpers/testing/prepare-public-fontawesome-ci.sh',
      ),
      'utf8',
    );
    const dockerfile = fs.readFileSync(
      path.join(process.cwd(), 'Dockerfile'),
      'utf8',
    );
    const bunfig = fs.readFileSync(
      path.join(process.cwd(), 'bunfig.toml'),
      'utf8',
    );
    const ciBuildCacheCompose = fs.readFileSync(
      path.join(process.cwd(), '.github/docker-compose.build-cache.yml'),
      'utf8',
    );
    const helper = fs.readFileSync(
      path.join(
        process.cwd(),
        'helpers/testing/set-neon-local-branch-expiration.ts',
      ),
      'utf8',
    );
    const cleanupHelper = fs.readFileSync(
      path.join(process.cwd(), 'helpers/testing/delete-neon-local-branches.ts'),
      'utf8',
    );
    const ciPruneHelper = fs.readFileSync(
      path.join(
        process.cwd(),
        'helpers/testing/ci-prune-neon-local-branches.sh',
      ),
      'utf8',
    );
    const ciStopDockerStackHelper = fs.readFileSync(
      path.join(process.cwd(), 'helpers/testing/ci-stop-docker-stack.sh'),
      'utf8',
    );
    const runtimeEnvironment = fs.readFileSync(
      path.join(process.cwd(), 'helpers/testing/runtime-environment.ts'),
      'utf8',
    );
    const helpersReadme = fs.readFileSync(
      path.join(process.cwd(), 'helpers/README.md'),
      'utf8',
    );

    expect(databaseService).toContain(
      'DELETE_BRANCH: "${DELETE_BRANCH:-true}"',
    );
    expect(databaseService).toContain(
      '${NEON_LOCAL_METADATA_DIR:-./.neon_local}:/tmp/.neon_local',
    );
    expect(expirationService).toContain('depends_on:');
    expect(expirationService).toContain('condition: service_healthy');
    expect(expirationService).toContain(
      'DELETE_BRANCH: "${DELETE_BRANCH:-true}"',
    );
    expect(expirationService).toContain(
      'NEON_LOCAL_BRANCH_TTL_HOURS: "${NEON_LOCAL_BRANCH_TTL_HOURS:-2}"',
    );
    expect(expirationService).toContain(
      'NEON_LOCAL_METADATA_WAIT_SECONDS: "${NEON_LOCAL_METADATA_WAIT_SECONDS:-60}"',
    );
    expect(expirationService).toContain(
      '${NEON_LOCAL_METADATA_DIR:-./.neon_local}:/tmp/.neon_local',
    );
    expect(expirationService).toContain(
      'helpers/testing/set-neon-local-branch-expiration.ts',
    );
    expect(databaseSetupService).toContain('db-expiration:');
    expect(databaseSetupService).toContain(
      'condition: service_completed_successfully',
    );
    expect(evortoService).toContain('db-expiration:');
    expect(evortoService).toContain(
      'condition: service_completed_successfully',
    );

    expect(workflow).toContain('DELETE_BRANCH: true');
    expect(workflow).toContain('NEON_LOCAL_BRANCH_TTL_HOURS: 2');
    expect(workflow).toContain(
      'PARENT_BRANCH_ID is not configured; resolving the Neon default branch',
    );
    expect(workflow).toContain(
      'https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches',
    );
    expect(workflow).toContain(
      'Unable to resolve a Neon parent branch for E2E',
    );
    expect(workflow).toContain(
      'echo "PARENT_BRANCH_ID=${PARENT_BRANCH_ID}" >> "${GITHUB_ENV}"',
    );
    expect(workflow).toContain(
      'NEON_LOCAL_METADATA_DIR: /tmp/neon-local-metadata',
    );
    expect(workflow).toContain('NEON_LOCAL_METADATA_WAIT_SECONDS: 180');
    expect(workflow).toContain('Prepare Neon Local metadata directory');
    expect(workflow).toContain('chmod 0777 "${NEON_LOCAL_METADATA_DIR}"');
    expect(workflow).toContain('Confirm Neon branch expiration');
    expect(workflow).toContain(
      'bun helpers/testing/set-neon-local-branch-expiration.ts',
    );
    expect(workflow).toContain('Prune expired Neon branches before E2E');
    expect(workflow).toContain(
      'bun helpers/testing/delete-neon-local-branches.ts',
    );
    const pruneBeforeE2EIndex = workflow.indexOf(
      'Prune expired Neon branches before E2E',
    );
    expect(pruneBeforeE2EIndex).toBeLessThan(
      workflow.indexOf('- name: Install dependencies', pruneBeforeE2EIndex),
    );
    expect(pruneBeforeE2EIndex).toBeLessThan(
      workflow.indexOf(
        'Refusing a parallel registry install to avoid repeated Font Awesome package downloads.',
        pruneBeforeE2EIndex,
      ),
    );
    expect(ciStopDockerStackHelper).toContain('compose() {');
    expect(ciStopDockerStackHelper).toContain(
      'if [ -x node_modules/.bin/dotenv ]; then',
    );
    expect(ciStopDockerStackHelper).toContain(
      'node_modules/.bin/dotenv -c dev -- docker compose "$@"',
    );
    expect(ciStopDockerStackHelper).toContain('docker compose "$@"');
    expect(ciStopDockerStackHelper).toContain('compose_timeout() {');
    expect(ciStopDockerStackHelper).toContain(
      'timeout 90s node_modules/.bin/dotenv -c dev -- docker compose "$@"',
    );
    expect(ciStopDockerStackHelper).toContain(
      'timeout 90s docker compose "$@"',
    );
    expect(ciPruneHelper).toContain(
      'NEON_LOCAL_METADATA_DIR="${NEON_LOCAL_METADATA_DIR:-/tmp/neon-local-metadata}"',
    );
    expect(ciPruneHelper).toContain('NEON_PROJECT_ID="${NEON_PROJECT_ID}"');
    expect(ciPruneHelper).toContain(
      'bun helpers/testing/delete-neon-local-branches.ts',
    );
    expect(ciStopDockerStackHelper).toContain(
      'compose_timeout stop --timeout 60 db || true',
    );
    expect(ciStopDockerStackHelper).toContain(
      'compose_timeout down --timeout 60 --remove-orphans || true',
    );
    expect(workflow).not.toContain('timeout 90s compose ');
    expect(workflow).toContain('timeout-minutes: 10');
    expect(workflow).toContain(
      'run: bash helpers/testing/ci-stop-docker-stack.sh',
    );
    expect(ciStopDockerStackHelper).toContain(
      'compose_timeout kill db || true',
    );
    expect(ciStopDockerStackHelper).toContain('compose_timeout kill || true');
    expect(ciStopDockerStackHelper).toContain(
      'compose_timeout rm --force --stop -v || true',
    );
    expect(ciStopDockerStackHelper).toContain(
      'remove_compose_project_containers() {',
    );
    expect(ciStopDockerStackHelper).toContain(
      'compose_project_name="${COMPOSE_PROJECT_NAME:-evorto-ci}"',
    );
    expect(ciStopDockerStackHelper).toContain(
      'timeout 30s docker ps -aq --filter "label=com.docker.compose.project=${compose_project_name}"',
    );
    expect(ciStopDockerStackHelper).toContain(
      'for compose_container_id in ${compose_container_ids}; do',
    );
    expect(ciStopDockerStackHelper).toContain(
      'timeout 45s docker rm -f -v "${compose_container_id}" || true',
    );
    expect(ciStopDockerStackHelper).not.toContain(
      'timeout 90s docker rm -f -v ${compose_container_ids}',
    );
    expect(
      ciStopDockerStackHelper.indexOf(
        'compose_timeout rm --force --stop -v || true',
      ),
    ).toBeLessThan(
      ciStopDockerStackHelper.lastIndexOf('remove_compose_project_containers'),
    );
    expect(ciStopDockerStackHelper).toContain(
      'bash helpers/testing/ci-prune-neon-local-branches.sh',
    );
    expect(workflow).toContain('Prune expired Neon branches after E2E');
    expect(workflow).toContain('timeout-minutes: 5');
    expect(workflow).toContain(
      'run: bash helpers/testing/ci-prune-neon-local-branches.sh',
    );
    expect(workflow.indexOf('Stop Docker stack')).toBeLessThan(
      workflow.indexOf('Prune expired Neon branches after E2E'),
    );
    expect(
      workflow.indexOf('Prune expired Neon branches after E2E'),
    ).toBeLessThan(workflow.indexOf('Upload Playwright test results'));

    expect(cleanupWorkflow).toContain('name: Neon Branch Cleanup');
    expect(cleanupWorkflow).toContain('workflow_dispatch:');
    expect(cleanupWorkflow).toContain('schedule:');
    expect(cleanupWorkflow).toContain('workflow_run:');
    expect(cleanupWorkflow).toContain('workflows: ["E2E Baseline"]');
    expect(cleanupWorkflow).toContain('permissions:');
    expect(cleanupWorkflow).toContain('contents: read');
    expect(cleanupWorkflow).toContain('concurrency:');
    expect(cleanupWorkflow).toContain('group: neon-branch-cleanup');
    expect(cleanupWorkflow).toContain('cancel-in-progress: false');
    expect(cleanupWorkflow).toContain('DELETE_BRANCH: true');
    expect(cleanupWorkflow).toContain(
      'NEON_API_KEY: ${{ secrets.NEON_API_KEY }}',
    );
    expect(cleanupWorkflow).toContain('NEON_LOCAL_BRANCH_TTL_HOURS: 2');
    expect(cleanupWorkflow).toContain(
      'NEON_PROJECT_ID: ${{ vars.NEON_PROJECT_ID }}',
    );
    expect(cleanupWorkflow).toContain('timeout-minutes: 10');
    expect(cleanupWorkflow).toContain('Validate required configuration');
    expect(cleanupWorkflow).toContain(
      'run: bun helpers/testing/delete-neon-local-branches.ts',
    );
    expect(helpersReadme).toContain('Neon Branch Cleanup');
    expect(helpersReadme).toMatch(/contents:\s+read/u);
    expect(helpersReadme).toContain('NEON_API_KEY');
    expect(helpersReadme).toContain('NEON_PROJECT_ID');
    expect(helpersReadme).toContain('DELETE_BRANCH=true');
    expect(helpersReadme).toContain('two-hour active-test TTL');
    expect(helpersReadme).toContain('non-canceling `neon-branch-cleanup`');
    expect(helpersReadme).toMatch(/10-minute job\s+timeout/u);

    expect(workflow).toContain(
      'if ! bun install --frozen-lockfile --cache-dir ~/.bun/install/cache; then',
    );
    expect(workflow).toContain(
      'bun install --frozen-lockfile --cache-dir ~/.bun/install/cache',
    );
    expect(workflow).toContain('Restore Bun package cache');
    expect(workflow).toContain('id: bun-package-cache');
    expect(workflow).toContain('path: ~/.bun/install/cache');
    expect(workflow).toContain(
      "key: ${{ runner.os }}-bun-1.3.11-${{ hashFiles('package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(workflow).toContain('Restore Bun dependency tree');
    expect(workflow).toContain('id: bun-dependency-tree-cache');
    expect(workflow).toContain('path: node_modules');
    expect(workflow).toContain(
      "key: ${{ runner.os }}-bun-node-modules-1.3.11-${{ hashFiles('package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(workflow).toContain(
      'Bun package cache hit: ${{ steps.bun-package-cache.outputs.cache-hit }}',
    );
    expect(workflow).toContain('Bun package cache restored:');
    expect(workflow).toContain(
      'find "${HOME}/.bun/install/cache" -mindepth 1 -maxdepth 1 -print -quit',
    );
    expect(workflow).toContain(
      'Bun dependency tree cache hit: ${{ steps.bun-dependency-tree-cache.outputs.cache-hit }}',
    );
    expect(workflow).toContain(
      'Bun dependency tree cache restored; skipping registry install.',
    );
    expect(workflow).toContain('Save warmed Bun package cache');
    expect(workflow).toContain('Save warmed Bun dependency tree');
    expect(workflow).toContain('uses: actions/cache/save@v4');
    expect(workflow).toContain(
      "if: steps.bun-package-cache.outputs.cache-hit != 'true'",
    );
    expect(workflow).toContain(
      'key: ${{ steps.bun-package-cache.outputs.cache-primary-key }}',
    );
    expect(workflow).toContain(
      "if: steps.bun-dependency-tree-cache.outputs.cache-hit != 'true'",
    );
    expect(workflow).toContain(
      'key: ${{ steps.bun-dependency-tree-cache.outputs.cache-primary-key }}',
    );
    expect(workflow).toContain(
      'Refusing a parallel registry install to avoid repeated Font Awesome package downloads.',
    );
    expect(workflow).toContain(
      'node_modules/.bin/playwright install --with-deps chromium',
    );
    expect(workflow).toContain(
      'PLAYWRIGHT_BROWSERS_PATH: /home/runner/.cache/ms-playwright',
    );
    expect(workflow).toContain('Restore Playwright browser cache');
    expect(workflow).toContain('Warm Playwright browser cache');
    expect(workflow).toContain(
      'key: ${{ runner.os }}-playwright-1.59.1-chromium',
    );
    expect(workflow).toContain('uses: actions/cache/restore@v4');
    expect(workflow).toContain(
      'node_modules/.bin/playwright test --project=local-chrome-baseline --shard=1/2',
    );
    expect(workflow).toContain(
      'node_modules/.bin/playwright test --project=docs-baseline',
    );
    expect(workflow).not.toContain('bunx playwright');
    expect(workflow).toContain('Restore Docker build cache');
    expect(workflow).toContain('Prepare public Font Awesome registry');
    expect(
      workflow.match(
        /run: bash helpers\/testing\/prepare-public-fontawesome-ci\.sh/g,
      )?.length ?? 0,
    ).toBe(2);
    expect(fontAwesomeCiHelper).toContain('Repository .npmrc is not supported');
    expect(fontAwesomeCiHelper).toContain(
      "privateRegistry = ['npm', 'fontawesome', 'com'].join('.')",
    );
    expect(fontAwesomeCiHelper).toContain(
      String.raw`const privatePackage = /@fortawesome\/(?:duotone|pro|sharp)[^"'\s]*/u;`,
    );
    expect(fontAwesomeCiHelper).toContain(
      'Font Awesome must stay on free public npm packages in CI.',
    );
    expect(fontAwesomeCiHelper).toContain(
      'npm_config_userconfig="${RUNNER_TEMP:-/tmp}/npmrc-public-fontawesome"',
    );
    expect(fontAwesomeCiHelper).toContain(
      "printf '%s\\n' '@fortawesome:registry=https://registry.npmjs.org/' > \"${npm_config_userconfig}\"",
    );
    expect(fontAwesomeCiHelper).toContain('NPM_CONFIG_USERCONFIG=');
    expect(fontAwesomeCiHelper).toContain('npm_config_userconfig=');
    expect(workflow).toContain(
      'DOCKER_BUILD_CACHE_DIR: /tmp/evorto-docker-build-cache',
    );
    expect(
      workflow.match(
        /^\s+DOCKER_BUILD_CACHE_DIR: \/tmp\/evorto-docker-build-cache$/gm,
      )?.length ?? 0,
    ).toBe(2);
    expect(workflow).toContain('Set up Docker Buildx');
    expect(workflow).toContain('id: setup-buildx');
    expect(workflow).toContain('uses: docker/setup-buildx-action@v4');
    expect(workflow).toContain('version: latest');
    expect(workflow).toContain('warm-ci-caches:');
    expect(workflow).toContain('name: Warm CI dependency caches');
    expect(workflow).toContain('needs: warm-ci-caches');
    expect(workflow).toContain('group: e2e-${{ github.ref }}');
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain('max-parallel: 1');
    expect(workflow).toContain('path: ${{ env.DOCKER_BUILD_CACHE_DIR }}');
    expect(workflow).toContain(
      "key: ${{ runner.os }}-docker-build-bun-1.3.11-${{ hashFiles('Dockerfile', 'docker-compose.yml', '.github/docker-compose.build-cache.yml', 'package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(workflow).toContain('BUILDKIT_BUN_CACHE_DIR: buildkit-bun-cache');
    expect(workflow).toContain('Restore Docker Bun cache mount');
    expect(workflow).toContain('id: docker-bun-cache-mount');
    expect(workflow).toContain('path: ${{ env.BUILDKIT_BUN_CACHE_DIR }}');
    expect(workflow).toContain(
      "key: ${{ runner.os }}-docker-bun-cache-mount-1.3.11-${{ hashFiles('package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(workflow).toContain('Inject Docker Bun cache mount');
    expect(workflow).toContain(
      'uses: reproducible-containers/buildkit-cache-dance@v3.4.0',
    );
    expect(workflow).toContain(
      'builder: ${{ steps.setup-buildx.outputs.name }}',
    );
    expect(workflow).toContain('"target": "/home/bun/.bun/install/cache"');
    expect(workflow).toContain('"id": "bun-install-cache"');
    expect(workflow).toContain(
      'skip-extraction: ${{ steps.docker-bun-cache-mount.outputs.cache-hit }}',
    );
    expect(workflow).toContain('skip-extraction: true');
    expect(workflow).toContain('Prepare Docker build cache directory');
    expect(workflow).toContain('mkdir -p "${DOCKER_BUILD_CACHE_DIR}"');
    expect(workflow).toContain('Warm Docker build cache');
    expect(workflow).toContain(
      'timeout 20m docker compose -f docker-compose.yml -f .github/docker-compose.build-cache.yml build --progress=plain db-setup evorto',
    );
    expect(workflow).toContain(
      'Retrying once without clearing the package cache',
    );
    expect(workflow).not.toContain('bun pm cache rm');
    expect(workflow).not.toContain('Configure Font Awesome registry auth');
    expect(workflow).not.toContain('Validate Font Awesome registry auth');
    expect(workflow).not.toContain('Remove Font Awesome registry auth');
    expect(workflow).not.toContain('FONT_AWESOME_TOKEN');
    expect(workflow).not.toContain('npm.fontawesome.com');
    expect(copilotSetupWorkflow).toContain(
      'Prepare public Font Awesome registry',
    );
    expect(copilotSetupWorkflow).toContain(
      'run: bash helpers/testing/prepare-public-fontawesome-ci.sh',
    );
    expect(copilotSetupWorkflow).toContain('Restore Bun package cache');
    expect(copilotSetupWorkflow).toContain('Restore Bun dependency tree');
    expect(copilotSetupWorkflow).toContain(
      'Bun dependency tree cache restored; skipping registry install.',
    );
    expect(copilotSetupWorkflow).toContain(
      'bun install --frozen-lockfile --offline --cache-dir ~/.bun/install/cache',
    );
    expect(copilotSetupWorkflow).toContain(
      'Retrying once through the Copilot setup registry install.',
    );
    expect(copilotSetupWorkflow).not.toContain('FONT_AWESOME_TOKEN');
    expect(copilotSetupWorkflow).not.toContain('npm.fontawesome.com');
    expect(copilotSetupWorkflow).toContain('Restore Bun package cache');
    expect(copilotSetupWorkflow).toContain('id: bun-package-cache');
    expect(copilotSetupWorkflow).toContain('path: ~/.bun/install/cache');
    expect(copilotSetupWorkflow).toContain(
      "key: ${{ runner.os }}-bun-1.3.11-${{ hashFiles('package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(copilotSetupWorkflow).toContain('Restore Bun dependency tree');
    expect(copilotSetupWorkflow).toContain('id: bun-dependency-tree-cache');
    expect(copilotSetupWorkflow).toContain('path: node_modules');
    expect(copilotSetupWorkflow).toContain(
      "key: ${{ runner.os }}-bun-node-modules-1.3.11-${{ hashFiles('package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(copilotSetupWorkflow).toContain(
      'Bun package cache hit: ${{ steps.bun-package-cache.outputs.cache-hit }}',
    );
    expect(copilotSetupWorkflow).toContain('Bun package cache restored:');
    expect(copilotSetupWorkflow).toContain(
      'find "${HOME}/.bun/install/cache" -mindepth 1 -maxdepth 1 -print -quit',
    );
    expect(copilotSetupWorkflow).toContain(
      'Bun dependency tree cache hit: ${{ steps.bun-dependency-tree-cache.outputs.cache-hit }}',
    );
    expect(copilotSetupWorkflow).toContain(
      'Bun dependency tree cache restored; skipping registry install.',
    );
    expect(copilotSetupWorkflow).toContain(
      'node_modules/.bin/playwright install --with-deps',
    );
    expect(copilotSetupWorkflow).toContain(
      'PLAYWRIGHT_BROWSERS_PATH: /home/runner/.cache/ms-playwright',
    );
    expect(copilotSetupWorkflow).toContain('Restore Playwright browser cache');
    expect(copilotSetupWorkflow).toContain(
      'key: ${{ runner.os }}-playwright-1.59.1-chromium',
    );
    expect(copilotSetupWorkflow).not.toContain('bunx playwright');
    expect(copilotSetupWorkflow).toContain(
      'bun install --frozen-lockfile --cache-dir ~/.bun/install/cache',
    );
    expect(copilotSetupWorkflow).not.toContain('bun pm cache rm');
    expect(copilotSetupWorkflow).not.toContain(
      'Configure Font Awesome registry auth',
    );
    expect(copilotSetupWorkflow).not.toContain(
      'Validate Font Awesome registry auth',
    );
    expect(copilotSetupWorkflow).not.toContain(
      'Remove Font Awesome registry auth',
    );
    expect(copilotSetupWorkflow).not.toContain('FONT_AWESOME_TOKEN');
    expect(copilotSetupWorkflow).not.toContain('npm.fontawesome.com');
    expect(workflow).toContain(
      'timeout 12m node_modules/.bin/dotenv -c dev -- docker compose -f docker-compose.yml -f .github/docker-compose.build-cache.yml build --progress=plain db-setup evorto',
    );
    expect(dockerfile).toContain(
      'id=bun-install-cache,target=/home/bun/.bun/install/cache',
    );
    expect(dockerfile).toContain(
      'bun install --frozen-lockfile --cache-dir /home/bun/.bun/install/cache',
    );
    expect(dockerfile).toContain(
      'bun install --frozen-lockfile --production --offline --cache-dir /home/bun/.bun/install/cache',
    );
    expect(bunfig).toContain('[install.scopes]');
    expect(bunfig).toContain('"@fortawesome" = "https://registry.npmjs.org/"');
    expect(ciBuildCacheCompose).toContain('cache_from:');
    expect(ciBuildCacheCompose).toContain('type=gha,scope=evorto-db-setup');
    expect(ciBuildCacheCompose).toContain('type=gha,scope=evorto-app');
    expect(ciBuildCacheCompose).toContain(
      'type=local,src=${DOCKER_BUILD_CACHE_DIR:-/tmp/evorto-docker-build-cache}',
    );
    expect(ciBuildCacheCompose).toContain('cache_to:');
    expect(ciBuildCacheCompose).toContain(
      'type=gha,scope=evorto-db-setup,mode=max',
    );
    expect(ciBuildCacheCompose).toContain('type=gha,scope=evorto-app,mode=max');
    expect(ciBuildCacheCompose).toContain(
      'type=local,dest=${DOCKER_BUILD_CACHE_DIR:-/tmp/evorto-docker-build-cache},mode=max',
    );
    expect(workflow).toContain(
      'timeout 5m node_modules/.bin/dotenv -c dev -- docker compose up --no-build -d',
    );
    expect(workflow).toContain(
      'node_modules/.bin/dotenv -c dev -- docker compose ps',
    );
    expect(workflow).toContain(
      'node_modules/.bin/dotenv -c dev -- docker compose logs --no-color --tail=100',
    );
    expect(workflow).toContain(
      'node_modules/.bin/dotenv -c dev -- docker compose logs -f --no-color',
    );
    expect(workflow).toContain(
      'compose_timeout logs --no-color > test-results/docker-logs/docker-compose.log || true',
    );
    expect(workflow).toContain(
      'evorto_container_id="$(compose_timeout ps -q evorto || true)"',
    );
    expect(workflow).toContain(
      'timeout 30s docker cp "${evorto_container_id}:/app/logs/server.log" test-results/docker-logs/server.log || true',
    );
    expect(workflow).toContain(
      'Docker Compose build/start timed out. Pruning builder state and retrying once.',
    );
    expect(workflow).toContain('docker builder prune -af || true');
    expect(workflow).toContain(
      'docker compose pull --quiet --ignore-buildable --policy missing',
    );
    expect(workflow).toContain(
      'Docker Compose image pre-pull failed on attempt ${attempt}. Retrying in ${delay_seconds}s before startup.',
    );
    expect(workflow).toContain(
      'Docker Compose image pre-pull failed after ${attempt} attempts. Continuing to Compose startup, which can still pull missing images.',
    );
    expect(workflow).not.toContain(
      '::error::Docker Compose image pre-pull failed after ${attempt} attempts.',
    );
    expect(workflow).toContain(
      'Docker Compose build/start timed out before the workflow step timeout',
    );
    expect(workflow).toContain('bun run docker:ps || true');

    expect(helper).toContain('BRANCH_ID');
    expect(helper).toContain('DELETE_BRANCH=false');
    expect(helper).toContain('NEON_LOCAL_BRANCH_TTL_HOURS');
    expect(helper).toContain('NEON_LOCAL_METADATA_WAIT_SECONDS');
    expect(runtimeEnvironment).toContain(
      "NEON_LOCAL_METADATA_DIR: './.neon_local'",
    );
    expect(composeFile).toContain(
      '"${NEON_LOCAL_METADATA_DIR:-./.neon_local}:/tmp/.neon_local"',
    );
    expect(helper).toContain(
      'Math.min(parsePositiveInteger(ttlHoursValue, 2), 720)',
    );
    expect(helper).toContain(
      'body: JSON.stringify({ branch: { expires_at: expiresAt } })',
    );
    expect(helper).toContain(
      'Timed out waiting for Neon Local branch metadata',
    );
    expect(cleanupHelper).toContain('DELETE_BRANCH=false');
    expect(cleanupHelper).toContain('BRANCH_ID');
    expect(cleanupHelper).toContain('listNeonBranches');
    expect(cleanupHelper).toContain('extractStaleEphemeralBranchId');
    expect(cleanupHelper).toContain('NEON_LOCAL_BRANCH_TTL_HOURS');
    expect(cleanupHelper).toContain('expires_at');
    expect(cleanupHelper).toContain('created_at');
    expect(cleanupHelper).toContain('staleAfter');
    expect(cleanupHelper).toContain("branch.name === 'main'");
    expect(cleanupHelper).toContain("method: 'DELETE'");
    expect(cleanupHelper).toContain('response.status === 404');
    expect(cleanupHelper).toContain('No Neon Local branch metadata found');
    expect(cleanupHelper).toContain('No Neon Local branch ids found');
    expect(cleanupHelper).toContain('logBranchCleanupSummary');
    expect(cleanupHelper).toContain(
      'const remainingBranches = await listNeonBranches();',
    );
    expect(cleanupHelper).toContain('Neon branch cleanup summary: total=');
    expect(cleanupHelper).toContain('active_test=');
    expect(cleanupHelper).toContain('stale_deleted=');
    expect(cleanupHelper).toContain(
      'Active Neon Local branches still inside the ${ttlHours}h active-test TTL:',
    );
    expect(cleanupHelper).toContain(
      'No stale Neon Local branches found outside the ${ttlHours}h active-test TTL.',
    );
    expect(cleanupHelper).toMatch(
      /if \(branchIds\.length === 0\) \{[\s\S]*?await deleteStaleEphemeralBranches\(\);[\s\S]*?return;[\s\S]*?\}/u,
    );
    expect(cleanupHelper).toContain(
      'NEON_API_KEY and NEON_PROJECT_ID are required for Neon Local stale cleanup; skipping stale cleanup.',
    );
  });

  it('keeps generated runtime ports stable for non-mutating Docker checks', () => {
    const runtimeEnvironment = fs.readFileSync(
      path.join(process.cwd(), 'helpers/testing/runtime-environment.ts'),
      'utf8',
    );
    const testsReadme = fs.readFileSync(
      path.join(process.cwd(), 'tests/README.md'),
      'utf8',
    );
    const helpersReadme = fs.readFileSync(
      path.join(process.cwd(), 'helpers/README.md'),
      'utf8',
    );

    expect(runtimeEnvironment).toContain(
      'const existingRuntimeEnvironment = readExistingRuntimeEnvironment();',
    );
    expect(runtimeEnvironment).toContain(
      'const parsed = parsePort(existingRuntimeEnvironment[name]);',
    );
    expect(testsReadme).toContain(
      'later package scripts preserve its generated local',
    );
    expect(helpersReadme).toContain(
      'later package-script preflights preserve the',
    );
  });

  it('keeps Angular SSR host validation aligned with local and seeded tenant hosts', () => {
    const angularJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'angular.json'), 'utf8'),
    ) as {
      projects: {
        evorto: {
          architect: {
            build: {
              options: {
                security?: {
                  allowedHosts?: string[];
                };
              };
            };
          };
        };
      };
    };

    expect(
      angularJson.projects.evorto.architect.build.options.security
        ?.allowedHosts,
    ).toEqual(
      expect.arrayContaining([
        'localhost',
        '127.0.0.1',
        'evorto.fly.dev',
        '*.evorto.app',
      ]),
    );
  });

  it('keeps local app routes reachable to lightweight GET and HEAD probes', () => {
    const serverSource = fs.readFileSync(
      path.join(process.cwd(), 'src/server.ts'),
      'utf8',
    );

    expect(serverSource).toContain("method === 'GET' || method === 'HEAD'");
    expect(serverSource).toContain('if (isSsrMethod(request.method))');
    expect(serverSource).not.toContain("if (request.method === 'GET') {");
  });

  it('keeps the documented command surface visible in package scripts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const stabilization = fs.readFileSync(
      path.join(process.cwd(), 'STABILIZATION.md'),
      'utf8',
    );
    const normalizedStabilization = stabilization.replaceAll(/\s+/g, ' ');

    expect(normalizedStabilization).toContain(
      'Important entrypoints remain visible in `package.json`: app build/dev, unit tests, Playwright e2e/docs and focused viewport/layout/MCP reruns, Docker stack start/resume/webServer/stop, database commands, dependency updates, Stripe/Sentry ops, theme generation, and receipt-image cleanup.',
    );

    const visibleScriptGroups = [
      ['build:app', 'build:watch', 'dev:start'],
      ['test:unit', 'test:unit:server'],
      ['test:e2e', 'test:e2e:docs', 'test:e2e:docs:publish'],
      [
        'test:e2e:authenticated-viewports',
        'test:e2e:mcp-browser-authenticated-planner',
        'test:e2e:layout-helper',
        'test:e2e:public-general-viewports',
      ],
      ['docker:start', 'docker:resume', 'docker:webserver', 'docker:stop'],
      ['db:push', 'db:reset', 'db:migrate'],
      ['deps:update:angular', 'deps:update:drizzle'],
      ['ops:stripe:listen', 'ops:sentry:sourcemaps'],
      ['ui:theme:generate', 'ui:theme:generate:esn'],
      ['test:cleanup:receipt-images', 'test:cleanup:receipt-images:dry-run'],
    ];

    for (const scriptName of visibleScriptGroups.flat()) {
      expect(packageJson.scripts).toHaveProperty(scriptName);
      expect(packageJson.scripts[scriptName]?.trim()).not.toBe('');
    }
  });

  it('keeps Playwright package scripts on the generated runtime environment path', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    for (const scriptName of [
      'test:e2e',
      'test:e2e:ui',
      'test:e2e:integration',
      'test:e2e:create-account',
      'test:e2e:esncard-provider',
      'test:e2e:authenticated-viewports',
      'test:e2e:mcp-browser-authenticated-planner',
      'test:e2e:layout-helper',
      'test:e2e:public-general-viewports',
      'test:e2e:docs',
      'test:e2e:docs:publish',
    ]) {
      expect(packageJson.scripts[scriptName]).toContain('bun run env:runtime');
      expect(packageJson.scripts[scriptName]).toContain('dotenv -c dev --');
    }

    expect(packageJson.scripts['test:e2e:integration']).toContain(
      '--project=local-chrome-integration --project=docs-integration',
    );
    expect(packageJson.scripts['test:e2e:integration']).toContain(
      'DOCS_OUT_DIR=test-results/docs DOCS_IMG_OUT_DIR=test-results/docs/images',
    );
    expect(packageJson.scripts['test:e2e:create-account']).toContain(
      'tests/specs/profile/create-account.spec.ts',
    );
    expect(packageJson.scripts['test:e2e:create-account']).toContain(
      'tests/docs/users/create-account.doc.ts',
    );
    expect(packageJson.scripts['test:e2e:create-account']).toContain(
      '--project=local-chrome-integration --project=docs-integration',
    );
    expect(packageJson.scripts['test:e2e:create-account']).toContain(
      'DOCS_OUT_DIR=test-results/docs DOCS_IMG_OUT_DIR=test-results/docs/images',
    );
    expect(packageJson.scripts['test:e2e:create-account']).toContain(
      "--grep '@needs-auth0-management'",
    );
    expect(packageJson.scripts['test:e2e:docs']).toContain(
      'DOCS_OUT_DIR=test-results/docs DOCS_IMG_OUT_DIR=test-results/docs/images',
    );
    expect(packageJson.scripts['test:e2e:docs:publish']).toContain(
      'DOCS_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/src/app/docs',
    );
    expect(packageJson.scripts['test:e2e:docs:publish']).toContain(
      'DOCS_IMG_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/public/docs',
    );
    expect(packageJson.scripts['test:e2e:esncard-provider']).toContain(
      'tests/specs/profile/user-profile-esncard-provider.spec.ts',
    );
    expect(packageJson.scripts['test:e2e:esncard-provider']).toContain(
      '--project=local-chrome-baseline',
    );
    expect(packageJson.scripts['test:e2e:esncard-provider']).toContain(
      "--grep '@esncard-provider'",
    );
    expect(packageJson.scripts['test:e2e:authenticated-viewports']).toContain(
      'tests/specs/admin/global-admin-tenants.spec.ts',
    );
    expect(packageJson.scripts['test:e2e:authenticated-viewports']).toContain(
      '--workers=1',
    );
    expect(
      packageJson.scripts['test:e2e:mcp-browser-authenticated-planner'],
    ).toContain('tests/setup/mcp-browser-authenticated.seed.ts');
    expect(
      packageJson.scripts['test:e2e:mcp-browser-authenticated-planner'],
    ).toContain('--project=mcp-browser-authenticated-planner');
    expect(packageJson.scripts['test:e2e:layout-helper']).toContain(
      'NO_WEBSERVER=true',
    );
    expect(packageJson.scripts['test:e2e:layout-helper']).toContain(
      'tests/specs/smoke/page-layout-helper.test.ts',
    );
    expect(packageJson.scripts['test:e2e:layout-helper']).toContain(
      '--no-deps',
    );
    expect(packageJson.scripts['test:e2e:public-general-viewports']).toContain(
      'NO_WEBSERVER=true',
    );
    expect(packageJson.scripts['test:e2e:public-general-viewports']).toContain(
      'tests/specs/smoke/public-general-viewports.spec.ts',
    );
    expect(packageJson.scripts['test:e2e:public-general-viewports']).toContain(
      '--workers=1',
    );
    expect(packageJson.scripts['test:e2e:public-general-viewports']).toContain(
      '--no-deps',
    );
  });

  it('keeps Playwright list discovery away from file-writing reporters', () => {
    const playwrightConfig = fs.readFileSync(
      path.join(process.cwd(), 'playwright.config.ts'),
      'utf8',
    );

    expect(playwrightConfig).toContain(
      "const listOnly = process.argv.includes('--list');",
    );
    expect(playwrightConfig).toContain(': listOnly');
    expect(playwrightConfig).toContain("? [['dot']]");
    expect(playwrightConfig).toContain("['html', { open: 'never' }]");
    expect(playwrightConfig).toContain(
      "['./tests/support/reporters/documentation-reporter.ts']",
    );
  });

  it('keeps required Docker variables wired into Compose services', () => {
    const composeFile = fs.readFileSync(
      path.join(process.cwd(), 'docker-compose.yml'),
      'utf8',
    );
    const databaseService = serviceBlock(composeFile, 'db');
    const databaseSetupService = serviceBlock(composeFile, 'db-setup');
    const evortoService = serviceBlock(composeFile, 'evorto');
    const stripeService = serviceBlock(composeFile, 'stripe');

    expect(databaseService).toContain('NEON_API_KEY:');
    expect(databaseService).toContain('NEON_PROJECT_ID:');

    expect(databaseSetupService).not.toContain('secrets:');
    expect(databaseSetupService).not.toContain('FONT_AWESOME_TOKEN');
    expect(databaseSetupService).toContain('STRIPE_TEST_ACCOUNT_ID:');
    expect(databaseSetupService).toContain(
      'bun helpers/reset-database-schema.ts',
    );
    expect(databaseSetupService).toContain(
      'bun ./node_modules/drizzle-kit/bin.cjs push --force',
    );
    expect(databaseSetupService).toContain('bun helpers/database.ts');

    for (const variable of [
      'CLIENT_ID',
      'CLIENT_SECRET',
      'ISSUER_BASE_URL',
      'SECRET',
      'SSR_RPC_ORIGIN',
      'STRIPE_API_KEY',
      'STRIPE_TEST_ACCOUNT_ID',
      'STRIPE_WEBHOOK_SECRET_FILE',
    ]) {
      expect(evortoService).toContain(`${variable}:`);
    }
    expect(evortoService).not.toContain('secrets:');
    expect(evortoService).not.toContain('FONT_AWESOME_TOKEN');
    expect(evortoService).toContain(
      'STRIPE_WEBHOOK_SECRET_FILE: /run/stripe-webhook/signing-secret',
    );
    expect(evortoService).toContain('S3_ENDPOINT: http://minio:9000');
    expect(evortoService).toContain('SSR_RPC_ORIGIN: http://localhost:4200');
    expect(evortoService).not.toContain(
      'S3_ENDPOINT: "${S3_ENDPOINT:-http://minio:9000}"',
    );

    expect(stripeService).toContain('STRIPE_API_KEY:');
    expect(stripeService).toContain(
      './helpers/testing/stripe-listen-docker.sh',
    );

    expect(composeFile).not.toContain('FONT_AWESOME_TOKEN');
    expect(composeFile).not.toContain('environment: FONT_AWESOME_TOKEN');
  });

  it('reports all docker startup blockers before mutating containers', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: {
        CLIENT_ID: 'client-id',
        ISSUER_BASE_URL: 'issuer',
        NEON_PROJECT_ID: 'project-id',
        SECRET: 'secret',
      },
      fileExists: (filePath) => filePath !== '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: expect.arrayContaining([
            'NEON_API_KEY: Neon Local branch creation',
            'CLIENT_SECRET: Auth0 application secret',
            'STRIPE_API_KEY: Stripe API access for paid registration flows',
            'STRIPE_TEST_ACCOUNT_ID: Stripe connected account id for seeded paid flows',
          ]),
          label: 'Required docker runtime variables',
          severity: 'failure',
        }),
        expect.objectContaining({
          details: expect.arrayContaining([
            'CLIENT_ID: Auth0 application id',
            'ISSUER_BASE_URL: Auth0 issuer URL',
            'NEON_PROJECT_ID: Neon Local project selection',
            'SECRET: Application session secret',
          ]),
          label: 'Available docker runtime variables',
          severity: 'ok',
        }),
        expect.objectContaining({
          details: ['/repo/.env.dev'],
          label: 'Generated worktree runtime env file',
          severity: 'failure',
        }),
      ]),
    );
  });

  it('does not require external provider variables for Docker startup', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: requiredDockerEnvironment,
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: ['No optional variables are configured for this target.'],
          label: 'Optional docker variables',
          severity: 'ok',
        }),
      ]),
    );
  });

  it('keeps the no-secret env example aligned with required Docker variables', () => {
    const environmentExample = fs.readFileSync(
      path.join(process.cwd(), '.env.example'),
      'utf8',
    );

    for (const { name } of requiredByTarget.docker) {
      expect(environmentExample).toContain(`${name}=`);
    }
    expect(environmentExample).toContain(
      'Do not put real secret values in this file.',
    );
  });

  it('keeps removed provider variables out of the no-secret env example', () => {
    const environmentExample = fs.readFileSync(
      path.join(process.cwd(), '.env.example'),
      'utf8',
    );

    for (const { name } of optionalByTarget.docker) {
      expect(environmentExample).toContain(`${name}=`);
    }
    expect(environmentExample).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
  });

  it('warns about missing Playwright browsers without blocking Docker start', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: requiredDockerEnvironment,
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(false);
    expect(result.warned).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: ['All required variables are present.'],
          label: 'Required docker runtime variables',
          severity: 'ok',
        }),
        expect.objectContaining({
          details: expect.arrayContaining([
            'Missing /playwright/chromium',
            'Missing /playwright/headless',
            'Missing /playwright/ffmpeg',
            'Run bun run test:e2e:install before local Playwright runs.',
          ]),
          label: 'Playwright Chromium browser installation',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('points local runs at system Chrome when bundled Chromium is missing and Chrome is available', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: requiredDockerEnvironment,
      fileExists: (filePath) =>
        filePath === '/repo/.env.dev' ||
        filePath === '/Applications/Google Chrome.app',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(false);
    expect(result.warned).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: expect.arrayContaining([
            'Or set E2E_BROWSER_CHANNEL=chrome to use /Applications/Google Chrome.app for local exploratory runs.',
          ]),
          label: 'Playwright Chromium browser installation',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('allows opt-in system Chrome to avoid the bundled Chromium cache warning', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: {
        ...requiredDockerEnvironment,
        E2E_BROWSER_CHANNEL: 'chrome',
      },
      fileExists: (filePath) =>
        filePath === '/repo/.env.dev' ||
        filePath === '/Applications/Google Chrome.app',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(false);
    expect(result.warned).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: [
            'Using E2E_BROWSER_CHANNEL=chrome with /Applications/Google Chrome.app',
          ],
          label: 'Playwright system Chrome browser channel',
          severity: 'ok',
        }),
      ]),
    );
  });

  it('warns when opt-in system Chrome is requested but missing', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: {
        ...requiredDockerEnvironment,
        E2E_BROWSER_CHANNEL: 'chrome',
      },
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(false);
    expect(result.warned).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: [
            'E2E_BROWSER_CHANNEL=chrome is set, but no system Chrome installation was found.',
            'Unset E2E_BROWSER_CHANNEL and run bun run test:e2e:install, or install Google Chrome for local exploratory runs.',
          ],
          label: 'Playwright system Chrome browser channel',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('allows Docker to use the generated Stripe listener webhook secret file', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: requiredDockerEnvironment,
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: [
            'Docker Stripe CLI writes its generated signing secret to STRIPE_WEBHOOK_SECRET_FILE for the app container.',
          ],
          label: 'Stripe webhook signing secret source',
          severity: 'ok',
        }),
      ]),
    );
  });
});
