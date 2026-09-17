import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const releaseGateScript = path.join(
  process.cwd(),
  'ops/scaleway/require-release-gates.sh',
);
const revision = 'a'.repeat(40);
const temporaryDirectories: string[] = [];

interface WorkflowRun {
  conclusion: 'failure' | 'success';
  created_at: string;
  event: 'push' | 'workflow_dispatch';
  head_branch: string;
  head_sha: string;
  html_url: string;
  id: number;
  run_attempt: number;
  run_number: number;
  status: 'completed';
}

const workflowRun = (
  id: number,
  conclusion: WorkflowRun['conclusion'],
  overrides: Partial<WorkflowRun> = {},
): WorkflowRun => ({
  conclusion,
  created_at: `2026-07-26T17:${String(id).padStart(2, '0')}:00Z`,
  event: 'push',
  head_branch: 'main',
  head_sha: revision,
  html_url: `https://example.test/runs/${id}`,
  id,
  run_attempt: 1,
  run_number: id,
  status: 'completed',
  ...overrides,
});

const runReleaseGates = ({
  baselineRuns,
  qualityRuns,
}: {
  baselineRuns: WorkflowRun[];
  qualityRuns: WorkflowRun[];
}) => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'evorto-release-gates-'),
  );
  temporaryDirectories.push(directory);
  const fakeGhPath = path.join(directory, 'gh');
  writeFileSync(
    fakeGhPath,
    String.raw`#!/usr/bin/env bash
set -euo pipefail
request=''
for argument in "${'$'}@"; do
  case "${'$'}{argument}" in
    repos/*)
      request="${'$'}{argument}"
      ;;
  esac
done
case "${'$'}{request}" in
  */actions/workflows/pr-quality.yml/runs)
    printf '%s' "${'$'}{FAKE_QUALITY_RUNS:?}"
    ;;
  */actions/workflows/e2e-baseline.yml/runs)
    printf '%s' "${'$'}{FAKE_BASELINE_RUNS:?}"
    ;;
  */actions/runs/*/jobs)
    printf '%s' '{"jobs":[{"name":"CI/gate","conclusion":"success"},{"name":"Playwright E2E (functional + docs)","conclusion":"success"}]}'
    ;;
  *)
    echo "Unexpected fake GitHub API request: ${'$'}{request}" >&2
    exit 1
    ;;
esac
`,
  );
  chmodSync(fakeGhPath, 0o700);

  return spawnSync(releaseGateScript, [revision], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FAKE_BASELINE_RUNS: JSON.stringify({ workflow_runs: baselineRuns }),
      FAKE_QUALITY_RUNS: JSON.stringify({ workflow_runs: qualityRuns }),
      GITHUB_REPOSITORY: 'evorto-app/app',
      GITHUB_TOKEN: 'test-token',
      PATH: `${directory}:${process.env['PATH'] ?? ''}`,
    },
  });
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Scaleway release gates', () => {
  it('rejects the latest completed exact-SHA failure instead of using an older success', () => {
    const result = runReleaseGates({
      baselineRuns: [workflowRun(3, 'success')],
      qualityRuns: [workflowRun(1, 'success'), workflowRun(2, 'failure')],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `Latest completed PR Quality run for ${revision} concluded failure`,
    );
    expect(result.stdout).toBe('');
  });

  it('accepts the latest completed exact-SHA success for both workflows', () => {
    const result = runReleaseGates({
      baselineRuns: [workflowRun(3, 'success')],
      qualityRuns: [workflowRun(1, 'failure'), workflowRun(2, 'success')],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `Exact-SHA release gates passed for ${revision}`,
    );
    expect(result.stderr).toBe('');
  });

  it('ignores newer runs for another revision or event', () => {
    const result = runReleaseGates({
      baselineRuns: [workflowRun(3, 'success')],
      qualityRuns: [
        workflowRun(1, 'failure'),
        workflowRun(2, 'success', { head_sha: 'b'.repeat(40) }),
        workflowRun(3, 'success', { event: 'workflow_dispatch' }),
      ],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `Latest completed PR Quality run for ${revision} concluded failure`,
    );
  });
});
