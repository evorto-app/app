import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const invokeScript = path.join(
  process.cwd(),
  'ops/scaleway/invoke-private-container.sh',
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

const invokeWithFakeCurl = ({
  responseBody,
  status,
}: {
  responseBody: string;
  status: number;
}) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-scaleway-private-invocation-'),
  );
  temporaryDirectories.push(directory);
  const fakeCurlPath = path.join(directory, 'curl');
  const responsePath = path.join(directory, 'response.json');
  fs.writeFileSync(responsePath, responseBody, { mode: 0o600 });
  fs.writeFileSync(
    fakeCurlPath,
    String.raw`#!/usr/bin/env bash
set -euo pipefail
output=''
while (($# > 0)); do
  case "$1" in
    --output)
      output="$2"
      shift 2
      ;;
    --data-binary|--header|--request|--retry|--write-out)
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

  return spawnSync(
    invokeScript,
    ['https://ops.example', '/internal/ops/schema-explain', '{}'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_CURL_RESPONSE: responsePath,
        FAKE_CURL_STATUS: String(status),
        PATH: `${directory}:${process.env['PATH'] ?? ''}`,
        SCW_SECRET_KEY: 'test-only-secret-key',
      },
    },
  );
};

describe('Scaleway private-container invocation', () => {
  it('prints an allowlisted ops diagnostic without the response envelope', () => {
    const result = invokeWithFakeCurl({
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
    const result = invokeWithFakeCurl({
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

  it('returns the successful JSON response', () => {
    const responseBody = JSON.stringify({ safe: true });
    const result = invokeWithFakeCurl({ responseBody, status: 200 });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(responseBody);
    expect(result.stderr).toBe('');
  });
});
