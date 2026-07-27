import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const probeScript = path.join(
  repositoryRoot,
  'ops/scaleway/probe-http-latency.sh',
);

const closeServer = async (
  server: ReturnType<typeof createServer>,
): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

describe('staging latency observability', () => {
  it('records warm samples and enforces only critical latency on request', async () => {
    let eventRequestCount = 0;
    let eventUpstreamServiceMs = 200;
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
        response.setHeader(
          'X-Envoy-Upstream-Service-Time',
          String(eventUpstreamServiceMs),
        );
        response.setHeader('X-Request-Id', `request-${eventRequestCount}`);
        response.end('<html><app-root></app-root></html>');
        return;
      }

      response.statusCode = 404;
      response.end('not found');
    });
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'evorto-latency-probe-'),
    );

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
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
        origin,
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

      eventUpstreamServiceMs = 1601;
      const criticalReportPath = path.join(temporaryDirectory, 'critical.json');
      await expect(
        executeFile('bash', [
          probeScript,
          '--origin',
          origin,
          '--output',
          criticalReportPath,
          '--warm-samples',
          '1',
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
            p95: 1601,
            status: 'critical',
          },
        },
      });
    } finally {
      await closeServer(server);
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

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
      'Server.resolveUserAttributes',
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
      'for required_command in awk curl date dirname grep jq mkdir mktemp mv rm; do',
    );
  });
});
