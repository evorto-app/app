import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import {
  createServer,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';

import { expect, test, type BrowserContext } from '@playwright/test';
import { DateTime } from 'luxon';

import { localTestTenantDomainHeader } from '../../../src/shared/request-routing';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import {
  closeApplicationContext,
  closeApplicationPages,
  closeTenantRequestContext,
  closeTenantRequestPages,
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

test('finishes loading the replacement document before closing its page', async ({
  browser,
}) => {
  const scriptRequested = Promise.withResolvers<void>();
  const releaseScript = Promise.withResolvers<void>();
  const closeRequested = Promise.withResolvers<void>();
  const events: string[] = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  let closing: Promise<PromiseSettledResult<void>[]> | undefined;
  try {
    await page.goto('data:text/html,<body>Application</body>');
    // Hold the replacement document's parser without a real network request
    // or a timing delay. A commit alone must not release page disposal.
    await page.route('https://cleanup.invalid/held.js', async (route) => {
      scriptRequested.resolve();
      await releaseScript.promise;
      await route.fulfill({ body: '', contentType: 'text/javascript' });
    });
    await page.addInitScript(() => {
      if (location.href === 'about:blank') {
        document.write(
          '<script src="https://cleanup.invalid/held.js"></script>',
        );
        document.close();
      }
    });
    page.on('load', () => events.push('loaded'));
    const closePage = page.close.bind(page);
    page.close = async (options) => {
      events.push('close requested');
      closeRequested.resolve();
      await closePage(options);
    };
    closing = Promise.allSettled([closeApplicationPages(context)]);
    const firstEvent = await Promise.race([
      scriptRequested.promise.then(() => 'script requested'),
      closeRequested.promise.then(() => 'close requested'),
    ]);
    expect(firstEvent).toBe('script requested');
    expect(events).not.toContain('close requested');
    releaseScript.resolve();
    const [result] = await closing;
    if (!result) throw new Error('Application cleanup result is missing');
    if (result.status === 'rejected') throw result.reason;
    expect(events).toEqual(['loaded', 'close requested']);
    expect(page.isClosed()).toBe(true);
  } finally {
    releaseScript.resolve();
    if (closing) await closing;
    await context.close();
  }
});

test('attempts cancellation and retains both failures when document preparation and abort reject', async ({
  browser,
}) => {
  const started = Promise.withResolvers<void>();
  const preparationFailure = new Error('Synthetic document navigation failure');
  const abortFailure = new Error('Synthetic cancellation reporting failure');
  const expectedFailures = new Set([preparationFailure, abortFailure]);
  const errors: unknown[] = [];
  const received: (string | string[] | undefined)[] = [];
  let response: ServerResponse | undefined;
  let context: BrowserContext | undefined;
  let evaluation: Promise<PromiseSettledResult<void>[]> | undefined;
  let closing: Promise<PromiseSettledResult<void>[]> | undefined;
  let abortAttempts = 0;
  const leafErrors = (error: unknown): unknown[] =>
    error instanceof AggregateError
      ? error.errors.flatMap((nested: unknown) => leafErrors(nested))
      : [error];
  const assertRetainedFailures = (error: unknown) => {
    expect(new Set(leafErrors(error))).toEqual(expectedFailures);
  };
  const release = () => {
    if (response && !response.writableEnded && !response.destroyed)
      response.end('held response completed');
  };
  const local = await listen((request, currentResponse) => {
    if (request.url === '/held-mutation') {
      received.push(request.headers[localTestTenantDomainHeader]);
      if (response) {
        currentResponse.end('duplicate mutation');
        return;
      }
      response = currentResponse;
      request.resume();
      request.on('end', () => started.resolve());
      return;
    }
    currentResponse.setHeader('content-type', 'text/html');
    currentResponse.end('<body>Application document</body>');
  });
  try {
    context = await browser.newContext();
    const registerRoute = context.route.bind(context);
    context.route = async (pattern, handler, options) => {
      await registerRoute(
        pattern,
        async (route, request) => {
          const abort = route.abort.bind(route);
          route.abort = async (reason) => {
            abortAttempts += 1;
            await abort(reason);
            throw abortFailure;
          };
          await handler(route, request);
        },
        options,
      );
    };
    await routeLocalTenantRequests({
      baseUrl: local.origin,
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    const page = await context.newPage();
    await page.goto(local.origin);
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      if (url === 'about:blank') throw preparationFailure;
      return goto(url, options);
    };
    evaluation = Promise.allSettled([
      page.evaluate(async () => {
        void fetch('/held-mutation', {
          method: 'POST',
          body: 'tenant-owned mutation',
        }).catch((error: unknown) => {
          if (!(error instanceof TypeError)) throw error;
        });
        return new Promise<void>(() => {});
      }),
    ]);
    await started.promise;
    const pageClosed = page.waitForEvent('close', { timeout: 10_000 });
    closing = Promise.allSettled([closeApplicationPages(context)]);
    await pageClosed;
    release();
    const [result] = await closing;
    if (!result || result.status !== 'rejected')
      throw new Error('Application cleanup did not report its failures');
    assertRetainedFailures(result.reason);
    expect(abortAttempts).toBe(1);
    expect(received).toEqual(['north-river.evorto.app']);
  } catch (error) {
    errors.push(error);
  } finally {
    release();
    try {
      if (closing) {
        for (const result of await closing) {
          if (result.status === 'rejected')
            assertRetainedFailures(result.reason);
        }
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      if (context) {
        await closeTenantRequestContext(context).catch((error: unknown) => {
          assertRetainedFailures(error);
        });
        expect(context.isClosed()).toBe(true);
      }
      if (evaluation) await evaluation;
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
    throw new AggregateError(errors, 'Document preparation regression failed');
});

test('cancels an initial popup navigation before its frame is available', async ({
  browser,
}) => {
  const started = Promise.withResolvers<void>();
  const headers = Promise.withResolvers<void>();
  const errors: unknown[] = [];
  let frameError: unknown;
  let navigationRequest = false;
  let aborts = 0;
  let contextCloses = 0;
  let requests = 0;
  let context: BrowserContext | undefined;
  let evaluation: Promise<PromiseSettledResult<void>[]> | undefined;
  let closing: Promise<PromiseSettledResult<void>[]> | undefined;
  const local = await listen((_request, response) => {
    requests += 1;
    response.end('Unexpected upstream navigation');
  });
  try {
    context = await browser.newContext();
    const closeContext = context.close.bind(context);
    context.close = async (options) => {
      contextCloses += 1;
      await closeContext(options);
    };
    const registerRoute = context.route.bind(context);
    context.route = async (pattern, handler, options) => {
      await registerRoute(
        pattern,
        async (route, request) => {
          navigationRequest = request.isNavigationRequest();
          try {
            request.frame();
          } catch (error) {
            frameError = error;
          }
          const allHeaders = request.allHeaders.bind(request);
          request.allHeaders = async () => {
            await headers.promise;
            return allHeaders();
          };
          const abort = route.abort.bind(route);
          route.abort = async (reason) => {
            aborts += 1;
            try {
              await abort(reason);
            } finally {
              headers.resolve();
            }
          };
          const running = handler(route, request);
          started.resolve();
          await running;
        },
        options,
      );
    };
    await routeLocalTenantRequests({
      baseUrl: local.origin,
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    const page = await context.newPage();
    await page.setContent('<body>Popup opener</body>');
    evaluation = Promise.allSettled([
      page.evaluate((url) => {
        window.open(url);
      }, `${local.origin}/popup`),
    ]);
    await started.promise;
    closing = Promise.allSettled([closeApplicationContext(context)]);
    const [result] = await closing;
    if (!result) throw new Error('Application cleanup did not settle');
    if (result.status === 'rejected') throw result.reason;
    expect(navigationRequest).toBe(true);
    expect(frameError).toMatchObject({
      message: expect.stringContaining(
        'Frame for this navigation request is not available',
      ),
    });
    expect(aborts).toBe(1);
    expect(requests).toBe(0);
    expect(contextCloses).toBe(1);
    expect(context.isClosed()).toBe(true);
  } catch (error) {
    errors.push(error);
  } finally {
    headers.resolve();
    if (closing) await closing;
    try {
      if (context && !context.isClosed()) await context.close();
      if (evaluation) await evaluation;
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
      'Initial popup cancellation regression failed',
    );
});

test('closes authenticated helper documents before cancelling unfinished application work', async ({
  browser,
}, testInfo) => {
  const started = Promise.withResolvers<void>();
  const pageErrors: Error[] = [];
  const errors: unknown[] = [];
  const received: (string | string[] | undefined)[] = [];
  let response: ServerResponse | undefined;
  let owned: Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;
  let evaluation: Promise<PromiseSettledResult<void>[]> | undefined;
  let closing: Promise<PromiseSettledResult<void>[]> | undefined;
  const release = () => {
    if (response && !response.writableEnded && !response.destroyed)
      response.end('held response completed');
  };
  const local = await listen((request, currentResponse) => {
    if (request.url === '/held-helper-mutation') {
      received.push(request.headers[localTestTenantDomainHeader]);
      if (response) {
        currentResponse.end('unexpected duplicate mutation');
        return;
      }
      response = currentResponse;
      request.resume();
      request.on('end', () => started.resolve());
      return;
    }
    currentResponse.setHeader('content-type', 'text/html');
    currentResponse.end('<body>Application document</body>');
  });
  try {
    const storageState = testInfo.outputPath('empty-auth-state.json');
    await writeFile(storageState, JSON.stringify({ cookies: [], origins: [] }));
    owned = await openAuthenticatedTestPage({
      baseUrl: local.origin,
      browser,
      storageState,
      tenantDomain: 'north-river.evorto.app',
      testClock: DateTime.fromISO('2026-09-23T00:00:00Z'),
    });
    const { context, page } = owned;
    page.on('pageerror', (error) => pageErrors.push(error));
    await page.goto(local.origin);
    const closePage = page.close.bind(page);
    page.close = async (options) => {
      // Expose rejection delivery between request cancellation and disposal.
      await delay(50);
      await closePage(options);
    };
    evaluation = Promise.allSettled([
      page.evaluate(() => {
        void fetch('/held-helper-mutation', {
          method: 'POST',
          body: 'tenant-owned mutation',
        });
        return new Promise<void>(() => {});
      }),
    ]);
    await started.promise;
    const pageClosed = page.waitForEvent('close', { timeout: 10_000 });
    closing = Promise.allSettled([owned.close()]);
    await pageClosed;
    expect(response?.writableEnded).toBe(false);
    release();
    const [result] = await closing;
    if (!result)
      throw new Error('Authenticated page cleanup result is missing');
    if (result.status === 'rejected') throw result.reason;
    expect(context.isClosed()).toBe(true);
    expect(received).toEqual(['north-river.evorto.app']);
    expect(pageErrors).toEqual([]);
  } catch (error) {
    errors.push(error);
  } finally {
    release();
    if (closing) {
      for (const result of await closing) {
        if (result.status === 'rejected') errors.push(result.reason);
      }
    }
    try {
      if (owned) await closeTenantRequestContext(owned.context);
      if (evaluation) await evaluation;
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
      'Authenticated application cleanup failed',
    );
});

for (const { cleanupMode, method } of [
  { cleanupMode: 'pages', method: 'GET' },
  { cleanupMode: 'pages', method: 'POST' },
  { cleanupMode: 'context', method: 'GET' },
  { cleanupMode: 'context', method: 'POST' },
] as const) {
  test(`closes tenant pages before draining their held request without replay or browser errors (${cleanupMode}, ${method})`, async ({
    browser,
  }) => {
    const started = Promise.withResolvers<void>();
    const pageErrors: Error[] = [];
    const errors: unknown[] = [];
    let response: ServerResponse | undefined;
    let heldRequests = 0;
    const received: {
      body: string;
      method: string | undefined;
      tenant: string | string[] | undefined;
    }[] = [];
    let context: BrowserContext | undefined;
    let evaluation: Promise<PromiseSettledResult<string>[]> | undefined;
    let closing: Promise<PromiseSettledResult<void>[]> | undefined;
    let latePageUrlAtClosure: string | undefined;
    const exposeDuringSettlement = cleanupMode === 'pages' && method === 'POST';
    let pageInventoryExposed = !exposeDuringSettlement;
    const evaluationClosureMessage =
      cleanupMode === 'pages'
        ? 'Execution context was destroyed'
        : 'Target page, context or browser has been closed';
    const recordFailure = (error: unknown) => {
      if (!errors.includes(error)) errors.push(error);
    };
    const release = () => {
      if (response && !response.writableEnded && !response.destroyed)
        response.end('held response completed');
    };
    const local = await listen((request, currentResponse) => {
      currentResponse.on('error', recordFailure);
      if (request.url === '/held-page-request') {
        heldRequests += 1;
        if (response) {
          recordFailure(new Error('Duplicate held tenant request'));
          currentResponse.end('duplicate request');
          return;
        }
        response = currentResponse;
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
          body += chunk;
        });
        request.on('error', recordFailure);
        request.on('end', () => {
          received.push({
            body,
            method: request.method,
            tenant: request.headers[localTestTenantDomainHeader],
          });
          started.resolve();
        });
        return;
      }
      currentResponse.setHeader('content-type', 'text/html');
      currentResponse.end(
        '<body><button>Start application work</button><script>addEventListener("beforeunload", event => { event.preventDefault(); event.returnValue = ""; });</script></body>',
      );
    });
    try {
      context = await browser.newContext();
      if (exposeDuringSettlement) {
        const registerRoute = context.route.bind(context);
        context.route = async (pattern, handler, options) => {
          await registerRoute(
            pattern,
            async (route, request) => {
              const abort = route.abort.bind(route);
              route.abort = async (errorCode) => {
                pageInventoryExposed = true;
                await abort(errorCode);
                await delay(50);
              };
              await handler(route, request);
            },
            options,
          );
        };
        await context.newPage();
      }
      await routeLocalTenantRequests({
        baseUrl: local.origin,
        context,
        tenantDomain: 'north-river.evorto.app',
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => {
        pageErrors.push(error);
      });
      await page.goto(local.origin);
      if (cleanupMode === 'pages') {
        await page
          .getByRole('button', { name: 'Start application work' })
          .click();
        const originalClose = page.close.bind(page);
        page.close = async (options) => {
          if (exposeDuringSettlement) latePageUrlAtClosure = page.url();
          // Expose callbacks that can run between cancellation and disposal.
          await delay(50);
          await originalClose(options);
        };
        if (exposeDuringSettlement) {
          const pages = context.pages.bind(context);
          // Delay inventory visibility while retaining the real page and request.
          context.pages = () =>
            pages().filter(
              (candidate) => candidate !== page || pageInventoryExposed,
            );
        } else {
          const ownedContext = context;
          const originalGoto = page.goto.bind(page);
          page.goto = async (url, options) => {
            // Open a real page after cleanup has already read its first inventory.
            const latePage = await ownedContext.newPage();
            latePage.on('pageerror', (error) => pageErrors.push(error));
            await latePage.goto(local.origin);
            await latePage
              .getByRole('button', { name: 'Start application work' })
              .click();
            const closeLatePage = latePage.close.bind(latePage);
            latePage.close = async (closeOptions) => {
              latePageUrlAtClosure = latePage.url();
              await closeLatePage(closeOptions);
            };
            return originalGoto(url, options);
          };
        }
      }
      evaluation = Promise.allSettled([
        page.evaluate(
          async ({ applicationPage, requestMethod }) => {
            const request = fetch('/held-page-request', {
              method: requestMethod,
              ...(requestMethod === 'POST'
                ? { body: 'tenant-owned mutation' }
                : {}),
            });
            if (applicationPage) {
              // Model an unfinished application initializer with no rejection handler.
              void request;
            } else {
              try {
                await request;
              } catch (error) {
                if (!(error instanceof TypeError)) throw error;
              }
            }
            // Keep the observer pending until its document is discarded.
            return new Promise<string>(() => {});
          },
          { applicationPage: cleanupMode === 'pages', requestMethod: method },
        ),
      ]);
      await started.promise;
      const failedRequest =
        cleanupMode === 'context'
          ? page.waitForEvent('requestfailed', {
              predicate: (request) =>
                request.url() === `${local.origin}/held-page-request`,
              timeout: 10_000,
            })
          : undefined;
      const pageClosed = page.waitForEvent('close', { timeout: 10_000 });
      closing = Promise.allSettled([
        cleanupMode === 'pages'
          ? closeApplicationPages(context)
          : closeTenantRequestContext(context),
      ]);
      if (failedRequest)
        expect((await failedRequest).failure()?.errorText).toBe(
          'net::ERR_ABORTED',
        );
      await pageClosed;
      expect(page.isClosed()).toBe(true);
      expect(context.isClosed()).toBe(false);
      expect(response?.writableEnded).toBe(false);
      const [browserResult] = await evaluation;
      if (!browserResult || browserResult.status !== 'rejected') {
        throw new Error(
          'Held browser evaluation did not end with page closure',
        );
      }
      if (!(browserResult.reason instanceof Error)) throw browserResult.reason;
      expect(browserResult.reason.message).toContain(evaluationClosureMessage);
      release();
      const [closeResult] = await closing;
      if (!closeResult)
        throw new Error('Tenant page cleanup result is missing');
      if (closeResult.status === 'rejected') throw closeResult.reason;
      expect(context.isClosed()).toBe(cleanupMode === 'context');
      expect(heldRequests).toBe(1);
      if (cleanupMode === 'pages')
        expect(latePageUrlAtClosure).toBe('about:blank');
      expect(received).toEqual([
        {
          body: method === 'POST' ? 'tenant-owned mutation' : '',
          method,
          tenant: 'north-river.evorto.app',
        },
      ]);
      expect(pageErrors).toEqual([]);
    } catch (error) {
      recordFailure(error);
    } finally {
      try {
        release();
      } catch (error) {
        recordFailure(error);
      }
      try {
        if (closing) {
          for (const result of await closing) {
            if (result.status === 'rejected') recordFailure(result.reason);
          }
        }
      } catch (error) {
        recordFailure(error);
      }
      try {
        if (context && (cleanupMode === 'pages' || !closing)) {
          await closeTenantRequestContext(context);
        }
      } catch (error) {
        recordFailure(error);
      }
      try {
        if (evaluation) {
          for (const result of await evaluation) {
            if (
              result.status === 'rejected' &&
              (!(result.reason instanceof Error) ||
                !result.reason.message.includes(evaluationClosureMessage))
            ) {
              recordFailure(result.reason);
            }
          }
        }
      } catch (error) {
        recordFailure(error);
      }
      try {
        await local.close();
      } catch (error) {
        recordFailure(error);
      }
      for (const error of pageErrors) recordFailure(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        'Tenant page lifetime regression and cleanup failed',
      );
  });
}

for (const cleanupMode of ['pages', 'context'] as const) {
  test(`does not send a canceled POST when its headers arrive during cleanup (${cleanupMode})`, async ({
    browser,
  }) => {
    const headersReady = Promise.withResolvers<void>();
    const releaseHeaders = Promise.withResolvers<void>();
    const errors: unknown[] = [];
    const pageErrors: Error[] = [];
    let canceledRequests = 0;
    let context: BrowserContext | undefined;
    let closing: Promise<PromiseSettledResult<void>[]> | undefined;
    let evaluation: Promise<PromiseSettledResult<string>[]> | undefined;
    const local = await listen((request, response) => {
      if (request.url === '/headers-pending-request') canceledRequests += 1;
      response.setHeader('content-type', 'text/html');
      response.end(
        '<!doctype html><link rel="icon" href="data:,"><body>Pending request headers</body>',
      );
    });
    try {
      context = await browser.newContext();
      await routeLocalTenantRequests({
        baseUrl: local.origin,
        context,
        tenantDomain: 'north-river.evorto.app',
      });
      await context.route(
        `${local.origin}/headers-pending-request`,
        async (route) => {
          const request = route.request();
          const originalHeaders = request.allHeaders.bind(request);
          request.allHeaders = async () => {
            const headers = await originalHeaders();
            headersReady.resolve();
            await releaseHeaders.promise;
            return headers;
          };
          await route.fallback();
        },
      );
      const page = await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(error));
      await page.goto(local.origin);
      evaluation = Promise.allSettled([
        page.evaluate(async () => {
          try {
            await fetch('/headers-pending-request', {
              method: 'POST',
              body: 'canceled tenant mutation',
            });
          } catch (error) {
            if (!(error instanceof TypeError)) throw error;
          }
          return new Promise<string>(() => {});
        }),
      ]);
      await headersReady.promise;
      expect(canceledRequests).toBe(0);
      const failed = page.waitForEvent('requestfailed', {
        predicate: (request) =>
          request.url() === `${local.origin}/headers-pending-request`,
        timeout: 10_000,
      });
      const pageClosed = page.waitForEvent('close', { timeout: 10_000 });
      closing = Promise.allSettled([
        cleanupMode === 'pages'
          ? closeTenantRequestPages(context)
          : closeTenantRequestContext(context),
      ]);
      expect((await failed).failure()?.errorText).toBe('net::ERR_ABORTED');
      await pageClosed;
      expect(page.isClosed()).toBe(true);
      expect(context.isClosed()).toBe(false);
      releaseHeaders.resolve();
      const [result] = await closing;
      if (!result) throw new Error('Missing pending-header cleanup result');
      if (result.status === 'rejected') throw result.reason;
      expect(context.isClosed()).toBe(cleanupMode === 'context');
    } catch (error) {
      errors.push(error);
    } finally {
      releaseHeaders.resolve();
      if (closing) {
        for (const result of await closing) {
          if (result.status === 'rejected' && !errors.includes(result.reason))
            errors.push(result.reason);
        }
      }
      try {
        if (context && !context.isClosed())
          await closeTenantRequestContext(context);
      } catch (error) {
        errors.push(error);
      }
      if (evaluation) {
        for (const result of await evaluation) {
          if (result.status !== 'rejected') {
            errors.push(
              new Error('Pending-header observer outlived page closure'),
            );
          } else if (
            !(result.reason instanceof Error) ||
            !result.reason.message.includes(
              'Target page, context or browser has been closed',
            )
          ) {
            errors.push(result.reason);
          }
        }
      }
      try {
        await local.close();
      } catch (error) {
        errors.push(error);
      }
      errors.push(...pageErrors);
    }
    try {
      expect(canceledRequests).toBe(0);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, 'Pending-header cleanup failed');
  });
}

for (const cleanupMode of ['pages', 'context'] as const) {
  test(`settles a late POST before closing its page (${cleanupMode})`, async ({
    browser,
  }) => {
    const firstCloseStarted = Promise.withResolvers<void>();
    const firstCloseFinished = Promise.withResolvers<void>();
    const releaseFirstClose = Promise.withResolvers<void>();
    const abortStarted = Promise.withResolvers<void>();
    const releaseAbort = Promise.withResolvers<void>();
    const errors: unknown[] = [];
    const pageErrors: Error[] = [];
    let lateRequests = 0;
    let secondCloseStarted = false;
    let context: BrowserContext | undefined;
    let restorePageClosers: (() => void) | undefined;
    let closing: Promise<PromiseSettledResult<void>[]> | undefined;
    let evaluation: Promise<PromiseSettledResult<string>[]> | undefined;
    const local = await listen((request, response) => {
      if (request.url === '/late-cleanup-request') lateRequests += 1;
      response.setHeader('content-type', 'text/html');
      response.end(
        '<!doctype html><link rel="icon" href="data:,"><body>Late request cleanup</body>',
      );
    });
    try {
      context = await browser.newContext();
      await routeLocalTenantRequests({
        baseUrl: local.origin,
        context,
        tenantDomain: 'north-river.evorto.app',
      });
      await context.route(
        `${local.origin}/late-cleanup-request`,
        async (route) => {
          const originalAbort = route.abort.bind(route);
          route.abort = async (reason) => {
            abortStarted.resolve();
            await releaseAbort.promise;
            await originalAbort(reason);
          };
          await route.fallback();
        },
      );
      const first = await context.newPage();
      const second = await context.newPage();
      for (const page of [first, second]) {
        page.on('pageerror', (error) => pageErrors.push(error));
        await page.goto(local.origin);
      }
      const originalFirstClose = first.close.bind(first);
      const originalSecondClose = second.close.bind(second);
      restorePageClosers = () => {
        first.close = originalFirstClose;
        second.close = originalSecondClose;
      };
      first.close = async (options) => {
        firstCloseStarted.resolve();
        await releaseFirstClose.promise;
        await originalFirstClose(options);
        firstCloseFinished.resolve();
      };
      second.close = async (options) => {
        secondCloseStarted = true;
        await originalSecondClose(options);
      };
      closing = Promise.allSettled([
        cleanupMode === 'pages'
          ? closeTenantRequestPages(context)
          : closeTenantRequestContext(context),
      ]);
      await firstCloseStarted.promise;
      evaluation = Promise.allSettled([
        second.evaluate(async () => {
          try {
            await fetch('/late-cleanup-request', {
              method: 'POST',
              body: 'late tenant mutation',
            });
          } catch (error) {
            if (!(error instanceof TypeError)) throw error;
          }
          return new Promise<string>(() => {});
        }),
      ]);
      await abortStarted.promise;
      releaseFirstClose.resolve();
      await firstCloseFinished.promise;
      // Drain queued close continuations while the actual protocol abort is
      // held. This is an explicit barrier, not a request timing assumption.
      await setImmediate();
      expect(secondCloseStarted).toBe(false);
      expect(second.isClosed()).toBe(false);
      const failed = second.waitForEvent('requestfailed', {
        predicate: (request) =>
          request.url() === `${local.origin}/late-cleanup-request`,
        timeout: 10_000,
      });
      releaseAbort.resolve();
      expect((await failed).failure()?.errorText).toBe('net::ERR_ABORTED');
      const [result] = await closing;
      if (!result) throw new Error('Missing late-request cleanup result');
      if (result.status === 'rejected') throw result.reason;
      expect(second.isClosed()).toBe(true);
      expect(context.isClosed()).toBe(cleanupMode === 'context');
    } catch (error) {
      errors.push(error);
    } finally {
      releaseFirstClose.resolve();
      releaseAbort.resolve();
      if (closing) {
        for (const result of await closing) {
          if (result.status === 'rejected' && !errors.includes(result.reason))
            errors.push(result.reason);
        }
      }
      restorePageClosers?.();
      try {
        if (context && !context.isClosed())
          await closeTenantRequestContext(context);
      } catch (error) {
        errors.push(error);
      }
      if (evaluation) {
        for (const result of await evaluation) {
          if (result.status !== 'rejected') {
            errors.push(
              new Error('Late request observer outlived page closure'),
            );
          } else if (
            !(result.reason instanceof Error) ||
            !result.reason.message.includes(
              'Target page, context or browser has been closed',
            )
          ) {
            errors.push(result.reason);
          }
        }
      }
      try {
        await local.close();
      } catch (error) {
        errors.push(error);
      }
      errors.push(...pageErrors);
    }
    try {
      expect(lateRequests).toBe(0);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, 'Late request cleanup failed');
  });
}

test('uses fresh upstream connections for tenant requests across owned contexts', async ({
  browser,
}) => {
  const tenantDomain = 'connection-policy.evorto.app';
  const socketIds = new WeakMap<object, number>();
  let nextSocketId = 0;
  const received: {
    connection: string | undefined;
    path: string;
    socketId: number;
    tenant: string | string[] | undefined;
  }[] = [];
  const externalTenants: (string | string[] | undefined)[] = [];
  const external = await listen((request, response) => {
    externalTenants.push(request.headers[localTestTenantDomainHeader]);
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      '<!doctype html><link rel="icon" href="data:,"><body>external</body>',
    );
  });
  let local: ListeningServer | undefined;
  const errors: unknown[] = [];

  try {
    local = await listen((request, response) => {
      let socketId = socketIds.get(request.socket);
      if (socketId === undefined) {
        socketId = ++nextSocketId;
        socketIds.set(request.socket, socketId);
      }
      const requestPath = request.url ?? '/';
      received.push({
        connection: request.headers.connection,
        path: requestPath,
        socketId,
        tenant: request.headers[localTestTenantDomainHeader],
      });
      if (requestPath === '/redirect') {
        response.writeHead(302, { location: `${external.origin}/outside` });
        response.end();
      } else if (requestPath.startsWith('/document-')) {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(
          '<!doctype html><link rel="icon" href="data:,"><title>Connection policy</title>',
        );
      } else {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(requestPath);
      }
    });
    const localOrigin = local.origin;
    const runOwnedContext = async (
      documentPath: string,
      requestPaths: string[],
      followExternalRedirect: boolean,
    ) => {
      // A request-level keep-alive value must not override the local helper's
      // close policy. This also makes the test independent of project defaults.
      const context = await browser.newContext({
        extraHTTPHeaders: { connection: 'keep-alive' },
      });
      const contextErrors: unknown[] = [];
      try {
        await routeLocalTenantRequests({
          baseUrl: localOrigin,
          context,
          tenantDomain,
        });
        const page = await context.newPage();
        await page.goto(`${localOrigin}${documentPath}`);
        for (const requestPath of requestPaths) {
          const body = await page.evaluate(async (url) => {
            const response = await fetch(url);
            if (response.status !== 200) {
              throw new Error('Expected a successful local request');
            }
            return response.text();
          }, requestPath);
          expect(body).toBe(requestPath);
        }
        if (followExternalRedirect) {
          await page.goto(`${localOrigin}/redirect`);
          await expect(page).toHaveURL(`${external.origin}/outside`);
          await expect(page.locator('body')).toHaveText('external');
        }
      } catch (error) {
        contextErrors.push(error);
      } finally {
        try {
          await closeTenantRequestContext(context);
        } catch (error) {
          contextErrors.push(error);
        }
      }
      if (contextErrors.length) {
        throw new AggregateError(
          contextErrors,
          'Owned connection-policy context failed',
        );
      }
    };

    await runOwnedContext('/document-first', ['/first', '/second'], false);
    await runOwnedContext('/document-second', ['/third'], true);

    expect(received.map(({ path }) => path)).toEqual([
      '/document-first',
      '/first',
      '/second',
      '/document-second',
      '/third',
      '/redirect',
    ]);
    expect(received.map(({ connection }) => connection)).toEqual(
      Array.from({ length: 6 }, () => 'close'),
    );
    expect(received.map(({ tenant }) => tenant)).toEqual(
      Array.from({ length: 6 }, () => tenantDomain),
    );
    expect(new Set(received.map(({ socketId }) => socketId)).size).toBe(6);
    expect(externalTenants).toEqual([undefined]);
  } catch (error) {
    errors.push(error);
  } finally {
    const closures = await Promise.allSettled([
      ...(local ? [local.close()] : []),
      external.close(),
    ]);
    for (const closure of closures) {
      if (closure.status === 'rejected') errors.push(closure.reason);
    }
  }
  if (errors.length) {
    throw new AggregateError(
      errors,
      'Tenant upstream connection isolation failed',
    );
  }
});

test('inherits project connection-close headers in browser and API request contexts', async ({
  browser,
  request,
}) => {
  const socketIds = new WeakMap<object, number>();
  let nextSocketId = 0;
  const received: {
    connection: string | undefined;
    path: string;
    socketId: number;
    tenant: string | string[] | undefined;
  }[] = [];
  const server = await listen((incoming, response) => {
    let socketId = socketIds.get(incoming.socket);
    if (socketId === undefined) {
      socketId = ++nextSocketId;
      socketIds.set(incoming.socket, socketId);
    }
    const requestPath = incoming.url ?? '/';
    received.push({
      connection: incoming.headers.connection,
      path: requestPath,
      socketId,
      tenant: incoming.headers[localTestTenantDomainHeader],
    });
    if (requestPath === '/browser') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<!doctype html><link rel="icon" href="data:,"><body>/browser</body>',
      );
    } else {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(requestPath);
    }
  });
  let context: BrowserContext | undefined;
  const responses: Awaited<ReturnType<typeof request.get>>[] = [];
  const errors: unknown[] = [];
  try {
    for (const requestPath of ['/fixture-first', '/fixture-second']) {
      const response = await request.get(`${server.origin}${requestPath}`, {
        maxRedirects: 0,
        maxRetries: 0,
      });
      responses.push(response);
      expect(response.status()).toBe(200);
      expect(await response.text()).toBe(requestPath);
    }
    // Omit extraHTTPHeaders: Playwright Test must supply the project defaults
    // to both this custom browser context and its associated API client.
    context = await browser.newContext();
    for (const requestPath of ['/context-first', '/context-second']) {
      const response = await context.request.get(
        `${server.origin}${requestPath}`,
        { maxRedirects: 0, maxRetries: 0 },
      );
      responses.push(response);
      expect(response.status()).toBe(200);
      expect(await response.text()).toBe(requestPath);
    }
    const page = await context.newPage();
    await page.goto(`${server.origin}/browser`);
    await expect(page.locator('body')).toHaveText('/browser');

    expect(received.map(({ path }) => path)).toEqual([
      '/fixture-first',
      '/fixture-second',
      '/context-first',
      '/context-second',
      '/browser',
    ]);
    expect(received.map(({ connection }) => connection)).toEqual(
      Array.from({ length: 5 }, () => 'close'),
    );
    expect(received.map(({ tenant }) => tenant)).toEqual(
      Array.from({ length: 5 }, () => undefined),
    );
    expect(new Set(received.map(({ socketId }) => socketId)).size).toBe(5);
  } catch (error) {
    errors.push(error);
  } finally {
    for (const disposal of await Promise.allSettled(
      responses.map((response) => response.dispose()),
    )) {
      if (disposal.status === 'rejected') errors.push(disposal.reason);
    }
    if (context) {
      try {
        await closeTenantRequestContext(context);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await server.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) {
    throw new AggregateError(
      errors,
      'Project connection-header inheritance failed',
    );
  }
});

test('preserves the browser-selected cookie and authorization when the cookie jar changes', async ({
  browser,
}) => {
  const received: {
    authorization: string | undefined;
    cookie: string | undefined;
    tenant: string | undefined;
  }[] = [];
  const local = await listen((request, response) => {
    if (request.url === '/selected-headers') {
      received.push({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        tenant:
          typeof request.headers[localTestTenantDomainHeader] === 'string'
            ? request.headers[localTestTenantDomainHeader]
            : undefined,
      });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ received: true }));
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end('<body>Synthetic header routing regression</body>');
  });
  let context: BrowserContext | undefined;
  const errors: unknown[] = [];
  try {
    const cookie = {
      domain: '127.0.0.1',
      expires: -1,
      httpOnly: true,
      name: 'synthetic-session',
      path: '/',
      sameSite: 'Lax' as const,
      secure: false,
      value: 'browser-selected-value',
    };
    context = await browser.newContext({
      storageState: { cookies: [cookie], origins: [] },
    });
    const ownedContext = context;
    await routeLocalTenantRequests({
      baseUrl: local.origin,
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    await context.route(`${local.origin}/selected-headers`, async (route) => {
      const selected = await route.request().allHeaders();
      expect(selected['cookie']).toBe(
        'synthetic-session=browser-selected-value',
      );
      expect(selected['authorization']).toBe(
        'Bearer synthetic-request-authority',
      );
      // Hold the intercepted request while changing the context cookie jar.
      // A fetch rebuilt from the jar would send a different session selection.
      await ownedContext.addCookies([
        { ...cookie, value: 'later-cookie-jar-value' },
      ]);
      await route.fallback();
    });
    const page = await context.newPage();
    await page.goto(local.origin);
    const result = await page.evaluate(async () => {
      const response = await fetch('/selected-headers', {
        headers: { authorization: 'Bearer synthetic-request-authority' },
      });
      return response.json();
    });
    expect(result).toEqual({ received: true });
    expect(received).toEqual([
      {
        authorization: 'Bearer synthetic-request-authority',
        cookie: 'synthetic-session=browser-selected-value',
        tenant: 'north-river.evorto.app',
      },
    ]);
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
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'Browser header preservation and cleanup failed',
      { cause: errors[0] },
    );
  }
});
