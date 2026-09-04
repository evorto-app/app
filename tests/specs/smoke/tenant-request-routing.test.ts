import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
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

interface FailureDatabase {
  cleanup: () => Promise<void>;
  events: string[];
  startFixtureTeardown: () => void;
}

const failureTest = test.extend<{
  failureDatabase: FailureDatabase;
  failedRequestPage: { context: BrowserContext; origin: string };
}>({
  failureDatabase: async ({}, use) => {
    const events: string[] = [];
    let closed = false;
    let teardownStarted = false;
    try {
      await use({
        cleanup: async () => {
          events.push('body cleanup started');
          await setImmediate();
          if (closed) throw new Error('Test cleanup used a closed database');
          if (teardownStarted)
            throw new Error('Test cleanup outlived its test body scope');
          events.push('body cleanup completed');
        },
        events,
        startFixtureTeardown: () => {
          teardownStarted = true;
          events.push('fixture teardown started');
        },
      });
    } finally {
      closed = true;
      events.push('database closed');
      expect(events).toEqual([
        'body cleanup started',
        'body cleanup completed',
        'fixture teardown started',
        'routing owner reported failure',
        'database closed',
      ]);
    }
  },
  failedRequestPage: async ({ browser, failureDatabase }, use) => {
    let requests = 0;
    const local = await listen((request) => {
      requests += 1;
      request.socket.destroy();
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
      await use({ context, origin: local.origin });
    } catch (error) {
      errors.push(error);
    } finally {
      failureDatabase.startFixtureTeardown();
      try {
        if (context) {
          if (requests > 0) {
            await expect(closeTenantRequestContext(context)).rejects.toThrow(
              'socket hang up',
            );
            failureDatabase.events.push('routing owner reported failure');
            expect(requests).toBe(1);
          } else {
            await closeTenantRequestContext(context);
          }
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        await local.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0)
      throw new AggregateError(
        errors,
        'Route failure regression cleanup failed',
      );
  },
});

failureTest(
  'keeps asynchronous test cleanup inside the fixture lifetime after a failed fetch',
  async ({ failedRequestPage, failureDatabase }) => {
    const page = await failedRequestPage.context.newPage();
    try {
      await expect(page.goto(failedRequestPage.origin)).rejects.toThrow(
        'net::ERR_FAILED',
      );
    } finally {
      await failureDatabase.cleanup();
    }
  },
);

for (const closeFails of [false, true]) {
  test(`retains request settlement${closeFails ? ' and context-close' : ''} failure without replaying the request`, async ({
    browser,
  }) => {
    let requests = 0;
    const local = await listen((request) => {
      requests += 1;
      request.socket.destroy();
    });
    let context: BrowserContext | undefined;
    let originalClose: BrowserContext['close'] | undefined;
    const settlementFailure = new Error('Synthetic request abort failure');
    const closeFailure = new Error('Synthetic context close reporting failure');
    let closeCalls = 0;
    const errors: unknown[] = [];
    try {
      context = await browser.newContext();
      const closeContext = context.close.bind(context);
      originalClose = closeContext;
      context.close = async (options) => {
        closeCalls += 1;
        await closeContext(options);
        if (closeFails) throw closeFailure;
      };
      await routeLocalTenantRequests({
        baseUrl: local.origin,
        context,
        tenantDomain: 'north-river.evorto.app',
      });
      // A real routed request with a controlled settlement failure exercises
      // the context-close boundary without depending on a browser protocol fault.
      await context.route(`${local.origin}/**`, async (route) => {
        route.abort = async () => {
          throw settlementFailure;
        };
        await route.fallback();
      });
      const page = await context.newPage();
      await expect(page.goto(local.origin)).rejects.toThrow();
      await expect(stopTenantRequestRouting(context)).rejects.toMatchObject({
        errors: [
          expect.objectContaining({
            message: expect.stringContaining('socket hang up'),
          }),
          settlementFailure,
          ...(closeFails ? [closeFailure] : []),
        ],
      });
      expect(context.isClosed()).toBe(true);
      expect(closeCalls).toBe(1);
      expect(requests).toBe(1);
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        if (context) await closeTenantRequestContext(context);
      } catch (error) {
        errors.push(error);
      } finally {
        if (context && originalClose) context.close = originalClose;
      }
      try {
        await local.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0)
      throw new AggregateError(errors, 'Request settlement regression failed');
    expect(closeCalls).toBe(1);
  });
}

test('retains routing ownership when emergency close rejects before closing the context', async ({
  browser,
}) => {
  let requests = 0;
  const local = await listen((request) => {
    requests += 1;
    request.socket.destroy();
  });
  let context: BrowserContext | undefined;
  let originalClose: BrowserContext['close'] | undefined;
  let navigation: Promise<unknown> | undefined;
  const closeRequested = Promise.withResolvers<void>();
  const settlementFailure = new Error('Synthetic request abort failure');
  const closeFailure = new Error('Synthetic context close rejection');
  let closeCalls = 0;
  const errors: unknown[] = [];
  try {
    context = await browser.newContext();
    originalClose = context.close.bind(context);
    context.close = async () => {
      closeCalls += 1;
      closeRequested.resolve();
      throw closeFailure;
    };
    await routeLocalTenantRequests({
      baseUrl: local.origin,
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    await context.route(`${local.origin}/**`, async (route) => {
      route.abort = async () => {
        throw settlementFailure;
      };
      await route.fallback();
    });
    const page = await context.newPage();
    navigation = page.goto(local.origin).catch((error: unknown) => error);
    await closeRequested.promise;
    const retainedFailure = await stopTenantRequestRouting(context).catch(
      (error: unknown) => error,
    );
    expect(retainedFailure).toMatchObject({
      errors: [
        expect.objectContaining({
          message: expect.stringContaining('socket hang up'),
        }),
        settlementFailure,
        closeFailure,
      ],
      message:
        'Tenant request routing cleanup failed; context remains open and routing remains installed',
    });
    expect(context.isClosed()).toBe(false);
    await expect(
      routeLocalTenantRequests({
        baseUrl: local.origin,
        context,
        tenantDomain: 'replacement.example.org',
      }),
    ).rejects.toThrow('Tenant request routing is already installed');
    await expect(closeTenantRequestContext(context)).rejects.toBe(
      retainedFailure,
    );
    expect(context.isClosed()).toBe(false);
    expect(closeCalls).toBe(1);
    expect(requests).toBe(1);
  } catch (error) {
    errors.push(error);
  } finally {
    // The probe owns this deliberately unclosed context. Restore the real
    // close operation solely to release its browser resource after assertions.
    try {
      if (context && originalClose) {
        context.close = originalClose;
        await originalClose();
      }
      if (navigation) await navigation;
    } catch (error) {
      errors.push(error);
    }
    try {
      await local.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0)
    throw new AggregateError(
      errors,
      'Unclosed routing owner regression failed',
    );
});
