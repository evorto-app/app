import { readdirSync, readFileSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(repositoryRoot, sourcePath), 'utf8');

const listFiles = (directory: string, extension: string): string[] =>
  readdirSync(nodePath.join(repositoryRoot, directory)).flatMap((entry) => {
    const sourcePath = `${directory}/${entry}`;
    const absolutePath = nodePath.join(repositoryRoot, sourcePath);

    if (statSync(absolutePath).isDirectory()) {
      return listFiles(sourcePath, extension);
    }

    return sourcePath.endsWith(extension) ? [sourcePath] : [];
  });

const readSection = (source: string, heading: string, nextHeading: string) => {
  const match = source.match(
    new RegExp(
      String.raw`## ${heading}\n(?<section>[\s\S]*?)\n## ${nextHeading}`,
      'u',
    ),
  );

  if (!match?.groups?.section) {
    throw new Error(
      `STABILIZATION.md is missing the ${heading} section before ${nextHeading}`,
    );
  }

  return match.groups.section;
};

describe('stabilization source', () => {
  it('keeps the Browser review queue aligned with repeat manual app-flow review', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');

    expect(queue).toContain('For repeat Browser review');
    expect(queue).toContain('generated `BASE_URL` from `.env.dev`');
    expect(queue).toContain('local ports can be explicitly pinned for Auth0');
    expect(queue).not.toMatch(/http:\/\/localhost:\d+/u);
    expect(queue).toContain('Anonymous event discovery');
    expect(queue).toContain('Participant registration/profile');
    expect(queue).toContain('Organizer authoring and check-in');
    expect(queue).toContain('Tenant admin and finance');
    expect(queue).toContain('Global admin relaunch scope');
    expect(queue).toContain('Deterministic provider checks');
    expect(queue).toContain('tests/specs/events/events.test.ts');
    expect(queue).toContain('tests/specs/events/unlisted-visibility.test.ts');
    expect(queue).toContain('tests/docs/events/register.doc.ts');
    expect(queue).toContain('tests/docs/profile/*.doc.ts');
    expect(queue).toContain('bun run test:e2e:create-account');
    expect(queue).toContain('tests/specs/admin/global-admin-tenants.spec.ts');
    expect(queue).toContain(
      'tests/specs/permissions/global-admin-route-guard.spec.ts',
    );
    expect(queue).not.toContain('tests/docs/admin/global-admin.doc.ts');
    expect(queue).toContain('bun run test:e2e:esncard-provider');
    expect(queue).toContain(
      'tests/specs/profile/user-profile-esncard-provider.spec.ts',
    );
    expect(queue).toContain('isolated E2E tenant');
    expect(queue).toContain('active `localhost` tenant');
    expect(queue).toContain('TEST-ESN-0001');
    expect(queue).toContain('local review-state drift');
    expect(queue).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
  });

  it('keeps Review Next scoped to the real remaining blockers', () => {
    const source = readSource('STABILIZATION.md');
    const reviewNext = source.split('## Review Next\n')[1];

    expect(reviewNext).toContain(
      'first manual in-app Browser queue pass has been completed',
    );
    expect(reviewNext).toContain('deterministic ESNcard provider test');
    expect(reviewNext).toContain('provider add/refresh/remove outcomes');
    expect(reviewNext).toContain('custom-domain');
    expect(reviewNext).toContain('multi-domain onboarding');
    expect(reviewNext).toContain('tenant impersonation');
    expect(reviewNext).toContain('documented deferred scope');
    expect(reviewNext).toContain('Docker-backed');
    expect(reviewNext).toContain('system-Chrome coverage');
    expect(reviewNext).toContain('manual Browser review pass');
    expect(reviewNext).toContain('visible profile discount-card UX');
    expect(reviewNext).not.toContain('no active Codex browser pane');
    expect(reviewNext).not.toContain('Transport closed');
    expect(reviewNext).not.toContain('fallback Playwright browser MCP');
    expect(source).not.toContain(
      'Browser walkthrough coverage for anonymous event browsing is enough',
    );
    expect(source).toContain(
      'The first manual in-app Browser walkthrough has now covered the full',
    );
    expect(source).toContain(
      'repeat Browser review should still use the generated `BASE_URL`',
    );
    expect(source).toContain('first in-app Browser queue pass are healthy');
    expect(source).not.toContain(
      'in-app Browser control still times out before manual review can run',
    );
    expect(source).not.toContain('once the local runtime is available');
    expect(source).not.toContain(
      'manual runtime review once in-app Browser navigation is available',
    );
    expect(source).not.toContain(
      'in-app Browser connection still times out during manual global-admin navigation',
    );
    expect(source).not.toContain('Must setup test before interacting');
    expect(source).not.toContain('human Browser pass remains blocked');
    expect(source).not.toContain('visible profile UX review remains blocked');
    expect(source).not.toContain(
      'lists the Browser-backed coverage still\n' +
        '  needed from the remaining stabilization gaps',
    );
  });

  it('keeps the PR readiness checkpoint current without pinning stale heads', () => {
    const source = readSource('STABILIZATION.md');
    const dockerCompose = readSource('docker-compose.yml');
    const endToEndWorkflow = readSource('.github/workflows/e2e-baseline.yml');
    const readinessCheckpoint = source.match(
      /Recent PR readiness checkpoint:[\s\S]*?\n\n## Browser Review Queue/u,
    )?.[0];

    expect(readinessCheckpoint).toBeDefined();
    expect(readinessCheckpoint).not.toMatch(/[0-9a-f]{40}/u);
    expect(readinessCheckpoint).toContain('current PR head');
    expect(readinessCheckpoint).toContain('split Playwright E2E matrix');
    expect(readinessCheckpoint).toContain('Playwright E2E (functional)');
    expect(readinessCheckpoint).toContain('Playwright E2E (docs)');
    expect(readinessCheckpoint).toMatch(/roughly\s+ten minutes/u);
    expect(readinessCheckpoint).toContain('low-to-high teens');
    expect(readinessCheckpoint).toContain('out after 10 minutes');
    expect(readinessCheckpoint).toMatch(/bounded\s+`on-failure` restarts/u);
    expect(readinessCheckpoint).toContain(
      'transient `423 Client Error: Locked`',
    );
    expect(readinessCheckpoint).toMatch(
      /generated\s+screenshot\s+stabilization/u,
    );
    expect(readinessCheckpoint).toContain('run in parallel');
    expect(readinessCheckpoint).toMatch(
      /Chromium-only Playwright browser\s+install/u,
    );
    expect(endToEndWorkflow).toContain('timeout-minutes: 10');
    expect(endToEndWorkflow).toContain('matrix:');
    expect(endToEndWorkflow).toContain('suite: [functional, docs]');
    expect(endToEndWorkflow).toContain("if: matrix.suite == 'functional'");
    expect(endToEndWorkflow).toContain("if: matrix.suite == 'docs'");
    expect(dockerCompose).toContain('restart: on-failure:5');
    expect(endToEndWorkflow).not.toContain(
      'Neon Local branch startup hit a transient project lock',
    );
    expect(endToEndWorkflow).not.toContain('return 75');
    expect(endToEndWorkflow).toContain(
      'name: playwright-test-results-${{ matrix.suite }}',
    );
    expect(readinessCheckpoint).toMatch(
      /The PR\s+has\s+no\s+unresolved review threads\s+at/u,
    );
    expect(readinessCheckpoint).toMatch(
      /paid\s+transfer\/resale money movement\s+still needs a human settlement-model\s+decision/u,
    );
    expect(readinessCheckpoint).toMatch(
      /formal\s+bot\s+review is\s+expected only after the PR is marked ready/u,
    );
    expect(readinessCheckpoint).not.toContain(
      '9b65634b66840aa72dc53c4a5bef742036f049ac',
    );
    expect(readinessCheckpoint).not.toContain('22m26s');
    expect(readinessCheckpoint).not.toContain(
      'unlisted-admin generated-docs menu retry',
    );
    expect(readinessCheckpoint).not.toContain(
      'Node.js 20 actions are deprecated',
    );
    expect(readinessCheckpoint).not.toContain('workflow-pin update');
    expect(readinessCheckpoint).not.toContain(
      '4cfd4d960f1831055153fab0b3321ed55e937284',
    );
    expect(readinessCheckpoint).not.toContain(
      '0d5c1b74de5db7504f2bd833c2e0859adae1a18d',
    );
    expect(readinessCheckpoint).not.toContain(
      '33b163773afeafd93716a21b52ca253ef273a544',
    );
    expect(readinessCheckpoint).not.toContain(
      '584da0dd32867764716132eb2dcdd0bea3e32869',
    );
    expect(readinessCheckpoint).not.toContain('9m16s');
    expect(readinessCheckpoint).not.toContain('13m31s');
    expect(readinessCheckpoint).not.toContain('7m25s');
    expect(readinessCheckpoint).not.toContain('15m18s');
    expect(readinessCheckpoint).not.toContain(
      '96f3f64351c68b645070a63534c839944ffd5440',
    );
    expect(readinessCheckpoint).not.toContain('16m02s');
    expect(readinessCheckpoint).not.toContain(
      '7b39be0f3a89e1fd14982114e8cbf98a5c59af48',
    );
    expect(readinessCheckpoint).not.toContain(
      'fe3c4a669d444b643dbddd6aefea226574d7673d',
    );
    expect(readinessCheckpoint).not.toContain(
      'in-app Browser manual pass is still blocked',
    );
    expect(readinessCheckpoint).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
  });

  it('keeps paid transfer and resale blocked on an explicit settlement decision', () => {
    const source = readSource('STABILIZATION.md');

    expect(source).toContain('Paid transfer/resale settlement model');
    expect(source).toContain('organizer-mediated manual settlement');
    expect(source).toContain('platform-mediated resale');
    expect(source).toContain('fresh Stripe Checkout');
    expect(source).toContain('Decision needed before implementation');
    expect(source).toContain('Do not infer one of these models');
    expect(source).toContain(
      'The event page shows a disabled transfer action and explains that paid registration transfer and resale need a decision between organizer-mediated manual settlement, platform-mediated resale, or explicit paid-transfer deferral.',
    );
    expect(source).toContain(
      'Do not assume whether\n' +
        '   paid resale should be organizer-mediated manual settlement or a\n' +
        '   platform-mediated Stripe Checkout replacement flow.',
    );
  });

  it('keeps the Playwright inventory clear about watchlist versus blockers', () => {
    const source = readSource('tests/test-inventory.md');

    expect(source).toContain('## Stabilization Coverage Watchlist');
    expect(source).not.toContain('## Stabilization Coverage Still Needed');
    expect(source).toContain(
      'Most are now covered by deterministic specs, generated docs, or source guards',
    );
    expect(source).toContain(
      'first in-app Browser manual review queue pass has now covered',
    );
    expect(source).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
  });

  it('keeps finance docs in the baseline docs project', () => {
    const stabilization = readSource('STABILIZATION.md');
    const playwrightConfig = readSource('playwright.config.ts');
    const inventory = readSource('tests/test-inventory.md');

    expect(stabilization).toContain('Finance docs in CI baseline');
    expect(stabilization).toContain('Decision: Option B.');
    expect(stabilization).toContain(
      'Finance docs are product-facing relaunch coverage',
    );
    expect(playwrightConfig).toContain(
      String.raw`testMatch: /docs\/.*\.doc\.ts$/`,
    );
    expect(playwrightConfig).not.toMatch(
      /docs-baseline[\s\S]*testIgnore:[\s\S]*finance/u,
    );
    expect(inventory).toContain('docs/finance/finance-overview.doc.ts');
    expect(inventory).toContain(
      'docs/finance/receipt-review-reimbursement.doc.ts',
    );
  });

  it('keeps quality guidance honest about blocked Browser review', () => {
    const source = readSource('QUALITY.md');

    expect(source).toContain('If Browser is unavailable because the plugin');
    expect(source).toMatch(/control transport is not\s+healthy/u);
    expect(source).toMatch(
      /Do not treat Playwright, screenshots, or system Chrome as a\s+substitute for a requested in-app Browser walkthrough\./u,
    );
    expect(source).toMatch(
      /If Browser could not be used, name the blocker and summarize the fallback\s+validation separately\./u,
    );
  });

  it('keeps app code on TanStack Query boolean status narrowing', () => {
    const sourceFiles = [
      ...listFiles('src/app', '.html'),
      ...listFiles('src/app', '.ts'),
    ];

    for (const sourceFile of sourceFiles) {
      const source = readSource(sourceFile);

      expect(source, sourceFile).not.toMatch(
        /\b\w+Query\.status\(\)\s*(?:={2,3}|!={1,2})\s*["'](?:pending|success|error)["']/u,
      );
    }
  });

  it('keeps app templates away from TanStack Query data alias narrowing', () => {
    const sourceFiles = listFiles('src/app', '.html');

    for (const sourceFile of sourceFiles) {
      const source = readSource(sourceFile);

      expect(source, sourceFile).not.toMatch(
        /@if\s*\([^)]*\b\w+Query\.data\(\)\s*;\s*as\s+\w+/u,
      );
    }
  });
});
