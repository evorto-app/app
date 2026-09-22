import type { BrowserContext, Page, Route } from '@playwright/test';

import { localTestTenantDomainHeader } from '../../../src/shared/request-routing';

type RoutingContext = Pick<BrowserContext, 'unroute'>;

type TenantRoute = {
  active: Set<Promise<void>>;
  pendingSettlements: Set<() => Promise<void>>;
  closing: boolean;
  drainFailure: { error: unknown; observedErrorCount: number } | undefined;
  draining: Promise<void> | undefined;
  emergencyClose: Promise<void> | undefined;
  errors: unknown[];
  handler: (route: Route) => Promise<void>;
  isContextClosed: () => boolean;
  ownedContextClosing: boolean;
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
    pendingSettlements: new Set(),
    closing: false,
    drainFailure: undefined,
    draining: undefined,
    emergencyClose: undefined,
    errors: [],
    handler: (route) => {
      let settlement: Promise<void> | undefined;
      const settle = (action: () => Promise<void>) => {
        if (!settlement) {
          const pending = Promise.withResolvers<void>();
          settlement = pending.promise;
          void settlement.then(
            () => state.pendingSettlements.delete(cancel),
            () => state.pendingSettlements.delete(cancel),
          );
          // Reserve the terminal action before calling it, but send a late
          // cancellation immediately rather than queueing another microtask.
          try {
            pending.resolve(action());
          } catch (error) {
            pending.reject(error);
          }
        }
        return settlement;
      };
      const cancel = () => settle(() => route.abort('aborted'));
      state.pendingSettlements.add(cancel);
      const operation = (async () => {
        const abortOnly = state.closing;
        try {
          if (abortOnly) {
            await cancel();
            return;
          }
          const headers = await route.request().allHeaders();
          if (state.closing) {
            await cancel();
            return;
          }
          const response = await route.fetch({
            headers: localTenantRequestHeaders(headers, tenantDomain),
            maxRedirects: 0,
          });
          await settle(() => route.fulfill({ response }));
        } catch (error) {
          // Route callbacks are asynchronous event listeners in Playwright.
          // Keep failures owned here instead of interrupting the test body.
          state.errors.push(error);
          if (!abortOnly) {
            try {
              await settle(() => route.abort('failed'));
              return;
            } catch (settlementError) {
              if (settlementError !== error) state.errors.push(settlementError);
            }
          }
          state.closing = true;
          // If this request cannot be settled, close its owned context once.
          // Never release it by removing interception or replaying upstream.
          if (!contextCloseAttempts.has(context)) {
            contextCloseAttempts.add(context);
            state.emergencyClose = settleTenantRequestsBeforeClosure(
              context,
              state.errors,
              () => context.close(),
            ).catch((closeError) => {
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
    ownedContextClosing: false,
    pattern: localTenantRequestPattern(baseUrl),
    routeRemovalFailed: false,
  };
  tenantRoutes.set(context, state);
  await context.route(state.pattern, state.handler);
};

const drainTenantRoute = async (state: TenantRoute): Promise<void> => {
  state.closing = true;
  while (state.active.size > 0) {
    await Promise.allSettled([...state.active]);
  }
};

const throwTenantRouteErrors = (
  state: TenantRoute,
  contextRemainsOpen: boolean,
): void => {
  if (state.errors.length === 1) throw state.errors[0];
  if (state.errors.length > 1) {
    throw new AggregateError(
      state.errors,
      contextRemainsOpen
        ? 'Tenant request routing cleanup failed; context remains open and routing remains installed'
        : 'Tenant request routing cleanup failed',
    );
  }
};

export const stopTenantRequestRouting = async (
  context: RoutingContext,
): Promise<void> => {
  const state = tenantRoutes.get(context);
  if (!state) return;
  if (state.ownedContextClosing) {
    // The context owner releases interception through confirmed disposal.
    // A concurrent stop may drain callbacks, but cannot release a live context.
    await drainTenantRoute(state);
    const contextRemainsOpen = !state.isContextClosed();
    if (!contextRemainsOpen) tenantRoutes.delete(context);
    throwTenantRouteErrors(state, contextRemainsOpen);
    return;
  }
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
      if (!state.emergencyClose && !state.ownedContextClosing) {
        try {
          await context.unroute(state.pattern, state.handler);
        } catch (error) {
          state.routeRemovalFailed = true;
          state.errors.push(error);
        }
      }
      const contextRemainsOpen =
        (state.ownedContextClosing ||
          state.emergencyClose !== undefined ||
          state.routeRemovalFailed) &&
        !state.isContextClosed();
      if (!contextRemainsOpen) tenantRoutes.delete(context);
      try {
        throwTenantRouteErrors(state, contextRemainsOpen);
      } catch (error) {
        state.drainFailure = { error, observedErrorCount: state.errors.length };
        throw error;
      }
    })();
  }
  await state.draining;
};

const settleTenantRequestsBeforeClosure = async (
  context: RoutingContext,
  errors: unknown[],
  close?: () => Promise<void>,
): Promise<void> => {
  const routing = tenantRoutes.get(context);
  if (routing) {
    routing.closing = true;
    // Chromium can resume paused requests without tenant headers on closure.
    // Include callbacks admitted while an earlier settlement was pending.
    while (routing.pendingSettlements.size > 0) {
      const pending = [...routing.pendingSettlements].map((settle) => settle());
      for (const result of await Promise.allSettled(pending)) {
        if (result.status === 'rejected') errors.push(result.reason);
      }
    }
  }
  // Invoke closure in the same turn that observed an empty settlement set.
  // Awaiting a separate drain before calling close would reopen admission.
  if (close) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
};

const closeTenantRequestPagePhase = async (
  context: RoutingContext & {
    pages: () => readonly Pick<Page, 'close' | 'isClosed'>[];
  },
  retainRouting = false,
) => {
  const errors: unknown[] = [];
  let drainAttempted = false;
  // Inventory can fail. Cancel already admitted browser requests even when
  // owned context disposal must proceed without enumerating its pages.
  await settleTenantRequestsBeforeClosure(context, errors);
  let pages: ReturnType<typeof context.pages>;
  try {
    pages = [...context.pages()];
  } catch (error) {
    errors.push(error);
    return { errors, drainAttempted };
  }
  // Keep interception and the context request client alive while closing pages.
  for (const page of pages) {
    await settleTenantRequestsBeforeClosure(context, errors, () =>
      page.close(),
    );
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
      const state = tenantRoutes.get(context);
      if (retainRouting && state) await drainTenantRoute(state);
      else await stopTenantRequestRouting(context);
    } catch (error) {
      errors.push(error);
    }
  }
  return { errors, drainAttempted };
};

export const closeTenantRequestPages = async (
  context: Parameters<typeof closeTenantRequestPagePhase>[0],
): Promise<void> => {
  const state = tenantRoutes.get(context);
  const { errors, drainAttempted } = await closeTenantRequestPagePhase(context);
  if (!drainAttempted && state) {
    // Preserve failures already observed without waiting for requests that
    // still need outer context disposal. Keep them owned for a later drain.
    for (const error of state.errors) {
      if (!errors.includes(error)) errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Tenant request page cleanup failed');
  }
};

export const closeTenantRequestContext = async (
  context: Parameters<typeof closeTenantRequestPages>[0] &
    Pick<BrowserContext, 'close' | 'isClosed'>,
): Promise<void> => {
  const state = tenantRoutes.get(context);
  if (state) state.ownedContextClosing = true;
  const { errors, drainAttempted } = await closeTenantRequestPagePhase(
    context,
    true,
  );
  if (state) state.closing = true;
  let closeSucceeded = false;
  await settleTenantRequestsBeforeClosure(context, errors, async () => {
    if (!contextCloseAttempts.has(context)) {
      // Recheck after settlements: a failed cancellation may already have
      // started emergency disposal. Neither owner retries the other's close.
      contextCloseAttempts.add(context);
      await context.close();
      closeSucceeded = true;
    }
  });
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
  if (contextClosed) {
    // Confirmed disposal removes interception. Join callbacks admitted during
    // closure before releasing their ownership or reporting their failures.
    try {
      await stopTenantRequestRouting(context);
    } catch (error) {
      errors.push(error);
    }
  } else {
    // Keep interception and its callback ownership when closure is unproven.
    // Report errors already observed; do not wait on requests needing disposal.
    const retained = state?.drainFailure;
    if (state && retained) {
      errors.push(retained.error);
      errors.push(...state.errors.slice(retained.observedErrorCount));
    } else {
      errors.push(...(state?.errors ?? []));
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
