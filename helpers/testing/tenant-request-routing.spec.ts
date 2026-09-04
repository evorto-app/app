import { describe, expect, it, vi } from 'vitest';

import { localTestTenantDomainHeader } from '../../src/shared/request-routing';
import {
  closeTenantRequestContext,
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
      grantPermissions: vi.fn(async () => {}),
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
      grantPermissions: vi.fn(async () => {}),
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
