import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const invokeScript = path.join(
  process.cwd(),
  'ops/scaleway/invoke-private-container.sh',
);
const projectId = '00000000-0000-4000-8000-000000000001';
const secretKey = 'test-only-secret-key';
const trustedEndpoints = {
  ops: 'https://evorto-staging-ops.functions.fnc.fr-par.scw.cloud',
  worker: 'https://evorto-staging-worker.functions.fnc.fr-par.scw.cloud',
} as const;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

const invokeWithFakeCurl = ({
  bodyArgument,
  endpoint = trustedEndpoints.ops,
  expectedProjectId = projectId,
  operationPath = '/internal/ops/schema-explain',
  outputProjectId = projectId,
  requestBody = '{}',
  responseBody,
  role = 'ops',
  status,
}: {
  bodyArgument?: string;
  endpoint?: string;
  expectedProjectId?: string;
  operationPath?: string;
  outputProjectId?: string;
  requestBody?: string;
  responseBody: string;
  role?: 'ops' | 'worker';
  status: number;
}) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-scaleway-private-invocation-'),
  );
  temporaryDirectories.push(directory);
  const fakeCurlPath = path.join(directory, 'curl');
  const deliveredBodyPath = path.join(directory, 'delivered-body');
  const deliveredHeadersPath = path.join(directory, 'delivered-headers');
  const environmentPath = path.join(directory, 'curl-environment');
  const invocationPath = path.join(directory, 'curl-invocation');
  const platformOutputPath = path.join(directory, 'platform.json');
  const responsePath = path.join(directory, 'response.json');
  fs.writeFileSync(
    platformOutputPath,
    JSON.stringify({
      containers: {
        ops: {
          endpoint: role === 'ops' ? endpoint : trustedEndpoints.ops,
        },
        worker: {
          endpoint: role === 'worker' ? endpoint : trustedEndpoints.worker,
        },
      },
      project_id: outputProjectId,
    }),
    { mode: 0o600 },
  );
  fs.writeFileSync(responsePath, responseBody, { mode: 0o600 });
  fs.writeFileSync(
    fakeCurlPath,
    String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "${'$'}{FAKE_CURL_INVOCATION:?}"
env > "${'$'}{FAKE_CURL_ENVIRONMENT:?}"
output=''
while (($# > 0)); do
  case "$1" in
    --output)
      output="$2"
      shift 2
      ;;
    --data-binary)
      if [[ "$2" != @* ]]; then
        echo 'request body was not passed through a file' >&2
        exit 90
      fi
      cp "${'$'}{2#@}" "${'$'}{FAKE_CURL_DELIVERED_BODY:?}"
      shift 2
      ;;
    --header)
      if [[ "$2" != @* ]]; then
        echo 'request headers were not passed through a file' >&2
        exit 91
      fi
      cp "${'$'}{2#@}" "${'$'}{FAKE_CURL_DELIVERED_HEADERS:?}"
      shift 2
      ;;
    --request|--retry|--write-out)
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
cp "${'$'}{FAKE_CURL_RESPONSE:?}" "${'$'}{output:?}"
printf '%s' "${'$'}{FAKE_CURL_STATUS:?}"
if ((FAKE_CURL_STATUS >= 400)); then
  exit 22
fi
`,
    { mode: 0o700 },
  );

  const result = spawnSync(
    invokeScript,
    [
      platformOutputPath,
      role,
      operationPath,
      ...(bodyArgument === undefined ? [] : [bodyArgument]),
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_CURL_DELIVERED_BODY: deliveredBodyPath,
        FAKE_CURL_DELIVERED_HEADERS: deliveredHeadersPath,
        FAKE_CURL_ENVIRONMENT: environmentPath,
        FAKE_CURL_INVOCATION: invocationPath,
        FAKE_CURL_RESPONSE: responsePath,
        FAKE_CURL_STATUS: String(status),
        PATH: `${directory}:${process.env['PATH'] ?? ''}`,
        SCW_DEFAULT_PROJECT_ID: expectedProjectId,
        SCW_SECRET_KEY: secretKey,
      },
      input: requestBody,
    },
  );

  return {
    deliveredBody: fs.existsSync(deliveredBodyPath)
      ? fs.readFileSync(deliveredBodyPath, 'utf8')
      : undefined,
    deliveredHeaders: fs.existsSync(deliveredHeadersPath)
      ? fs.readFileSync(deliveredHeadersPath, 'utf8')
      : undefined,
    environment: fs.existsSync(environmentPath)
      ? fs.readFileSync(environmentPath, 'utf8')
      : undefined,
    invocation: fs.existsSync(invocationPath)
      ? fs.readFileSync(invocationPath, 'utf8')
      : undefined,
    result,
  };
};

describe('Scaleway private-container invocation', () => {
  it('does not retry bounded POST operations', () => {
    const script = fs.readFileSync(invokeScript, 'utf8');

    expect(script).not.toContain('--retry');
    expect(script).toMatch(/curl \\\n+\s+--disable/u);
    expect(script).toContain("--noproxy '*'");
    expect(script).toContain("--proto '=https'");
    expect(script).toContain('--header "@${request_headers_file}"');
    expect(script).toContain('--data-binary "@${request_body_file}"');
    expect(script).toMatch(/unset \\\n+\s+ALL_PROXY/u);
    expect(script).not.toContain('readonly body="${4:');
    expect(script).not.toContain('X-Auth-Token: ${SCW_SECRET_KEY}');
    expect(script).not.toContain('--location');
  });

  it('prints an allowlisted ops diagnostic without the response envelope', () => {
    const { result } = invokeWithFakeCurl({
      responseBody: JSON.stringify({
        detail: 'database-authentication-failed',
        error: 'ops-command-failed',
      }),
      status: 500,
    });

    expect(result.status).toBe(22);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('database-authentication-failed');
    expect(result.stderr).not.toContain('ops-command-failed');
  });

  it('does not print arbitrary failure response bodies', () => {
    const { result } = invokeWithFakeCurl({
      responseBody: JSON.stringify({
        detail: 'database-password=must-not-appear',
        error: 'ops-command-failed',
      }),
      status: 500,
    });

    expect(result.status).toBe(22);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Private-container request failed with HTTP 500',
    );
    expect(result.stderr).not.toContain('must-not-appear');
  });

  it('does not accept a redirect as a successful private operation', () => {
    const { result } = invokeWithFakeCurl({
      responseBody: '<html>moved</html>',
      status: 302,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Private-container request failed with HTTP 302',
    );
    expect(result.stderr).not.toContain('moved');
  });

  it('returns the successful JSON response', () => {
    const responseBody = JSON.stringify({ safe: true });
    const { invocation, result } = invokeWithFakeCurl({
      responseBody,
      status: 200,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(responseBody);
    expect(result.stderr).toBe('');
    expect(invocation).toContain(
      `${trustedEndpoints.ops}/internal/ops/schema-explain`,
    );
  });

  it('keeps the secret and request body out of curl arguments and environment', () => {
    const paymentAccountId = 'acct_process_listing_must_not_contain_this';
    const requestBody = JSON.stringify({ accountId: paymentAccountId });
    const { deliveredBody, deliveredHeaders, environment, invocation, result } =
      invokeWithFakeCurl({
        requestBody,
        responseBody: JSON.stringify({ attached: true }),
        status: 200,
      });

    expect(result.status).toBe(0);
    expect(invocation).toBeDefined();
    expect(invocation).not.toContain(secretKey);
    expect(invocation).not.toContain(paymentAccountId);
    expect(invocation).not.toContain(requestBody);
    expect(environment).toBeDefined();
    expect(environment).not.toContain(secretKey);
    expect(environment).not.toContain(paymentAccountId);
    expect(environment).not.toMatch(
      /^(?:(?:ALL|HTTPS?)_PROXY|(?:all|https?)_proxy)=/mu,
    );
    expect(environment).not.toMatch(/^SCW_SECRET_KEY=/mu);
    expect(deliveredBody).toBe(requestBody);
    expect(deliveredHeaders).toBe(
      `Content-Type: application/json\nX-Auth-Token: ${secretKey}\n`,
    );

    const curlArguments = invocation?.trimEnd().split('\n') ?? [];
    expect(curlArguments).toEqual(expect.arrayContaining(['--noproxy', '*']));
    for (const option of ['--header', '--data-binary', '--output']) {
      const optionIndex = curlArguments.indexOf(option);
      expect(optionIndex).toBeGreaterThanOrEqual(0);
      const fileArgument = curlArguments[optionIndex + 1];
      expect(fileArgument).toBeDefined();
      expect(fs.existsSync(fileArgument?.replace(/^@/u, '') ?? '')).toBe(false);
    }
  });

  it('refuses a non-object standard-input body before invoking curl', () => {
    const { invocation, result } = invokeWithFakeCurl({
      requestBody: '"acct_must_not_be_reported"',
      responseBody: '{}',
      status: 200,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Private-container input must be a JSON object',
    );
    expect(result.stderr).not.toContain('acct_must_not_be_reported');
    expect(invocation).toBeUndefined();
  });

  it('refuses the retired request-body argument before invoking curl', () => {
    const { invocation, result } = invokeWithFakeCurl({
      bodyArgument: '{"accountId":"acct_legacy_argument"}',
      responseBody: '{}',
      status: 200,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'send the JSON body through standard input',
    );
    expect(result.stderr).not.toContain('acct_legacy_argument');
    expect(invocation).toBeUndefined();
  });

  it('refuses an arbitrary HTTPS endpoint before invoking curl', () => {
    const { invocation, result } = invokeWithFakeCurl({
      endpoint: 'https://evil.example',
      responseBody: '{}',
      status: 200,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Refusing to send credentials to an untrusted private-container endpoint',
    );
    expect(invocation).toBeUndefined();
  });

  it.each([
    `${trustedEndpoints.ops}.evil.example`,
    `https://${trustedEndpoints.ops.slice('https://'.length)}@evil.example`,
    `${trustedEndpoints.ops}/extra-path`,
  ])('refuses a confusing or path-bearing hostname: %s', (endpoint) => {
    const { invocation, result } = invokeWithFakeCurl({
      endpoint,
      responseBody: '{}',
      status: 200,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Refusing to send credentials to an untrusted private-container endpoint',
    );
    expect(invocation).toBeUndefined();
  });

  it('refuses Terraform output from a different project before invoking curl', () => {
    const { invocation, result } = invokeWithFakeCurl({
      outputProjectId: '00000000-0000-4000-8000-000000000002',
      responseBody: '{}',
      status: 200,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Refusing to call a private container from unverified Terraform output',
    );
    expect(invocation).toBeUndefined();
  });

  it('binds payment setup to the worker endpoint', () => {
    const { invocation, result } = invokeWithFakeCurl({
      endpoint: trustedEndpoints.worker,
      operationPath: '/internal/worker/payment-setup',
      responseBody: JSON.stringify({ attached: true }),
      role: 'worker',
      status: 200,
    });

    expect(result.status).toBe(0);
    expect(invocation).toContain(
      `${trustedEndpoints.worker}/internal/worker/payment-setup`,
    );
  });

  it('refuses a worker operation on the ops endpoint before invoking curl', () => {
    const { invocation, result } = invokeWithFakeCurl({
      operationPath: '/internal/worker/payment-setup',
      responseBody: '{}',
      status: 200,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Refusing to call an unexpected private-container operation',
    );
    expect(invocation).toBeUndefined();
  });
});
