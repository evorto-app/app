import type { BrowserContext, Route } from '@playwright/test';

import { localTestTenantDomainHeader } from '../../../src/shared/request-routing';

type RoutingContext = Pick<BrowserContext, 'unroute'>;

type TenantRoute = {
  active: Set<Promise<void>>;
  closing: boolean;
  draining: Promise<void> | undefined;
  errors: unknown[];
  handler: (route: Route) => Promise<void>;
  pattern: string;
};

const tenantRoutes = new WeakMap<RoutingContext, TenantRoute>();

export const localTenantRequestPattern = (baseUrl: string): string =>
  `${new URL(baseUrl).origin}/**`;

export const localTenantRequestHeaders = (
  headers: Readonly<Record<string, string>>,
  tenantDomain: string,
): Record<string, string> => ({
  ...headers,
  [localTestTenantDomainHeader]: tenantDomain,
});

export const routeLocalTenantRequests = async ({
  baseUrl,
  context,
  tenantDomain,
}: {
  baseUrl: string;
  context: Pick<BrowserContext, 'grantPermissions' | 'route' | 'unroute'>;
  tenantDomain: string;
}): Promise<void> => {
  if (tenantRoutes.has(context)) {
    throw new Error(
      'Tenant request routing is already installed for this context',
    );
  }
  const applicationUrl = new URL(baseUrl);
  if (
    ['localhost', '127.0.0.1', '[::1]'].includes(applicationUrl.hostname) &&
    ['http:', 'https:'].includes(applicationUrl.protocol)
  ) {
    // Chromium treats fulfilled documents as an unknown network address space.
    // Allow this local test origin to load the separate loopback storage origin.
    await context.grantPermissions(['local-network-access'], {
      origin: applicationUrl.origin,
    });
  }
  const state: TenantRoute = {
    active: new Set(),
    closing: false,
    draining: undefined,
    errors: [],
    handler: (route) => {
      const operation = (async () => {
        if (state.closing) {
          await route.abort('aborted');
          return;
        }
        const response = await route.fetch({
          headers: localTenantRequestHeaders(
            route.request().headers(),
            tenantDomain,
          ),
          maxRedirects: 0,
        });
        await route.fulfill({ response });
      })();
      state.active.add(operation);
      void operation.then(
        () => state.active.delete(operation),
        (error) => {
          state.errors.push(error);
          state.active.delete(operation);
        },
      );
      return operation;
    },
    pattern: localTenantRequestPattern(baseUrl),
  };
  tenantRoutes.set(context, state);
  await context.route(state.pattern, state.handler);
};

export const stopTenantRequestRouting = async (
  context: RoutingContext,
): Promise<void> => {
  const state = tenantRoutes.get(context);
  if (!state) return;
  if (!state.draining) {
    state.closing = true;
    state.draining = (async () => {
      // Keep interception installed until every admitted callback has finished.
      // Once this loop is empty, unroute synchronously removes our handler
      // before another callback can enter on the JavaScript event loop.
      while (state.active.size > 0) {
        await Promise.allSettled([...state.active]);
      }
      try {
        await context.unroute(state.pattern, state.handler);
      } catch (error) {
        state.errors.push(error);
      }
      tenantRoutes.delete(context);
      if (state.errors.length === 1) throw state.errors[0];
      if (state.errors.length > 1) {
        throw new AggregateError(
          state.errors,
          'Tenant request routing cleanup failed',
        );
      }
    })();
  }
  await state.draining;
};

export const closeTenantRequestContext = async (
  context: Pick<BrowserContext, 'close' | 'unroute'>,
): Promise<void> => {
  const errors: unknown[] = [];
  try {
    await stopTenantRequestRouting(context);
  } catch (error) {
    errors.push(error);
  }
  try {
    await context.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Tenant request context cleanup failed');
  }
};
