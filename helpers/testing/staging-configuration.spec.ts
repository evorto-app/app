import { afterEach, describe, expect, it } from '@effect/vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readWorkflowRunStep } from './workflow-step-fixture';

const project = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const uuid = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
const role = (name: string, digit: string) => ({
  endpoint: `https://evorto-staging-${name}.functions.fnc.fr-par.scw.cloud`,
  environment_variables: {
    APP_ENVIRONMENT: 'staging',
    APP_ROLE: name,
    BASE_URL: 'https://staging.evorto.app',
  },
  id: `fr-par/${uuid(digit)}`,
});
const configuration = () => ({
  database: {
    certificate:
      '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----',
    database_name: 'evorto',
    host: '172.16.4.2',
    port: 5432,
    runtime_user: 'application_runtime',
    schema_user: 'schema_owner',
  },
  environment: 'staging',
  platform: {
    application_bucket: 'evorto-staging-application-fixture',
    containers: {
      ops: role('ops', '1'),
      web: role('web', '2'),
      worker: role('worker', '3'),
    },
    deployment_metadata_bucket: 'evorto-staging-deployment-fixture',
    project_id: project,
    role_secret_ids: { 'web/DATABASE_URL': uuid('4') },
  },
  version: 1,
});
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});
const run = (
  value: ReturnType<typeof configuration>,
  digestOverride?: string,
) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'evorto-staging-config-'));
  directories.push(directory);
  const input = path.join(directory, 'configuration.json');
  const output = path.join(directory, 'output');
  const body = JSON.stringify(value);
  writeFileSync(input, body);
  const digest = createHash('sha256').update(body).digest('hex');
  const result = spawnSync(
    'bash',
    [
      'ops/scaleway/read-staging-configuration.sh',
      input,
      digestOverride ?? digest,
      output,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        SCW_DEFAULT_PROJECT_ID: project,
        STRIPE_TEST_ACCOUNT_ID: 'acct_fixture',
      },
      timeout: 5000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return { output, result };
};

describe('accepted staging deployment configuration', () => {
  it.each(['10.0.0.2', '172.16.4.2', '172.31.255.254', '192.168.4.2'])(
    'exports a verified snapshot with private database host %s',
    (host) => {
      const value = configuration();
      value.database.host = host;
      const { output, result } = run(value);
      expect(result.status).toBe(0);
      expect(
        JSON.parse(readFileSync(path.join(output, 'platform.json'), 'utf8')),
      ).toMatchObject({
        containers: {
          ops: {
            environment_variables: { STRIPE_TEST_ACCOUNT_ID: 'acct_fixture' },
          },
        },
        project_id: project,
      });
      expect(
        JSON.parse(readFileSync(path.join(output, 'database.json'), 'utf8')),
      ).toEqual(value.database);
    },
  );

  it('rejects a snapshot whose content no longer matches its immutable key', () => {
    const { output, result } = run(configuration(), '0'.repeat(64));
    expect(result.status).toBe(1);
    expect(existsSync(output)).toBe(false);
  });

  it.each([
    {
      name: 'production',
      mutate: (c: ReturnType<typeof configuration>) => {
        c.environment = 'production';
      },
    },
    {
      name: 'another project',
      mutate: (c: ReturnType<typeof configuration>) => {
        c.platform.project_id = uuid('5');
      },
    },
    {
      name: 'a production container',
      mutate: (c: ReturnType<typeof configuration>) => {
        c.platform.containers.web.environment_variables.APP_ENVIRONMENT =
          'production';
      },
    },
    {
      name: 'an unrelated endpoint',
      mutate: (c: ReturnType<typeof configuration>) => {
        c.platform.containers.ops.endpoint = 'https://example.com';
      },
    },
    {
      name: 'a duplicate container',
      mutate: (c: ReturnType<typeof configuration>) => {
        c.platform.containers.ops.id = c.platform.containers.web.id;
      },
    },
    {
      name: 'a public database',
      mutate: (c: ReturnType<typeof configuration>) => {
        c.database.host = '8.8.8.8';
      },
    },
    {
      name: 'an invalid private address',
      mutate: (c: ReturnType<typeof configuration>) => {
        c.database.host = '10.0.0.999';
      },
    },
    {
      name: 'a public 172 address',
      mutate: (c: ReturnType<typeof configuration>) => {
        c.database.host = '172.32.0.1';
      },
    },
    {
      name: 'a missing database certificate',
      mutate: (c: ReturnType<typeof configuration>) => {
        c.database.certificate = '';
      },
    },
  ])('rejects $name before writing deployment inputs', ({ mutate }) => {
    const value = configuration();
    mutate(value);
    const { output, result } = run(value);
    expect(result.status).toBe(1);
    expect(existsSync(output)).toBe(false);
  });
});

describe('automatic staging eligibility', () => {
  const guard = readWorkflowRunStep(
    '.github/workflows/scaleway-staging.yml',
    'resolve-revision',
    'Resolve exact current main SHA',
    'fixture',
  );

  it.each([
    { quality: 'success', baseline: 'success', current: true, deploy: true },
    { quality: 'pending', baseline: 'success', current: true, deploy: false },
    { quality: 'success', baseline: 'pending', current: true, deploy: false },
    { quality: 'failure', baseline: 'success', current: true, deploy: false },
    { quality: 'success', baseline: 'failure', current: true, deploy: false },
    { quality: 'success', baseline: 'success', current: false, deploy: false },
  ])('requires both successful checks on current main: %j', (scenario) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'evorto-staging-gates-'));
    directories.push(directory);
    const output = path.join(directory, 'output');
    const result = spawnSync(
      'bash',
      [
        '-eu',
        '-c',
        `
gh() {
  case "$*" in
    *commits/main*) printf '%s\\n' "$CURRENT_REVISION" ;;
    *pr-quality.yml*) printf '%s\\n' "$QUALITY_CONCLUSION" ;;
    *e2e-baseline.yml*) printf '%s\\n' "$BASELINE_CONCLUSION" ;;
    *) return 99 ;;
  esac
}
${guard.script}`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...guard.env,
          BASELINE_CONCLUSION: scenario.baseline,
          CURRENT_REVISION: (scenario.current ? 'a' : 'b').repeat(40),
          GITHUB_OUTPUT: output,
          GITHUB_REPOSITORY: 'fixture/app',
          QUALITY_CONCLUSION: scenario.quality,
          REQUESTED_REVISION: 'a'.repeat(40),
        },
        timeout: 5000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toContain(
      `deploy=${String(scenario.deploy)}\n`,
    );
  });
});
