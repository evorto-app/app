import { describe, expect, it } from '@effect/vitest';
import { spawnSync } from 'node:child_process';

import { readWorkflowRunStep } from './workflow-step-fixture';

const sentinel = 'private-provider-fixture-value';
const readGuard = (path: string, jobName: string, stepName: string) =>
  readWorkflowRunStep(path, jobName, stepName, sentinel);

const runGuard = (
  guard: ReturnType<typeof readGuard>,
  overrides: Record<string, string>,
) => {
  const result = spawnSync(
    '/bin/bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', guard.script],
    {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', ...guard.env, ...overrides },
      timeout: 5000,
    },
  );
  if (result.error) throw result.error;
  expect(result.signal).toBeNull();
  expect(result.stdout + result.stderr).not.toContain(sentinel);
  return result;
};

const workflows = [
  {
    name: 'baseline',
    path: '.github/workflows/e2e-baseline.yml',
    job: 'e2e',
    refGuard: 'Reject unprotected E2E refs',
    refVariable: 'E2E_REF',
    protectedVariable: 'E2E_REF_PROTECTED',
    configurationGuard: 'Validate required configuration',
  },
  {
    name: 'provider certification',
    path: '.github/workflows/esncard-release-certification.yml',
    job: 'certify',
    refGuard: 'Reject unprotected certification refs',
    refVariable: 'CERTIFICATION_REF',
    protectedVariable: 'CERTIFICATION_REF_PROTECTED',
    configurationGuard:
      'Validate required provider certification configuration',
  },
];

describe('credential-backed workflow guards', () => {
  it.each(workflows)('$name permits only protected main refs', (workflow) => {
    const guard = readGuard(
      workflow.path,
      'validate-protected-ref',
      workflow.refGuard,
    );
    for (const [ref, protectedRef, status] of [
      ['refs/heads/main', 'true', 0],
      ['refs/heads/feature', 'true', 1],
      ['refs/heads/main', 'false', 1],
      ['', 'true', 1],
    ] as const) {
      expect(
        runGuard(guard, {
          [workflow.refVariable]: ref,
          [workflow.protectedVariable]: protectedRef,
        }).status,
      ).toBe(status);
    }
  });

  it.each(workflows)(
    '$name rejects incomplete credentials and live Stripe keys before provider work',
    (workflow) => {
      const guard = readGuard(
        workflow.path,
        workflow.job,
        workflow.configurationGuard,
      );
      const valid = { STRIPE_TEST_API_KEY: `sk_test_${sentinel}` };
      expect(runGuard(guard, valid).status).toBe(0);
      const live = runGuard(guard, {
        STRIPE_TEST_API_KEY: `sk_live_${sentinel}`,
      });
      expect(live.status).toBe(1);
      expect(live.stdout).toContain('STRIPE_TEST_API_KEY');
      for (const missing of ['CLIENT_SECRET', 'E2E_ADMIN_USER_PASSWORD']) {
        const incomplete = runGuard(guard, { ...valid, [missing]: '' });
        expect(incomplete.status).toBe(1);
        expect(incomplete.stdout).toContain(missing);
      }
    },
  );
});
