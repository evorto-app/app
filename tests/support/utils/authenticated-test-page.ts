import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { DateTime } from 'luxon';

import { resolveStorageState } from './storage-state';

import {
  closeTenantRequestContext,
  routeLocalTenantRequests,
} from './tenant-request-routing';

export interface AuthenticatedTestPage {
  close: () => Promise<void>;
  context: BrowserContext;
  page: Page;
}

export const openAuthenticatedTestPage = async ({
  baseUrl,
  browser,
  storageState,
  tenantDomain,
  testClock,
}: {
  baseUrl: string;
  browser: Pick<Browser, 'newContext'>;
  storageState: string;
  tenantDomain: string;
  testClock: DateTime;
}): Promise<AuthenticatedTestPage> => {
  const resolvedBaseUrl = new URL(baseUrl);
  const savedState = resolveStorageState(storageState);
  const context = await browser.newContext({
    baseURL: resolvedBaseUrl.origin,
    colorScheme: 'light',
    ignoreHTTPSErrors: true,
    storageState: savedState,
  });

  try {
    await routeLocalTenantRequests({
      baseUrl: resolvedBaseUrl.origin,
      context,
      tenantDomain,
    });
    await context.addInitScript((fixedNow) => {
      const hostname = globalThis.location?.hostname ?? '';
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        return;
      }
      const realDate = Date;
      class FixedDate extends realDate {
        constructor(...args: [] | ConstructorParameters<typeof realDate>) {
          if (args.length === 0) {
            super(fixedNow);
            return;
          }
          super(...args);
        }

        static override now() {
          return fixedNow;
        }
      }

      FixedDate.parse = realDate.parse;
      FixedDate.UTC = realDate.UTC;
      // @ts-expect-error Browser runtime override for deterministic tests.
      globalThis.Date = FixedDate;
    }, testClock.toMillis());
    return {
      close: () => closeTenantRequestContext(context),
      context,
      page: await context.newPage(),
    };
  } catch (error) {
    try {
      await closeTenantRequestContext(context);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Authenticated test page setup and cleanup failed',
        { cause: cleanupError },
      );
    }
    throw error;
  }
};
