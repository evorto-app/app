import { spawn } from 'node:child_process';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bunExecutable = (() => {
  const searchPath = process.env['PATH'];
  if (!searchPath) throw new Error('The latency fixture requires Bun on PATH');
  for (const directory of searchPath.split(path.delimiter)) {
    try {
      const candidate = realpathSync(path.resolve(directory, 'bun'));
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' ||
          error.code === 'ENOTDIR' ||
          error.code === 'EACCES')
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('The latency fixture requires an executable Bun on PATH');
})();
const timeoutHelper = fileURLToPath(
  new URL('./run-with-wall-clock-timeout.ts', import.meta.url),
);

const executeFile = async (
  command: 'bash',
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
) => {
  if (process.platform === 'win32') {
    throw new Error('The Bash latency fixture requires POSIX process groups');
  }

  const child = spawn(
    bunExecutable,
    [timeoutHelper, '6', '1', command, ...args],
    { env: environment, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const processFailures: unknown[] = [];
  const completion = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.once('error', (error) => processFailures.push(error));
  child.stdin.once('error', (error) => processFailures.push(error));
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout = (stdout + chunk).slice(-65_536);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-65_536);
  });
  child.stdout.once('error', (error) => processFailures.push(error));
  child.stderr.once('error', (error) => processFailures.push(error));
  try {
    child.stdin.end();
  } catch (error) {
    processFailures.push(error);
  }

  const deadline = setTimeout(() => {
    processFailures.push(
      new Error(
        'Latency timeout helper did not close and drain within 9 seconds',
      ),
    );
  }, 9000);
  try {
    // Close includes captured stream closure. A missed observation deadline
    // remains a failure while the owner continues waiting for that settlement.
    const { code, signal } = await completion;
    const failures: unknown[] = [];
    if (signal !== null || code === null || code < 0 || code > 255) {
      failures.push(
        Object.assign(new Error('Latency timeout helper exited abnormally'), {
          code,
          signal,
          stderr,
          stdout,
        }),
      );
    } else if (code !== 0) {
      failures.push(
        Object.assign(
          new Error(
            code === 124
              ? 'Latency probe exceeded its 6 second budget'
              : 'Latency probe exited unsuccessfully',
          ),
          { code, stderr, stdout },
        ),
      );
    }
    failures.push(...processFailures);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'Latency probe or timeout helper failed',
        {
          cause: failures[0],
        },
      );
    }
    return { stderr, stdout };
  } finally {
    clearTimeout(deadline);
  }
};

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const probeScript = path.join(
  repositoryRoot,
  'ops/scaleway/probe-http-latency.sh',
);

const closeServer = async (server: ReturnType<typeof createServer>) => {
  if (!server.listening) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Latency fixture server did not close')),
        2000,
      );
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      server.closeAllConnections();
    });
  } finally {
    clearTimeout(timeout);
  }
};

describe('staging latency observability', () => {
  it('rejects non-origin inputs before making any network request', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'evorto-origin-'));
    const requestMarker = path.join(directory, 'request');
    const reportPath = path.join(directory, 'report.json');
    try {
      await writeFile(
        path.join(directory, 'curl'),
        '#!/bin/sh\nprintf request > "$LATENCY_REQUEST_MARKER"\nexit 97\n',
        { mode: 0o700 },
      );
      for (const origin of [
        'https://staging.example.test/other',
        'https://staging.example.test/../',
        'https://staging.example.test//',
        'https://staging.example.test?token=example',
        'https://staging.example.test#fragment',
        'https://user:example@staging.example.test',
        'https://staging.example.test\\other',
        'https://staging.example.test\t',
        'https://staging.example.test\n',
        'https://staging.example.test\r',
        'https://staging.example.test\u0001',
        'https://staging.example.test\u007f',
        'https://staging.example.test:',
        'https://staging.example.test:65536',
        'https://staging.example.test:invalid',
        'https://staging.example.test.',
        'https:///staging.example.test',
        'https://',
        'https://[invalid]',
        'file://staging.example.test',
      ]) {
        await expect(
          executeFile(
            'bash',
            [probeScript, '--origin', origin, '--output', reportPath],
            {
              ...process.env,
              LATENCY_REQUEST_MARKER: requestMarker,
              PATH: `${directory}${path.delimiter}${process.env['PATH'] ?? ''}`,
            },
          ),
          origin,
        ).rejects.toMatchObject({
          code: 64,
          stderr: expect.stringContaining('--origin must be'),
        });
        await expect(readFile(requestMarker)).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await expect(readFile(reportPath)).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('records warm samples and enforces only critical latency on request', async () => {
    let eventRequestCount = 0;
    let eventUpstreamServiceMs = 200;
    let transportFailureAtEventRequest: number | undefined;
    let missingUpstreamAtEventRequest: number | undefined;
    const server = createServer((request, response) => {
      if (request.url === '/version') {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            environment: 'staging',
            imageDigest: `sha256:${'b'.repeat(64)}`,
            revision: 'a'.repeat(40),
          }),
        );
        return;
      }
      if (request.url === '/healthz') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (request.url === '/events') {
        eventRequestCount += 1;
        if (eventRequestCount === transportFailureAtEventRequest) {
          request.socket.destroy();
          return;
        }
        if (eventRequestCount !== missingUpstreamAtEventRequest) {
          response.setHeader(
            'X-Envoy-Upstream-Service-Time',
            String(eventUpstreamServiceMs),
          );
        }
        response.setHeader('X-Request-Id', `request-${eventRequestCount}`);
        response.end('<html><app-root></app-root></html>');
        return;
      }

      response.statusCode = 404;
      response.end('not found');
    });
    let temporaryDirectory: string | undefined;
    const failures: unknown[] = [];

    try {
      temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), 'evorto-latency-probe-'),
      );
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected the latency fixture to use a TCP port');
      }
      const origin = `http://127.0.0.1:${address.port}`;
      const reportPath = path.join(temporaryDirectory, 'report.json');
      const summaryPath = path.join(temporaryDirectory, 'summary.md');

      await executeFile('bash', [
        probeScript,
        '--origin',
        `${origin}/`,
        '--output',
        reportPath,
        '--summary-output',
        summaryPath,
        '--warm-samples',
        '4',
        '--mode',
        'report-only',
        '--vantage',
        'test-runner',
      ]);

      const report: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
      expect(report).toMatchObject({
        deployment: {
          environment: 'staging',
          imageDigest: `sha256:${'b'.repeat(64)}`,
          revision: 'a'.repeat(40),
        },
        mode: 'report-only',
        schemaVersion: 1,
        summary: {
          contentFailures: 0,
          expectedWarmCandidateCount: 4,
          overallStatus: 'within_budget',
          upstreamServiceMs: {
            max: 200,
            measuredCount: 4,
            p50: 200,
            p95: 200,
            status: 'within_budget',
          },
          warmCandidateCount: 4,
        },
        targetOrigin: origin,
        vantage: 'test-runner',
      });
      expect(await readFile(summaryPath, 'utf8')).toContain(
        '| Upstream service | 200 ms | 200 ms | 200 ms | within_budget |',
      );

      for (const mode of ['report-only', 'enforce-critical']) {
        missingUpstreamAtEventRequest = eventRequestCount + 2;
        const partialReportPath = path.join(
          temporaryDirectory,
          `partial-${mode}.json`,
        );
        const partialSummaryPath = path.join(
          temporaryDirectory,
          `partial-${mode}.md`,
        );
        const operation = executeFile('bash', [
          probeScript,
          '--origin',
          origin,
          '--output',
          partialReportPath,
          '--summary-output',
          partialSummaryPath,
          '--warm-samples',
          '4',
          '--mode',
          mode,
        ]);
        if (mode === 'enforce-critical') {
          await expect(operation).rejects.toMatchObject({ code: 3 });
        } else {
          await operation;
        }
        const partialReport: unknown = JSON.parse(
          await readFile(partialReportPath, 'utf8'),
        );
        expect(partialReport).toMatchObject({
          summary: {
            contentFailures: 0,
            expectedWarmCandidateCount: 4,
            warmCandidateCount: 4,
            overallStatus: 'insufficient',
            upstreamServiceMs: {
              measuredCount: 3,
              p95: 200,
              status: 'insufficient',
            },
          },
        });
        expect(await readFile(partialSummaryPath, 'utf8')).toContain(
          '- Upstream timing samples: 3/4',
        );
      }

      transportFailureAtEventRequest = eventRequestCount + 2;
      const transportReportPath = path.join(
        temporaryDirectory,
        'transport.json',
      );
      const transportSummaryPath = path.join(
        temporaryDirectory,
        'transport.md',
      );
      await expect(
        executeFile('bash', [
          probeScript,
          '--origin',
          origin,
          '--output',
          transportReportPath,
          '--summary-output',
          transportSummaryPath,
          '--warm-samples',
          '2',
          '--mode',
          'report-only',
          '--vantage',
          'test-runner',
        ]),
      ).rejects.toMatchObject({ code: 1 });
      const transportReport: unknown = JSON.parse(
        await readFile(transportReportPath, 'utf8'),
      );
      expect(transportReport).toEqual(
        expect.objectContaining({
          samples: expect.arrayContaining([
            expect.objectContaining({
              contentValid: false,
              kind: 'warm_candidate',
              sequence: 1,
              statusCode: 0,
            }),
            expect.objectContaining({
              contentValid: true,
              kind: 'warm_candidate',
              sequence: 2,
              statusCode: 200,
            }),
          ]),
          summary: expect.objectContaining({
            contentFailures: 1,
            overallStatus: 'critical',
            warmCandidateCount: 2,
          }),
        }),
      );
      expect(await readFile(transportSummaryPath, 'utf8')).toContain(
        '- Overall status: `critical`',
      );

      eventUpstreamServiceMs = 1601;
      missingUpstreamAtEventRequest = eventRequestCount + 2;
      const criticalReportPath = path.join(temporaryDirectory, 'critical.json');
      await expect(
        executeFile('bash', [
          probeScript,
          '--origin',
          origin,
          '--output',
          criticalReportPath,
          '--warm-samples',
          '2',
          '--mode',
          'enforce-critical',
          '--vantage',
          'test-runner',
        ]),
      ).rejects.toMatchObject({ code: 2 });
      const criticalReport: unknown = JSON.parse(
        await readFile(criticalReportPath, 'utf8'),
      );
      expect(criticalReport).toMatchObject({
        summary: {
          overallStatus: 'critical',
          upstreamServiceMs: {
            measuredCount: 1,
            p95: 1601,
            status: 'critical',
          },
        },
      });
    } catch (error) {
      failures.push(error);
    } finally {
      const cleanupResults = await Promise.allSettled([
        closeServer(server),
        temporaryDirectory === undefined
          ? Promise.resolve()
          : rm(temporaryDirectory, { force: true, recursive: true }),
      ]);
      for (const result of cleanupResults) {
        if (result.status === 'rejected') failures.push(result.reason);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Latency fixture cleanup failed', {
        cause: failures[0],
      });
    }
  }, 30_000);

  it('keeps the diagnosed server boundaries available as stable trace names', async () => {
    const sources = await Promise.all(
      [
        'src/server.ts',
        'src/server/auth/auth-session.ts',
        'src/server/context/http-request-context.ts',
        'src/server/context/request-context-resolver.ts',
        'src/server/effect/rpc/app-rpcs.web-handler.ts',
        'src/server/effect/rpc/handlers/events/events-query.handlers.ts',
      ].map((sourcePath) =>
        readFile(path.join(repositoryRoot, sourcePath), 'utf8'),
      ),
    );
    const source = sources.join('\n');

    for (const spanName of [
      'Angular.handle',
      'Db.events.eventList',
      'Server.loadAuthSession',
      'Server.renderSsr',
      'Server.resolveHttpRequestContext',
      'Server.resolveTenantContext',
      'Server.resolveUserContext',
      'Server.resolveUserOnboarding',
    ]) {
      expect(source, spanName).toContain(`'${spanName}'`);
    }
    expect(source).toContain("{ spanPrefix: 'Rpc' }");
    expect(source).toContain("'evorto.events.initial_page'");
    expect(source).toContain("'evorto.events.page_size_bucket'");
    expect(source).not.toContain("'evorto.events.limit'");
    expect(source).not.toContain("'evorto.events.offset'");
  });

  it('checks every external command used by the latency probe', async () => {
    const source = await readFile(probeScript, 'utf8');

    expect(source).toContain(
      'for required_command in awk curl date dirname grep jq mkdir mktemp mv node rm; do',
    );
  });

  it('marks planned trace signals as inactive in the monitoring runbook', async () => {
    const runbook = await readFile(
      path.join(
        repositoryRoot,
        'infrastructure/scaleway/LATENCY_MONITORING.md',
      ),
      'utf8',
    );

    expect(runbook).toContain('`Rpc.config.bootstrap` remains planned');
    expect(runbook).not.toContain('| `config.bootstrap` trace p95');
  });
});
