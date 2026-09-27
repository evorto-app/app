import { afterEach, describe, expect, it } from '@effect/vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readWorkflowRunStep,
  readWorkflowRunSteps,
} from './workflow-step-fixture';

const revision = 'a'.repeat(40);
const otherRevision = 'b'.repeat(40);
const sentinel = 'private-release-fixture-value';
const steps = readWorkflowRunSteps(
  '.github/workflows/release.yml',
  'release',
  sentinel,
);
const publishStep = readWorkflowRunStep(
  '.github/workflows/release.yml',
  'release',
  'Verify and publish the certified Knope draft',
  sentinel,
);
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

const successfulRun = {
  conclusion: 'success',
  event: 'push',
  head_branch: 'main',
  head_sha: revision,
  html_url: 'https://example.invalid/run',
  run_number: 1,
  status: 'completed',
};
interface Scenario {
  confirmationFails?: boolean;
  draft?: {
    body?: string;
    draft?: boolean;
    prerelease?: boolean;
    tag_name?: string;
  };
  qualityResponses?: (typeof successfulRun)[][];
  tagSha?: string;
}

const createFixture = (scenario: Scenario = {}) => {
  const jq = spawnSync('/bin/sh', ['-c', 'command -v jq'], {
    encoding: 'utf8',
  });
  if (jq.status !== 0 || !jq.stdout.trim())
    throw new Error(
      'Release command tests require jq on PATH; install it as described in QUALITY.md.',
    );
  const directory = mkdtempSync(path.join(os.tmpdir(), 'evorto-release-'));
  directories.push(directory);
  const bin = path.join(directory, 'bin');
  const temporary = path.join(directory, 'tmp');
  mkdirSync(bin);
  mkdirSync(temporary);
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ version: '1.2.3' }),
  );
  writeFileSync(
    path.join(directory, 'CHANGELOG.md'),
    '# Changelog\n\n## 1.2.3 (2026-09-26)\n\nReviewed changes.\n',
  );
  writeFileSync(
    path.join(directory, 'scenario.json'),
    JSON.stringify(scenario),
  );
  writeFileSync(
    path.join(directory, 'state.json'),
    JSON.stringify({ counts: {}, published: false }),
  );
  writeFileSync(path.join(directory, 'calls.jsonl'), '');
  symlinkSync(jq.stdout.trim(), path.join(bin, 'jq'));
  const stub = String.raw`#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.RELEASE_FIXTURE_DIR;
const scenario = JSON.parse(fs.readFileSync(path.join(root, 'scenario.json'), 'utf8'));
const statePath = path.join(root, 'state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify([tool, ...args]) + '\n');
const expected = process.env.EXPECTED_RELEASE_SHA;
if (tool === 'sleep') process.exit(0);
if (tool === 'git') {
  if (args[0] === 'fetch') process.exit(0);
  if (args[0] === 'rev-parse' && args[1] === 'v1.2.3^{commit}') { console.log(scenario.tagSha || expected); process.exit(0); }
  if (args[0] === 'rev-parse' && args[1] === expected + '^{commit}') { console.log(expected); process.exit(0); }
}
if (tool === 'gh') {
  const endpoint = args.at(-1);
  if (args[0] === 'api' && endpoint.includes('/actions/workflows/')) {
    const count = state.counts[endpoint] || 0;
    state.counts[endpoint] = count + 1;
    fs.writeFileSync(statePath, JSON.stringify(state));
    const responses = scenario.qualityResponses || [[{ conclusion: 'success', event: 'push', head_branch: 'main', head_sha: expected, html_url: 'https://example.invalid/run', run_number: 1, status: 'completed' }]];
    console.log(JSON.stringify({ workflow_runs: responses[Math.min(count, responses.length - 1)] }));
    process.exit(0);
  }
  if (args[0] === 'api' && endpoint === 'repos/fixture/repo/releases/tags/v1.2.3') {
    console.log(JSON.stringify({ body: 'Reviewed release', draft: state.published ? Boolean(scenario.confirmationFails) : true, prerelease: false, tag_name: 'v1.2.3', html_url: 'https://example.invalid/release', ...scenario.draft }));
    process.exit(0);
  }
  if (args[0] === 'release' && args[1] === 'edit') {
    state.published = true;
    fs.writeFileSync(statePath, JSON.stringify(state));
    process.exit(0);
  }
}
console.error('Unexpected fixture command', tool, args);
process.exit(90);
`;
  for (const tool of ['gh', 'git', 'sleep'])
    writeFileSync(path.join(bin, tool), stub, { mode: 0o700 });
  const calls = () =>
    readFileSync(path.join(directory, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const value: unknown = JSON.parse(line);
        if (!Array.isArray(value)) throw new Error('Invalid command trace');
        return value.map((part: unknown) => {
          if (typeof part !== 'string')
            throw new Error('Invalid command argument');
          return part;
        });
      });
  const run = (selectedSteps = steps) => {
    let output = '';
    for (const step of selectedSteps) {
      const result = spawnSync(
        '/bin/bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.script],
        {
          cwd: directory,
          encoding: 'utf8',
          timeout: 5000,
          env: {
            ...step.env,
            EXPECTED_RELEASE_SHA: revision,
            GITHUB_REPOSITORY: 'fixture/repo',
            PATH: `${bin}:/usr/bin:/bin`,
            RELEASE_FIXTURE_DIR: directory,
            TMPDIR: `${temporary}/`,
          },
        },
      );
      if (result.error) throw result.error;
      expect(result.signal).toBeNull();
      output += result.stdout + result.stderr;
      expect(output).not.toContain(sentinel);
      expect(output).not.toContain('Unexpected fixture command');
      if (result.status !== 0) return { output, status: result.status };
    }
    return { output, status: 0 };
  };
  return {
    calls,
    edits: () =>
      calls().filter(
        (call) =>
          call[0] === 'gh' && call[1] === 'release' && call[2] === 'edit',
      ),
    run: () => run(),
    runPublish: () => run([publishStep]),
  };
};

describe('release workflow commands', () => {
  it('publishes the matching reviewed draft after both exact-revision quality gates and confirms the result', () => {
    const fixture = createFixture();
    expect(fixture.run()).toMatchObject({
      status: 0,
      output: expect.stringContaining('https://example.invalid/release'),
    });
    expect(fixture.edits()).toEqual([
      [
        'gh',
        'release',
        'edit',
        'v1.2.3',
        '--draft=false',
        '--latest',
        '--verify-tag',
      ],
    ]);
    expect(
      fixture
        .calls()
        .filter((call) => call[0] === 'git' && call[1] === 'fetch'),
    ).toEqual([
      [
        'git',
        'fetch',
        '--force',
        '--no-tags',
        'origin',
        'refs/tags/v1.2.3:refs/tags/v1.2.3',
      ],
    ]);
  });

  it('refuses a newer failed quality run even when an older run succeeded', () => {
    const fixture = createFixture({
      qualityResponses: [
        [
          successfulRun,
          { ...successfulRun, conclusion: 'failure', run_number: 2 },
        ],
      ],
    });
    expect(fixture.run().status).toBe(1);
    expect(fixture.edits()).toEqual([]);
  });

  it('waits past successful runs for another revision, branch or event', () => {
    const fixture = createFixture({
      qualityResponses: [
        [
          { ...successfulRun, head_sha: otherRevision },
          { ...successfulRun, head_branch: 'feature' },
          { ...successfulRun, event: 'pull_request' },
        ],
        [successfulRun],
      ],
    });
    expect(fixture.run().status).toBe(0);
    expect(
      fixture
        .calls()
        .filter(
          (call) =>
            call[0] === 'gh' && call.at(-1)?.includes('/actions/workflows/'),
        ),
    ).toHaveLength(4);
    expect(fixture.edits()).toHaveLength(1);
  });

  it('refuses a release tag that points to another commit', () => {
    const fixture = createFixture({ tagSha: otherRevision });
    expect(fixture.runPublish().status).toBe(1);
    expect(fixture.edits()).toEqual([]);
  });

  it.each([
    { draft: false },
    { prerelease: true },
    { tag_name: 'v9.9.9' },
    { body: '' },
  ])('refuses an unsuitable release draft: %j', (draft) => {
    const fixture = createFixture({ draft });
    expect(fixture.runPublish().status).toBe(1);
    expect(fixture.edits()).toEqual([]);
  });

  it('fails if GitHub does not confirm publication after the edit', () => {
    const fixture = createFixture({ confirmationFails: true });
    expect(fixture.runPublish().status).toBe(4);
    expect(fixture.edits()).toHaveLength(1);
  });
});
