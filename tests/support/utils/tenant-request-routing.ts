import type { BrowserContext, Page, Route } from '@playwright/test';

import { localTestTenantDomainHeader } from '../../../src/shared/request-routing';

type RoutingContext = Pick<BrowserContext, 'unroute'>;

type TenantRoute = {
  active: Set<Promise<void>>;
  closing: boolean;
  draining: Promise<void> | undefined;
  emergencyClose: Promise<void> | undefined;
  errors: unknown[];
  handler: (route: Route) => Promise<void>;
  isContextClosed: () => boolean;
  pattern: string;
  routeRemovalFailed: boolean;
};

const tenantRoutes = new WeakMap<RoutingContext, TenantRoute>();
const contextCloseAttempts = new WeakSet<RoutingContext>();

export const localTenantRequestPattern = (baseUrl: string): string =>
  `${new URL(baseUrl).origin}/**`;

export const localTenantRequestHeaders = (
  headers: Readonly<Record<string, string>>,
  tenantDomain: string,
): Record<string, string> => ({
  ...headers,
  connection: 'close',
  [localTestTenantDomainHeader]: tenantDomain,
});

export const routeLocalTenantRequests = async ({
  baseUrl,
  context,
  tenantDomain,
}: {
  baseUrl: string;
  context: Pick<
    BrowserContext,
    'close' | 'grantPermissions' | 'isClosed' | 'route' | 'unroute'
  >;
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
    emergencyClose: undefined,
    errors: [],
    handler: (route) => {
      const operation = (async () => {
        const abortOnly = state.closing;
        try {
          if (abortOnly) {
            await route.abort('aborted');
            return;
          }
          const response = await route.fetch({
            headers: localTenantRequestHeaders(
              await route.request().allHeaders(),
              tenantDomain,
            ),
            maxRedirects: 0,
          });
          await route.fulfill({ response });
        } catch (error) {
          // Route callbacks are asynchronous event listeners in Playwright.
          // Keep failures owned here instead of interrupting the test body.
          state.errors.push(error);
          if (!abortOnly) {
            try {
              await route.abort('failed');
              return;
            } catch (settlementError) {
              state.errors.push(settlementError);
            }
          }
          state.closing = true;
          // If this request cannot be settled, close its owned context once.
          // Never release it by removing interception or replaying upstream.
          if (!contextCloseAttempts.has(context)) {
            contextCloseAttempts.add(context);
            state.emergencyClose = Promise.resolve()
              .then(() => context.close())
              .catch((closeError) => {
                state.errors.push(closeError);
              });
          }
          await state.emergencyClose;
        }
      })();
      state.active.add(operation);
      void operation.then(() => state.active.delete(operation));
      return operation;
    },
    isContextClosed: () => context.isClosed(),
    pattern: localTenantRequestPattern(baseUrl),
    routeRemovalFailed: false,
  };
  tenantRoutes.set(context, state);
  await context.route(state.pattern, state.handler);
};

export const stopTenantRequestRouting = async (
  context: RoutingContext,
): Promise<void> => {
  const state = tenantRoutes.get(context);
  if (!state) return;
  if (
    (state.emergencyClose || state.routeRemovalFailed) &&
    state.isContextClosed()
  ) {
    tenantRoutes.delete(context);
  }
  if (!state.draining) {
    state.closing = true;
    state.draining = (async () => {
      // Keep interception installed until every admitted callback has finished.
      // Once this loop is empty, unroute synchronously removes our handler
      // before another callback can enter on the JavaScript event loop.
      while (state.active.size > 0) {
        await Promise.allSettled([...state.active]);
      }
      if (!state.emergencyClose) {
        try {
          await context.unroute(state.pattern, state.handler);
        } catch (error) {
          state.routeRemovalFailed = true;
          state.errors.push(error);
        }
      }
      const contextRemainsOpen =
        (state.emergencyClose !== undefined || state.routeRemovalFailed) &&
        !state.isContextClosed();
      if (!contextRemainsOpen) tenantRoutes.delete(context);
      if (state.errors.length === 1) throw state.errors[0];
      if (state.errors.length > 1) {
        throw new AggregateError(
          state.errors,
          contextRemainsOpen
            ? 'Tenant request routing cleanup failed; context remains open and routing remains installed'
            : 'Tenant request routing cleanup failed',
        );
      }
    })();
  }
  await state.draining;
};

const closeTenantRequestPagePhase = async (
  context: RoutingContext & {
    pages: () => readonly Pick<Page, 'close' | 'isClosed'>[];
  },
) => {
  const errors: unknown[] = [];
  let drainAttempted = false;
  let pages: ReturnType<typeof context.pages>;
  try {
    pages = [...context.pages()];
  } catch (error) {
    return { errors: [error], drainAttempted };
  }
  // Keep interception and the context request client alive while closing pages.
  for (const page of pages) {
    try {
      await page.close();
    } catch (error) {
      errors.push(error);
    }
  }
  let pagesClosed = false;
  try {
    pagesClosed = [...pages, ...context.pages()].every((page) =>
      page.isClosed(),
    );
  } catch (error) {
    errors.push(error);
  }
  if (!pagesClosed) {
    // The caller owns the outer context teardown. Never release live pages by
    // removing interception, or retry closing a changing set of pages here.
    errors.push(
      new Error('Tenant request pages remain open; routing remains installed'),
    );
  } else {
    drainAttempted = true;
    try {
      await stopTenantRequestRouting(context);
    } catch (error) {
      errors.push(error);
    }
  }
  return { errors, drainAttempted };
};

export const closeTenantRequestPages = async (
  context: Parameters<typeof closeTenantRequestPagePhase>[0],
): Promise<void> => {
  const { errors } = await closeTenantRequestPagePhase(context);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Tenant request page cleanup failed');
  }
};

export const closeTenantRequestContext = async (
  context: Parameters<typeof closeTenantRequestPages>[0] &
    Pick<BrowserContext, 'close' | 'isClosed'>,
): Promise<void> => {
  const { errors, drainAttempted } = await closeTenantRequestPagePhase(context);
  let closeSucceeded = false;
  if (!contextCloseAttempts.has(context)) {
    // Share the attempt with route callbacks before context disposal can fail
    // their fetch/abort operations. Neither path retries the other's close.
    contextCloseAttempts.add(context);
    try {
      await context.close();
      closeSucceeded = true;
    } catch (error) {
      errors.push(error);
    }
  }
  if (!drainAttempted) {
    const emergencyClose = tenantRoutes.get(context)?.emergencyClose;
    if (emergencyClose) {
      // Join the existing owner before checking closure; never start another
      // close when page cleanup failed while an emergency close was pending.
      try {
        await emergencyClose;
      } catch (error) {
        errors.push(error);
      }
    }
  }
  let contextClosed = false;
  try {
    contextClosed = context.isClosed();
    if (closeSucceeded && !contextClosed) {
      errors.push(new Error('Tenant request context closure is unproven'));
    }
  } catch (error) {
    errors.push(error);
  }
  if (!drainAttempted) {
    if (contextClosed) {
      // Page cleanup could not safely drain live pages. The confirmed closed
      // context now permits joining callbacks without releasing a live request.
      try {
        await stopTenantRequestRouting(context);
      } catch (error) {
        errors.push(error);
      }
    } else {
      // Keep interception and its callback ownership when closure is unproven.
      // Report errors already observed; do not start or repeat a cached drain.
      errors.push(...(tenantRoutes.get(context)?.errors ?? []));
    }
  }
  if (!contextClosed && errors.length === 0) {
    errors.push(new Error('Tenant request context closure is unproven'));
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Tenant request context cleanup failed');
  }
};
