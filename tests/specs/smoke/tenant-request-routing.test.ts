import { once } from 'node:events';
import {
  createServer,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';

import { expect, test, type BrowserContext } from '@playwright/test';

import { localTestTenantDomainHeader } from '../../../src/shared/request-routing';
import {
  closeTenantRequestContext,
  routeLocalTenantRequests,
  stopTenantRequestRouting,
} from '../../support/utils/tenant-request-routing';

interface ListeningServer {
  readonly close: () => Promise<void>;
  readonly origin: string;
}

const listen = async (listener: RequestListener): Promise<ListeningServer> => {
  const server: Server = createServer(listener);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    await close(server);
    throw new Error('Expected a local HTTP server address');
  }

  return {
    close: () => close(server),
    origin: `http://127.0.0.1:${address.port}`,
  };
};

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

test('keeps the local tenant header away from external requests', async ({
  browser,
}) => {
  const receivedTenant = (
    headers: Readonly<Record<string, unknown>>,
  ): string =>
    typeof headers[localTestTenantDomainHeader] === 'string'
      ? headers[localTestTenantDomainHeader]
      : 'none';
  const external = await listen((request, response) => {
    response.end(receivedTenant(request.headers));
  });
  let local: ListeningServer | undefined;
  let context: BrowserContext | undefined;
  const errors: unknown[] = [];

  try {
    local = await listen((request, response) => {
      if (request.url === '/iframe') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(
          `<iframe title="Local storage" src="${external.origin}/embedded"></iframe>`,
        );
        return;
      }
      if (request.url === '/redirect') {
        response.writeHead(302, { location: `${external.origin}/redirected` });
        response.end();
        return;
      }
      response.end(receivedTenant(request.headers));
    });
    context = await browser.newContext();
    await routeLocalTenantRequests({
      baseUrl: local.origin,
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    const page = await context.newPage();

    await page.goto(`${local.origin}/tenant`);
    await expect(page.locator('body')).toHaveText('north-river.evorto.app');

    const embeddedResponse = page.waitForResponse(
      `${external.origin}/embedded`,
    );
    await page.goto(`${local.origin}/iframe`);
    expect((await embeddedResponse).status()).toBe(200);
    await expect(
      page.frameLocator('iframe[title="Local storage"]').locator('body'),
    ).toHaveText('none');

    await page.goto(`${external.origin}/direct`);
    await expect(page.locator('body')).toHaveText('none');

    await page.goto(`${local.origin}/redirect`);
    await expect(page).toHaveURL(`${external.origin}/redirected`);
    await expect(page.locator('body')).toHaveText('none');
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      if (context) await closeTenantRequestContext(context);
    } catch (error) {
      errors.push(error);
    }
    const serverClosures = await Promise.allSettled([
      ...(local ? [local.close()] : []),
      external.close(),
    ]);
    for (const closure of serverClosures) {
      if (closure.status === 'rejected') errors.push(closure.reason);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'Tenant request routing smoke test and cleanup failed',
      { cause: errors[0] },
    );
  }
});

test('drains concurrent tenant requests before unregistering the handler', async ({
  browser,
}) => {
  const responses = new Map<string, ServerResponse>();
  const started = Promise.withResolvers<void>();
  const received: string[] = [];
  const local = await listen((request, response) => {
    const path = request.url ?? '/';
    received.push(path);
    if (path === '/first' || path === '/second') {
      if (responses.has(path)) {
        response.end('unexpected duplicate request');
        return;
      }
      responses.set(path, response);
      if (responses.size === 2) started.resolve();
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end('<body>Local routing regression</body>');
  });
  let context: BrowserContext | undefined;
  const errors: unknown[] = [];
  try {
    context = await browser.newContext();
    await routeLocalTenantRequests({
      baseUrl: local.origin,
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    const page = await context.newPage();
    await page.goto(local.origin);
    const completed = page.evaluate(async () =>
      Promise.all(
        ['/first', '/second'].map(async (path) => (await fetch(path)).text()),
      ),
    );
    await started.promise;
    const stopped = stopTenantRequestRouting(context);
    const lateRequest = await page.evaluate(async () => {
      try {
        await fetch('/late');
        return 'unexpectedly admitted';
      } catch {
        return 'aborted during cleanup';
      }
    });
    expect(lateRequest).toBe('aborted during cleanup');
    expect(received).not.toContain('/late');
    const firstCompleted = page.waitForResponse(`${local.origin}/first`);
    responses.get('/first')?.end('first completed');
    await (await firstCompleted).finished();
    // A browser protocol round trip lets the first route complete while its
    // sibling is still inside route.fetch, reproducing the teardown ordering.
    await page.title();
    responses.get('/second')?.end('second completed');
    await stopped;
    expect(await completed).toEqual(['first completed', 'second completed']);
    expect(
      received.filter((path) => path === '/first' || path === '/second'),
    ).toEqual(['/first', '/second']);
  } catch (error) {
    errors.push(error);
  } finally {
    for (const response of responses.values()) {
      if (!response.writableEnded) response.end('cleanup');
    }
    try {
      if (context) await closeTenantRequestContext(context);
    } catch (error) {
      errors.push(error);
    }
    try {
      await local.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      'Concurrent tenant routing test and cleanup failed',
      { cause: errors[0] },
    );
});

test('preserves unrelated context and page handlers after tenant routing stops', async ({
  browser,
}) => {
  const local = await listen((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<body>Local routing regression</body>');
  });
  let context: BrowserContext | undefined;
  const errors: unknown[] = [];
  try {
    context = await browser.newContext();
    await routeLocalTenantRequests({
      baseUrl: local.origin,
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    await context.route(`${local.origin}/context-handler`, (route) =>
      route.fulfill({ body: 'context handler' }),
    );
    const page = await context.newPage();
    await page.route(`${local.origin}/page-handler`, (route) =>
      route.fulfill({ body: 'page handler' }),
    );
    await page.goto(local.origin);
    await stopTenantRequestRouting(context);
    expect(
      await page.evaluate(async () =>
        Promise.all(
          ['/context-handler', '/page-handler'].map(async (path) =>
            (await fetch(path)).text(),
          ),
        ),
      ),
    ).toEqual(['context handler', 'page handler']);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      if (context) await closeTenantRequestContext(context);
    } catch (error) {
      errors.push(error);
    }
    try {
      await local.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      'Handler ownership test and cleanup failed',
      { cause: errors[0] },
    );
});
