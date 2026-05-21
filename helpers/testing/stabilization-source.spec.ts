import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (path: string): string =>
  readFileSync(join(repositoryRoot, path), 'utf8');

const listFiles = (directory: string, extension: string): string[] =>
  readdirSync(join(repositoryRoot, directory)).flatMap((entry) => {
    const path = `${directory}/${entry}`;
    const absolutePath = join(repositoryRoot, path);

    if (statSync(absolutePath).isDirectory()) {
      return listFiles(path, extension);
    }

    return path.endsWith(extension) ? [path] : [];
  });

const readSection = (source: string, heading: string, nextHeading: string) => {
  const match = source.match(
    new RegExp(
      `## ${heading}\\n(?<section>[\\s\\S]*?)\\n## ${nextHeading}`,
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
  it('keeps the Browser review queue aligned with the remaining manual app-flow pass', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');

    expect(queue).toContain('Use the generated `BASE_URL` from `.env.dev`');
    expect(queue).toContain('Anonymous event discovery');
    expect(queue).toContain('Participant registration/profile');
    expect(queue).toContain('Organizer authoring and check-in');
    expect(queue).toContain('Tenant admin and finance');
    expect(queue).toContain('Global admin relaunch scope');
    expect(queue).toContain('Credential-gated provider checks');
    expect(queue).toContain('tests/specs/events/events.test.ts');
    expect(queue).toContain('tests/specs/events/unlisted-visibility.test.ts');
    expect(queue).toContain('tests/docs/events/register.doc.ts');
    expect(queue).toContain('tests/docs/profile/*.doc.ts');
    expect(queue).toContain('tests/specs/admin/global-admin-tenants.spec.ts');
    expect(queue).toContain(
      'tests/specs/permissions/global-admin-route-guard.spec.ts',
    );
    expect(queue).toContain('tests/docs/admin/global-admin.doc.ts');
    expect(queue).toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
    expect(queue).toContain('bun run test:e2e:live-esncard');
  });

  it('keeps Review Next scoped to the real remaining blockers', () => {
    const source = readSource('STABILIZATION.md');
    const reviewNext = source.split('## Review Next\n')[1];

    expect(reviewNext).toContain('in-app Browser manual review');
    expect(reviewNext).toContain('live external');
    expect(reviewNext).toContain(
      'ESNcard provider add/refresh/remove outcomes',
    );
    expect(reviewNext).toContain('custom-domain');
    expect(reviewNext).toContain('multi-domain onboarding');
    expect(reviewNext).toContain('tenant impersonation');
    expect(reviewNext).toContain('documented deferred scope');
    expect(reviewNext).toContain('Docker-backed');
    expect(reviewNext).toContain('system-Chrome coverage');
    expect(reviewNext).toContain('no active Codex browser pane');
    expect(source).not.toContain(
      'Browser walkthrough coverage for anonymous event browsing is enough',
    );
    expect(source).toContain(
      'The manual in-app Browser walkthrough is still a real review gate',
    );
  });

  it('keeps the Playwright inventory clear about watchlist versus blockers', () => {
    const source = readSource('tests/test-inventory.md');

    expect(source).toContain('## Stabilization Coverage Watchlist');
    expect(source).not.toContain('## Stabilization Coverage Still Needed');
    expect(source).toContain(
      'Most are now covered by deterministic specs, generated docs, or source guards',
    );
    expect(source).toContain('in-app Browser manual review queue');
    expect(source).toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
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

  it('keeps app templates on TanStack Query boolean status narrowing', () => {
    const sourceFiles = listFiles('src/app', '.html');

    for (const sourceFile of sourceFiles) {
      const source = readSource(sourceFile);

      expect(source, sourceFile).not.toMatch(
        /\b\w+Query\.status\(\) === "(pending|success|error)"/u,
      );
    }
  });
});
