import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (sourcePath: string): string =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

const listFiles = (directory: string, extension: string): string[] =>
  readdirSync(path.join(repositoryRoot, directory)).flatMap((entry) => {
    const sourcePath = `${directory}/${entry}`;
    const absolutePath = path.join(repositoryRoot, sourcePath);

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
      `QUALITY.md is missing the ${heading} section before ${nextHeading}`,
    );
  }

  return match.groups.section;
};

describe('quality source', () => {
  it('keeps the manual review queue aligned with the required app-flow pass', () => {
    const source = readSource('QUALITY.md');
    const queue = readSection(source, 'Manual Review Queue', 'Done Criteria');

    expect(queue).toContain('Anonymous event discovery');
    expect(queue).toContain('Participant registration and profile');
    expect(queue).toContain('Organizer authoring and check-in');
    expect(queue).toContain('Tenant administration and finance');
    expect(queue).toContain('Platform administration');
    expect(queue).toContain('Live ESNcard provider');
    expect(queue).toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
    expect(queue).toContain('bun run test:e2e:live-esncard');
  });

  it('keeps the manual review queue free from stale runtime incident detail', () => {
    const source = readSource('QUALITY.md');
    const queue = readSection(source, 'Manual Review Queue', 'Done Criteria');

    expect(queue).not.toContain('Transport closed');
    expect(queue).not.toContain('no active Codex browser pane');
    expect(queue).not.toContain('fallback Playwright browser MCP');
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
        /\b\w+Query\.status\(\)\s*===\s*['"](pending|success|error)['"]/u,
      );
    }
  });
});
