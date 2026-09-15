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

describe('local tenant request routing', () => {
  it('matches only the application origin', () => {
    expect(
      localTenantRequestPattern('http://localhost:4200/admin/settings'),
    ).toBe('http://localhost:4200/**');
  });

  it('adds the tenant header without changing the original headers', () => {
    const original = { accept: 'application/json' };

    expect(
      localTenantRequestHeaders(original, 'north-river.evorto.app'),
    ).toEqual({
      accept: 'application/json',
      [localTestTenantDomainHeader]: 'north-river.evorto.app',
    });
    expect(original).toEqual({ accept: 'application/json' });
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
    const context = {
      grantPermissions: async () => {},
      isClosed: () => false,
      route: registerRoute,
      unroute: async () => {
        throw failure;
      },
      close: vi.fn(async () => {}),
    };
    await routeLocalTenantRequests({
      baseUrl: 'http://localhost:4200',
      context,
      tenantDomain: 'north-river.evorto.app',
    });
    await expect(closeTenantRequestContext(context)).rejects.toBe(failure);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('retains both route removal and context-close failures', async () => {
    const routeFailure = new Error('route removal failed');
    const closeFailure = new Error('context close failed');
    const context = {
      grantPermissions: async () => {},
      isClosed: () => false,
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
    await expect(closeTenantRequestContext(context)).rejects.toMatchObject({
      errors: [routeFailure, closeFailure],
    });
  });

  it('closes a context whose routing setup never ran', async () => {
    const context = {
      unroute: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    await closeTenantRequestContext(context);
    expect(context.unroute).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });
});

describe('tenant request page lifetime', () => {
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
