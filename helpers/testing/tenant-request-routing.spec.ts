import type { BrowserContext, Request, Route } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

import { localTestTenantDomainHeader } from '../../src/shared/request-routing';
import {
  closeTenantRequestContext,
  closeTenantRequestPages,
  localTenantRequestHeaders,
  localTenantRequestPattern,
  routeLocalTenantRequests,
  stopTenantRequestRouting,
} from '../../tests/support/utils/tenant-request-routing';

const registerRoute = async () => ({
  dispose: async () => {},
  [Symbol.asyncDispose]: async () => {},
});

const unusedRequestOperation = (): never => {
  throw new Error('Unexpected request operation during routing teardown');
};

const createTeardownRequest = (): Request => ({
  allHeaders: async () => ({}),
  existingResponse: unusedRequestOperation,
  failure: unusedRequestOperation,
  frame: unusedRequestOperation,
  headers: unusedRequestOperation,
  headersArray: unusedRequestOperation,
  headerValue: unusedRequestOperation,
  isNavigationRequest: unusedRequestOperation,
  method: unusedRequestOperation,
  postData: unusedRequestOperation,
  postDataBuffer: unusedRequestOperation,
  postDataJSON: unusedRequestOperation,
  redirectedFrom: unusedRequestOperation,
  redirectedTo: unusedRequestOperation,
  resourceType: unusedRequestOperation,
  response: unusedRequestOperation,
  serviceWorker: unusedRequestOperation,
  sizes: unusedRequestOperation,
  timing: unusedRequestOperation,
  url: unusedRequestOperation,
});

describe('local tenant request routing', () => {
  it('matches only the application origin', () => {
    expect(
      localTenantRequestPattern('http://localhost:4200/admin/settings'),
    ).toBe('http://localhost:4200/**');
  });

  it('adds the tenant header and overrides connection reuse without changing the original headers', () => {
    const original = { accept: 'application/json', connection: 'keep-alive' };

    expect(
      localTenantRequestHeaders(original, 'north-river.evorto.app'),
    ).toEqual({
      accept: 'application/json',
      connection: 'close',
      [localTestTenantDomainHeader]: 'north-river.evorto.app',
    });
    expect(original).toEqual({
      accept: 'application/json',
      connection: 'keep-alive',
    });
  });

  it('preserves complete credentials when provisional headers omit them', async () => {
    const installed: { handler?: Parameters<BrowserContext['route']>[1] } = {};
    const context = {
      close: async () => {},
      grantPermissions: async () => {},
      isClosed: () => false,
      route: async (
        _pattern: string,
        handler: Parameters<BrowserContext['route']>[1],
      ) => {
        installed.handler = handler;
        return registerRoute();
      },
      unroute: async () => {},
    };
    const unexpected = (): never => {
      throw new Error('Unexpected request operation');
    };
    const request: Request = {
      allHeaders: async () => ({
        accept: 'application/json',
        authorization: 'Bearer synthetic-authority',
        cookie: 'synthetic-session=selected',
      }),
      existingResponse: unexpected,
      failure: unexpected,
      frame: unexpected,
      headers: vi.fn(() => ({ accept: 'application/json' })),
      headersArray: unexpected,
      headerValue: unexpected,
      isNavigationRequest: unexpected,
      method: unexpected,
      postData: unexpected,
      postDataBuffer: unexpected,
      postDataJSON: unexpected,
      redirectedFrom: unexpected,
      redirectedTo: unexpected,
      resourceType: unexpected,
      response: unexpected,
      serviceWorker: unexpected,
      sizes: unexpected,
      timing: unexpected,
      url: unexpected,
    };
    const fetchFailure = new Error(
      'Synthetic fetch terminates after header observation',
    );
    const fetch = vi.fn(async () => {
      throw fetchFailure;
    });
    const route: Route = {
      abort: async () => {},
      continue: unexpected,
      fallback: unexpected,
      fetch,
      fulfill: unexpected,
      request: () => request,
    };
    await routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    const handler = installed.handler;
    if (!handler) throw new Error('Tenant route was not installed');
    await handler(route, request);
    expect(fetch).toHaveBeenCalledExactlyOnceWith({
      headers: {
        accept: 'application/json',
        authorization: 'Bearer synthetic-authority',
        cookie: 'synthetic-session=selected',
        connection: 'close',
        [localTestTenantDomainHeader]: 'north-river.evorto.app',
      },
      maxRedirects: 0,
    });
    expect(request.headers).not.toHaveBeenCalled();
    await expect(stopTenantRequestRouting(context)).rejects.toBe(fetchFailure);
  });

  it('removes only its registered handler and permits repeated cleanup', async () => {
    const context = {
      close: async () => {},
      grantPermissions: vi.fn(async () => {}),
      isClosed: () => false,
      route: vi.fn(registerRoute),
      unroute: vi.fn(async () => {}),
    };
    await routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    await stopTenantRequestRouting(context);
    await stopTenantRequestRouting(context);
    expect(context.unroute.mock.calls).toEqual(context.route.mock.calls);
    expect(context.unroute).toHaveBeenCalledOnce();
    expect(context.grantPermissions).toHaveBeenCalledExactlyOnceWith(
      ['local-network-access'],
      { origin: 'http://localhost:4200' },
    );
  });

  it('does not grant network permission to a non-loopback origin', async () => {
    const context = {
      close: async () => {},
      grantPermissions: vi.fn(async () => {}),
      isClosed: () => false,
      route: registerRoute,
      unroute: async () => {},
    };
    await routeLocalTenantRequests({
      baseUrl: 'https://preview.example.test',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    await stopTenantRequestRouting(context);
    expect(context.grantPermissions).not.toHaveBeenCalled();
  });

  it('preserves a route removal failure and still closes the owned context', async () => {
    const failure = new Error('route removal failed');
    let closed = false;
    const context = {
      grantPermissions: async () => {},
      isClosed: () => closed,
      pages: () => [],
      route: registerRoute,
      unroute: async () => {
        throw failure;
      },
      close: vi.fn(async () => {
        closed = true;
      }),
    };
    await routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    await expect(stopTenantRequestRouting(context)).rejects.toBe(failure);
    await expect(closeTenantRequestContext(context)).rejects.toBe(failure);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('retains both route removal and context-close failures', async () => {
    const routeFailure = new Error('route removal failed');
    const closeFailure = new Error('context close failed');
    const context = {
      grantPermissions: async () => {},
      isClosed: () => false,
      pages: () => [],
      route: registerRoute,
      unroute: async () => {
        throw routeFailure;
      },
      close: async () => {
        throw closeFailure;
      },
    };
    await routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    await expect(stopTenantRequestRouting(context)).rejects.toBe(routeFailure);
    await expect(closeTenantRequestContext(context)).rejects.toMatchObject({
      errors: [closeFailure, routeFailure],
    });
  });

  it('retains routing ownership after unroute fails until context closure is proven', async () => {
    const failure = new Error(
      'route removal failed while context remains open',
    );
    let closed = false;
    const context = {
      close: async () => {
        closed = true;
      },
      grantPermissions: async () => {},
      isClosed: () => closed,
      route: vi.fn(registerRoute),
      unroute: vi.fn(async () => {
        throw failure;
      }),
    };
    const install = () =>
      routeLocalTenantRequests({
        baseUrl: 'http://localhost:4200',
        context,
        tenantDomain: 'north-river.evorto.app',
      });
    await install();
    await expect(stopTenantRequestRouting(context)).rejects.toBe(failure);
    await expect(install()).rejects.toThrow('already installed');
    await expect(stopTenantRequestRouting(context)).rejects.toBe(failure);
    expect(context.unroute).toHaveBeenCalledOnce();
    expect(context.route).toHaveBeenCalledOnce();
    await context.close();
    await expect(stopTenantRequestRouting(context)).rejects.toBe(failure);
    await expect(stopTenantRequestRouting(context)).resolves.toBeUndefined();
    expect(context.unroute).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'retains a settled drain failure without losing later route errors (late error: %s)',
    async (lateError) => {
      const installed: { handler?: Parameters<BrowserContext['route']>[1] } =
        {};
      const fetchFailure = new Error('request failed');
      const abortFailure = new Error('request abort failed');
      const closeFailure = new Error('context refused closure');
      const lateFailure = new Error('later request abort failed');
      const context = {
        close: vi.fn(async () => {
          throw closeFailure;
        }),
        grantPermissions: async () => {},
        isClosed: () => false,
        pages: () => [],
        route: async (
          _pattern: string,
          handler: Parameters<BrowserContext['route']>[1],
        ) => {
          installed.handler = handler;
          return registerRoute();
        },
        unroute: vi.fn(async () => {}),
      };
      await routeLocalTenantRequests({
        baseUrl: 'http://localhost:4200',
        context,
        tenantDomain: 'north-river.evorto.app',
      });
      const request = createTeardownRequest();
      const route: Route = {
        abort: async () => {
          throw abortFailure;
        },
        continue: unusedRequestOperation,
        fallback: unusedRequestOperation,
        fetch: async () => {
          throw fetchFailure;
        },
        fulfill: unusedRequestOperation,
        request: () => request,
      };
      const handler = installed.handler;
      if (!handler) throw new Error('Tenant route handler was not installed');
      await handler(route, request);
      const retained = await stopTenantRequestRouting(context).catch(
        (error: unknown) => error,
      );
      expect(retained).toMatchObject({
        errors: [fetchFailure, abortFailure, closeFailure],
        message:
          'Tenant request routing cleanup failed; context remains open and routing remains installed',
      });
      if (lateError) {
        await handler(
          {
            ...route,
            abort: async () => {
              throw lateFailure;
            },
          },
          request,
        );
        await expect(closeTenantRequestContext(context)).rejects.toMatchObject({
          errors: [retained, lateFailure],
        });
      } else {
        await expect(closeTenantRequestContext(context)).rejects.toBe(retained);
      }
      expect(context.close).toHaveBeenCalledOnce();
      expect(context.unroute).not.toHaveBeenCalled();
    },
  );

  it('does not release a callback admitted during an ordinary stop', async () => {
    const installed: { handler?: Parameters<BrowserContext['route']>[1] } = {};
    const releaseAbort = Promise.withResolvers<void>();
    const context = {
      close: vi.fn(async () => {}),
      grantPermissions: async () => {},
      isClosed: () => false,
      route: async (
        _pattern: string,
        handler: Parameters<BrowserContext['route']>[1],
      ) => {
        installed.handler = handler;
        return registerRoute();
      },
      unroute: vi.fn(async () => {
        Reflect.deleteProperty(installed, 'handler');
      }),
    };
    await routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    const request = createTeardownRequest();
    const route: Route = {
      abort: async () => releaseAbort.promise,
      continue: unusedRequestOperation,
      fallback: unusedRequestOperation,
      fetch: unusedRequestOperation,
      fulfill: unusedRequestOperation,
      request: () => request,
    };
    let stopped = false;
    const stopping = stopTenantRequestRouting(context).then(() => {
      stopped = true;
    });
    // A browser can dispatch only while the registered handler remains installed.
    const admitted = installed.handler !== undefined;
    const callback = installed.handler?.(route, request);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stopped).toBe(!admitted);
      expect(context.unroute).toHaveBeenCalledTimes(admitted ? 0 : 1);
    } finally {
      releaseAbort.resolve();
      await callback;
      await stopping;
    }
    expect(context.unroute).toHaveBeenCalledOnce();
    expect(context.close).not.toHaveBeenCalled();
  });

  it('closes a context whose routing setup never ran', async () => {
    let closed = false;
    const context = {
      isClosed: () => closed,
      pages: () => [],
      unroute: vi.fn(async () => {}),
      close: vi.fn(async () => {
        closed = true;
      }),
    };
    await closeTenantRequestContext(context);
    expect(context.unroute).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });
});

describe('tenant request page lifetime', () => {
  it.each([false, true])(
    'joins an in-flight fulfillment before closing without a second terminal action (fulfillment fails: %s)',
    async (fulfillFails) => {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const fulfillmentFailure = new Error('Fulfillment failed');
      const installed: { handler?: Parameters<BrowserContext['route']>[1] } =
        {};
      let pageClosed = false;
      let contextClosed = false;
      const page = {
        close: vi.fn(async () => {
          pageClosed = true;
        }),
        isClosed: () => pageClosed,
      };
      const context = {
        close: vi.fn(async () => {
          pageClosed = true;
          contextClosed = true;
        }),
        grantPermissions: async () => {},
        isClosed: () => contextClosed,
        pages: () => (pageClosed ? [] : [page]),
        route: vi.fn<BrowserContext['route']>(async (_, handler) => {
          installed.handler = handler;
          return registerRoute();
        }),
        unroute: vi.fn(async () => {}),
      };
      const response: Awaited<ReturnType<Route['fetch']>> = {
        body: unusedRequestOperation,
        dispose: unusedRequestOperation,
        headers: unusedRequestOperation,
        headersArray: unusedRequestOperation,
        json: unusedRequestOperation,
        ok: unusedRequestOperation,
        securityDetails: unusedRequestOperation,
        serverAddr: unusedRequestOperation,
        status: unusedRequestOperation,
        statusText: unusedRequestOperation,
        text: unusedRequestOperation,
        timing: unusedRequestOperation,
        url: unusedRequestOperation,
        [Symbol.asyncDispose]: unusedRequestOperation,
      };
      const request = createTeardownRequest();
      const route: Route = {
        abort: vi.fn(unusedRequestOperation),
        continue: unusedRequestOperation,
        fallback: unusedRequestOperation,
        fetch: async () => response,
        fulfill: vi.fn(async () => {
          started.resolve();
          await release.promise;
          if (fulfillFails) throw fulfillmentFailure;
        }),
        request: () => request,
      };
      await routeLocalTenantRequests({
        baseUrl: 'http://localhost:4200',
        context,
        tenantDomain: 'north-river.evorto.app',
      });
      const handler = installed.handler;
      if (!handler) throw new Error('Tenant route handler was not installed');
      const callback = handler(route, request);
      await started.promise;
      const closing = Promise.allSettled([closeTenantRequestContext(context)]);
      expect(page.close).not.toHaveBeenCalled();
      expect(context.close).not.toHaveBeenCalled();
      release.resolve();
      const [result] = await closing;
      await callback;
      expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({ response });
      expect(route.abort).not.toHaveBeenCalled();
      expect(context.close).toHaveBeenCalledOnce();
      expect(contextClosed).toBe(true);
      if (fulfillFails) {
        expect(result?.status).toBe('rejected');
        if (result?.status !== 'rejected')
          throw new Error('Expected failed cleanup');
        expect(result.reason).toBeInstanceOf(AggregateError);
        if (!(result.reason instanceof AggregateError)) throw result.reason;
        expect(result.reason.errors).toContain(fulfillmentFailure);
      } else expect(result?.status).toBe('fulfilled');
    },
  );

  it('closes every snapshot page before draining and leaves the context open', async () => {
    const events: string[] = [];
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let firstClosed = false;
    let secondClosed = false;
    const pages = [
      {
        close: async () => {
          events.push('first close');
          started.resolve();
          await release.promise;
          firstClosed = true;
        },
        isClosed: () => firstClosed,
      },
      {
        close: async () => {
          events.push('second close');
          secondClosed = true;
        },
        isClosed: () => secondClosed,
      },
    ];
    const context = {
      close: vi.fn(async () => {}),
      grantPermissions: async () => {},
      isClosed: () => false,
      pages: () => pages.filter((page) => !page.isClosed()),
      route: vi.fn(registerRoute),
      unroute: vi.fn(async () => {
        events.push('unroute');
      }),
    };
    await routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    const closing = closeTenantRequestPages(context);
    await started.promise;
    const eventsWhileFirstHeld = [...events];
    release.resolve();
    await closing;
    expect(eventsWhileFirstHeld).toEqual(['first close']);
    expect(events).toEqual(['first close', 'second close', 'unroute']);
    expect(context.unroute.mock.calls).toEqual(context.route.mock.calls);
    expect(context.close).not.toHaveBeenCalled();
    await closeTenantRequestPages(context);
    expect(context.unroute).toHaveBeenCalledOnce();
  });

  it('retains page-close and drain failures after all pages actually close', async () => {
    const pageFailure = new Error('page close reported failure');
    const drainFailure = new Error('route removal failed');
    let firstClosed = false;
    let secondClosed = false;
    const secondClose = vi.fn(async () => {
      secondClosed = true;
    });
    const pages = [
      {
        close: async () => {
          firstClosed = true;
          throw pageFailure;
        },
        isClosed: () => firstClosed,
      },
      { close: secondClose, isClosed: () => secondClosed },
    ];
    const context = {
      close: vi.fn(async () => {}),
      grantPermissions: async () => {},
      isClosed: () => false,
      pages: () => pages.filter((page) => !page.isClosed()),
      route: registerRoute,
      unroute: vi.fn(async () => {
        throw drainFailure;
      }),
    };
    await routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    await expect(closeTenantRequestPages(context)).rejects.toMatchObject({
      errors: [pageFailure, drainFailure],
    });
    expect(secondClose).toHaveBeenCalledOnce();
    expect(context.unroute).toHaveBeenCalledOnce();
    expect(context.close).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'retains routing if a page stays open (close rejects: %s)',
    async (rejectClose) => {
      const pageFailure = new Error('page refused closure');
      let secondClosed = false;
      const secondClose = vi.fn(async () => {
        secondClosed = true;
      });
      const pages = [
        {
          close: async () => {
            if (rejectClose) throw pageFailure;
          },
          isClosed: () => false,
        },
        { close: secondClose, isClosed: () => secondClosed },
      ];
      const context = {
        close: vi.fn(async () => {}),
        grantPermissions: async () => {},
        isClosed: () => false,
        pages: () => pages.filter((page) => !page.isClosed()),
        route: registerRoute,
        unroute: vi.fn(async () => {}),
      };
      await routeLocalTenantRequests({
        baseUrl: 'http://localhost:4200',
        context,
        tenantDomain: 'north-river.evorto.app',
      });
      const failure = await closeTenantRequestPages(context).catch(
        (error: unknown) => error,
      );
      if (rejectClose) {
        expect(failure).toMatchObject({
          errors: [
            pageFailure,
            expect.objectContaining({
              message:
                'Tenant request pages remain open; routing remains installed',
            }),
          ],
        });
      } else {
        expect(failure).toMatchObject({
          message:
            'Tenant request pages remain open; routing remains installed',
        });
      }
      expect(secondClose).toHaveBeenCalledOnce();
      expect(context.unroute).not.toHaveBeenCalled();
      expect(context.close).not.toHaveBeenCalled();
      await expect(
        routeLocalTenantRequests({
          baseUrl: 'http://localhost:4200',
          context,
          tenantDomain: 'replacement.example.org',
        }),
      ).rejects.toThrow('Tenant request routing is already installed');
    },
  );

  it('retains routing when another page appears during the snapshot close', async () => {
    let firstClosed = false;
    const popup = { close: vi.fn(async () => {}), isClosed: () => false };
    const pages = [
      {
        close: async () => {
          firstClosed = true;
          pages.push(popup);
        },
        isClosed: () => firstClosed,
      },
    ];
    const context = {
      close: vi.fn(async () => {}),
      grantPermissions: async () => {},
      isClosed: () => false,
      pages: () => pages,
      route: registerRoute,
      unroute: vi.fn(async () => {}),
    };
    await routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    await expect(closeTenantRequestPages(context)).rejects.toThrow(
      'Tenant request pages remain open; routing remains installed',
    );
    expect(popup.close).not.toHaveBeenCalled();
    expect(context.unroute).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
  });
});

describe('owned tenant context lifetime', () => {
  it('settles the browser request before closing pages and keeps its upstream fetch alive through a concurrent stop', async () => {
    const events: string[] = [];
    const fetched = Promise.withResolvers<void>();
    const pageClosing = Promise.withResolvers<void>();
    const abortStarted = Promise.withResolvers<void>();
    const finishAbort = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const routeFailure = new Error('Admitted request finishes with a failure');
    const installed: { handler?: Parameters<BrowserContext['route']>[1] } = {};
    let pageClosed = false;
    let contextClosed = false;
    const page = {
      close: async () => {
        events.push('page close');
        pageClosed = true;
        pageClosing.resolve();
      },
      isClosed: () => pageClosed,
    };
    const context = {
      close: vi.fn(async () => {
        events.push('context close');
        contextClosed = true;
      }),
      grantPermissions: async () => {},
      isClosed: () => contextClosed,
      pages: () => (pageClosed ? [] : [page]),
      route: async (
        _pattern: string,
        handler: Parameters<BrowserContext['route']>[1],
      ) => {
        installed.handler = handler;
        return registerRoute();
      },
      unroute: vi.fn(async () => {}),
    };
    await routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    const request = createTeardownRequest();
    const route: Route = {
      abort: vi.fn(async () => {
        events.push('abort started');
        abortStarted.resolve();
        await finishAbort.promise;
        events.push('route settled');
      }),
      continue: unusedRequestOperation,
      fallback: unusedRequestOperation,
      fetch: async () => {
        events.push('fetch');
        fetched.resolve();
        await release.promise;
        throw routeFailure;
      },
      fulfill: unusedRequestOperation,
      request: () => request,
    };
    const handler = installed.handler;
    if (!handler) throw new Error('Tenant route handler was not installed');
    const callback = handler(route, request);
    await fetched.promise;
    const stopping = stopTenantRequestRouting(context).catch(
      (error: unknown) => error,
    );
    const closed = closeTenantRequestContext(context).catch(
      (error: unknown) => error,
    );
    await abortStarted.promise;
    expect(events).toEqual(['fetch', 'abort started']);
    expect(pageClosed).toBe(false);
    finishAbort.resolve();
    await pageClosing.promise;
    const beforeRelease = { events: [...events], contextClosed };
    release.resolve();
    expect(await stopping).toBe(routeFailure);
    expect(await closed).toBe(routeFailure);
    await callback;
    expect(beforeRelease).toEqual({
      events: ['fetch', 'abort started', 'route settled', 'page close'],
      contextClosed: false,
    });
    expect(events).toEqual([
      'fetch',
      'abort started',
      'route settled',
      'page close',
      'context close',
    ]);
    expect(route.abort).toHaveBeenCalledExactlyOnceWith('aborted');
    expect(contextClosed).toBe(true);
    expect(context.unroute).not.toHaveBeenCalled();
    await closeTenantRequestContext(context);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('preserves page, prior route-removal and context failures without retrying', async () => {
    const pageFailure = new Error('page close reported failure');
    const drainFailure = new Error('route drain failed');
    const contextFailure = new Error('context close failed');
    let pageClosed = false;
    const page = {
      close: async () => {
        pageClosed = true;
        throw pageFailure;
      },
      isClosed: () => pageClosed,
    };
    const context = {
      close: vi.fn(async () => {
        throw contextFailure;
      }),
      grantPermissions: async () => {},
      isClosed: () => false,
      pages: () => (pageClosed ? [] : [page]),
      route: registerRoute,
      unroute: vi.fn(async () => {
        throw drainFailure;
      }),
    };
    await routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    await expect(stopTenantRequestRouting(context)).rejects.toBe(drainFailure);
    const failure = await closeTenantRequestContext(context).catch(
      (error: unknown) => error,
    );
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.errors).toEqual([pageFailure, contextFailure, drainFailure]);
    expect(failure.errors[0]).toBe(pageFailure);
    expect(failure.errors[1]).toBe(contextFailure);
    expect(failure.errors[2]).toBe(drainFailure);
    expect(context.unroute).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it.each([
    { pagesClose: false, rejectClose: false },
    { pagesClose: false, rejectClose: true },
    { pagesClose: true, rejectClose: false },
    { pagesClose: true, rejectClose: true },
  ])(
    'retains interception while closure is pending or unproven (pages close: $pagesClose; close rejects: $rejectClose)',
    async ({ pagesClose, rejectClose }) => {
      const pageFailure = new Error('page remains open');
      const contextFailure = new Error('context close rejected');
      const closeStarted = Promise.withResolvers<void>();
      const releaseClose = Promise.withResolvers<void>();
      const installed: { handler?: Parameters<BrowserContext['route']>[1] } =
        {};
      let pageClosed = false;
      const page = {
        close: async () => {
          if (!pagesClose) throw pageFailure;
          pageClosed = true;
        },
        isClosed: () => pageClosed,
      };
      const context = {
        close: vi.fn(async () => {
          closeStarted.resolve();
          await releaseClose.promise;
          if (rejectClose) throw contextFailure;
        }),
        grantPermissions: async () => {},
        isClosed: () => false,
        pages: () => (pageClosed ? [] : [page]),
        route: async (
          _pattern: string,
          handler: Parameters<BrowserContext['route']>[1],
        ) => {
          installed.handler = handler;
          return registerRoute();
        },
        unroute: vi.fn(async () => {}),
      };
      const install = () =>
        routeLocalTenantRequests({
          baseUrl: 'http://localhost:4200',
          context,
          tenantDomain: 'north-river.evorto.app',
        });
      await install();
      const closing = closeTenantRequestContext(context).catch(
        (error: unknown) => error,
      );
      await closeStarted.promise;
      try {
        await stopTenantRequestRouting(context);
        expect(context.unroute).not.toHaveBeenCalled();
        await expect(install()).rejects.toThrow(
          'Tenant request routing is already installed',
        );
      } finally {
        releaseClose.resolve();
      }
      const failure = await closing;
      const errors =
        failure instanceof AggregateError ? failure.errors : [failure];
      if (!pagesClose) {
        expect(errors[0]).toBe(pageFailure);
        expect(errors[1]).toMatchObject({
          message:
            'Tenant request pages remain open; routing remains installed',
        });
      }
      const closeErrorIndex = pagesClose ? 0 : 2;
      if (rejectClose) expect(errors[closeErrorIndex]).toBe(contextFailure);
      else
        expect(errors[closeErrorIndex]).toMatchObject({
          message: 'Tenant request context closure is unproven',
        });
      expect(errors).toHaveLength(pagesClose ? 1 : 3);
      const request = createTeardownRequest();
      const abort = vi.fn(async () => {});
      const fetch = vi.fn(unusedRequestOperation);
      const route: Route = {
        abort,
        continue: unusedRequestOperation,
        fallback: unusedRequestOperation,
        fetch,
        fulfill: unusedRequestOperation,
        request: () => request,
      };
      const handler = installed.handler;
      if (!handler) throw new Error('Tenant route handler was not installed');
      await handler(route, request);
      expect(abort).toHaveBeenCalledExactlyOnceWith('aborted');
      expect(fetch).not.toHaveBeenCalled();
      await expect(closeTenantRequestContext(context)).rejects.toBeInstanceOf(
        Error,
      );
      expect(context.close).toHaveBeenCalledOnce();
      expect(context.unroute).not.toHaveBeenCalled();
      await expect(install()).rejects.toThrow(
        'Tenant request routing is already installed',
      );
    },
  );

  it('still closes the owned context if its page inventory fails', async () => {
    const failure = new Error('page inventory failed');
    let closed = false;
    const context = {
      close: vi.fn(async () => {
        closed = true;
      }),
      isClosed: () => closed,
      pages: () => {
        throw failure;
      },
      unroute: vi.fn(async () => {}),
    };
    await expect(closeTenantRequestContext(context)).rejects.toBe(failure);
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.unroute).not.toHaveBeenCalled();
    expect(closed).toBe(true);
  });

  it.each([false, true])(
    'joins late route failures after owned disposal without another close (abort fails: %s)',
    async (abortFails) => {
      const pageFailure = new Error('page refused closure');
      const routeFailure = new Error(
        'held route failed after context disposal',
      );
      const settlementFailure = new Error(
        'route abort failed before page disposal',
      );
      const fetched = Promise.withResolvers<void>();
      const disposed = Promise.withResolvers<void>();
      const installed: { handler?: Parameters<BrowserContext['route']>[1] } =
        {};
      let contextClosed = false;
      let pageClosed = false;
      const page = {
        close: async () => {
          throw pageFailure;
        },
        isClosed: () => pageClosed,
      };
      const context = {
        close: vi.fn(async () => {
          contextClosed = true;
          pageClosed = true;
          disposed.resolve();
        }),
        grantPermissions: async () => {},
        isClosed: () => contextClosed,
        pages: () => (pageClosed ? [] : [page]),
        route: vi.fn<BrowserContext['route']>(async (_, handler) => {
          installed.handler = handler;
          return registerRoute();
        }),
        unroute: vi.fn(async () => {
          expect(contextClosed).toBe(true);
        }),
      };
      await routeLocalTenantRequests({
        baseUrl: 'http://localhost:4200',
        context,
        tenantDomain: 'north-river.evorto.app',
      });
      const unexpected = (): never => {
        throw new Error(
          'Unexpected request operation in owned callback regression',
        );
      };
      const request: Request = {
        allHeaders: async () => ({}),
        existingResponse: unexpected,
        failure: unexpected,
        frame: unexpected,
        headers: unexpected,
        headersArray: unexpected,
        headerValue: unexpected,
        isNavigationRequest: unexpected,
        method: unexpected,
        postData: unexpected,
        postDataBuffer: unexpected,
        postDataJSON: unexpected,
        redirectedFrom: unexpected,
        redirectedTo: unexpected,
        resourceType: unexpected,
        response: unexpected,
        serviceWorker: unexpected,
        sizes: unexpected,
        timing: unexpected,
        url: unexpected,
      };
      const abort = vi.fn(async () => {
        if (abortFails) throw settlementFailure;
      });
      const route: Route = {
        abort,
        continue: unexpected,
        fallback: unexpected,
        fulfill: unexpected,
        fetch: async () => {
          fetched.resolve();
          await disposed.promise;
          throw routeFailure;
        },
        request: () => request,
      };
      const handler = installed.handler;
      if (!handler) throw new Error('Tenant route handler was not installed');
      const callback = Promise.allSettled([
        (async () => {
          await handler(route, request);
        })(),
      ]);
      await fetched.promise;
      const failure = await closeTenantRequestContext(context).catch(
        (error: unknown) => error,
      );
      const [callbackResult] = await callback;
      expect(callbackResult?.status).toBe('fulfilled');
      if (!(failure instanceof AggregateError)) throw failure;
      expect(failure.errors).toHaveLength(abortFails ? 4 : 3);
      const pageFailureIndex = abortFails ? 1 : 0;
      if (abortFails) expect(failure.errors[0]).toBe(settlementFailure);
      expect(failure.errors[pageFailureIndex]).toBe(pageFailure);
      expect(failure.errors[pageFailureIndex + 1]).toMatchObject({
        message: 'Tenant request pages remain open; routing remains installed',
      });
      if (abortFails) {
        const routeErrors: unknown = failure.errors[3];
        if (!(routeErrors instanceof AggregateError)) throw routeErrors;
        expect(routeErrors.errors).toEqual([routeFailure, settlementFailure]);
        expect(routeErrors.errors[0]).toBe(routeFailure);
        expect(routeErrors.errors[1]).toBe(settlementFailure);
      } else expect(failure.errors[2]).toBe(routeFailure);
      expect(contextClosed).toBe(true);
      expect(context.close).toHaveBeenCalledOnce();
      expect(abort).toHaveBeenCalledExactlyOnceWith('aborted');
      expect(context.unroute).not.toHaveBeenCalled();
    },
  );
});

it('joins a pending emergency close before proving closure after page cleanup fails', async () => {
  const pageFailure = new Error('page refused closure during emergency close');
  const routeFailure = new Error('request failed before emergency close');
  const settlementFailure = new Error(
    'request abort failed before emergency close',
  );
  const contextFailure = new Error('withheld emergency context close failed');
  const closeStarted = Promise.withResolvers<void>();
  const releaseClose = Promise.withResolvers<void>();
  const pageAttempted = Promise.withResolvers<void>();
  const installed: { handler?: Parameters<BrowserContext['route']>[1] } = {};
  const page = {
    close: async () => {
      pageAttempted.resolve();
      throw pageFailure;
    },
    isClosed: () => false,
  };
  const context = {
    close: vi.fn(async () => {
      closeStarted.resolve();
      await releaseClose.promise;
      throw contextFailure;
    }),
    grantPermissions: async () => {},
    isClosed: vi.fn(() => false),
    pages: () => [page],
    route: vi.fn<BrowserContext['route']>(async (_, handler) => {
      installed.handler = handler;
      return registerRoute();
    }),
    unroute: vi.fn(async () => {}),
  };
  await routeLocalTenantRequests({
    baseUrl: 'http://localhost:4200',
    context,
    tenantDomain: 'north-river.evorto.app',
  });
  const unexpected = (): never => {
    throw new Error('Unexpected request operation in pending-close regression');
  };
  const request: Request = {
    allHeaders: async () => ({}),
    existingResponse: unexpected,
    failure: unexpected,
    frame: unexpected,
    headers: unexpected,
    headersArray: unexpected,
    headerValue: unexpected,
    isNavigationRequest: unexpected,
    method: unexpected,
    postData: unexpected,
    postDataBuffer: unexpected,
    postDataJSON: unexpected,
    redirectedFrom: unexpected,
    redirectedTo: unexpected,
    resourceType: unexpected,
    response: unexpected,
    serviceWorker: unexpected,
    sizes: unexpected,
    timing: unexpected,
    url: unexpected,
  };
  const route: Route = {
    abort: async () => {
      throw settlementFailure;
    },
    continue: unexpected,
    fallback: unexpected,
    fulfill: unexpected,
    fetch: async () => {
      throw routeFailure;
    },
    request: () => request,
  };
  const handler = installed.handler;
  if (!handler) throw new Error('Tenant route handler was not installed');
  const callback = Promise.allSettled([
    (async () => {
      await handler(route, request);
    })(),
  ]);
  await closeStarted.promise;
  let cleanupReturned = false;
  const cleanup = Promise.allSettled([
    closeTenantRequestContext(context).finally(() => {
      cleanupReturned = true;
    }),
  ]);
  let beforeRelease:
    | { proofCalls: number; cleanupReturned: boolean; closeCalls: number }
    | undefined;
  try {
    await pageAttempted.promise;
    // A scheduler turn drains queued promise continuations, without releasing
    // the owned close barrier or depending on an elapsed-time delay.
    await new Promise<void>((resolve) => setImmediate(resolve));
    beforeRelease = {
      proofCalls: context.isClosed.mock.calls.length,
      cleanupReturned,
      closeCalls: context.close.mock.calls.length,
    };
  } finally {
    releaseClose.resolve();
  }
  const [cleanupResult] = await cleanup;
  const [callbackResult] = await callback;
  expect(beforeRelease).toEqual({
    proofCalls: 0,
    cleanupReturned: false,
    closeCalls: 1,
  });
  expect(callbackResult?.status).toBe('fulfilled');
  if (!cleanupResult || cleanupResult.status !== 'rejected') {
    throw new Error('Pending emergency cleanup unexpectedly passed');
  }
  const failure: unknown = cleanupResult.reason;
  if (!(failure instanceof AggregateError)) throw failure;
  expect(failure.errors).toHaveLength(5);
  expect(failure.errors[0]).toBe(pageFailure);
  expect(failure.errors[1]).toMatchObject({
    message: 'Tenant request pages remain open; routing remains installed',
  });
  expect(failure.errors[2]).toBe(routeFailure);
  expect(failure.errors[3]).toBe(settlementFailure);
  expect(failure.errors[4]).toBe(contextFailure);
  expect(context.isClosed).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
  expect(context.unroute).not.toHaveBeenCalled();
  await expect(
    routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'replacement.example.org',
    }),
  ).rejects.toThrow('Tenant request routing is already installed');
});
