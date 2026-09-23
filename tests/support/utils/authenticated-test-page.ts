import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { DateTime } from 'luxon';

import { resolveStorageState } from './storage-state';

import {
  closeApplicationContext,
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
      const startedAt = performance.now();
      const currentTime = () =>
        Math.floor(fixedNow + (performance.now() - startedAt));
      class FixedDate extends realDate {
        constructor(...args: [] | ConstructorParameters<typeof realDate>) {
          if (args.length === 0) {
            super(currentTime());
            return;
          }
          super(...args);
        }

        static override now() {
          return currentTime();
        }
      }

      FixedDate.parse = realDate.parse;
      FixedDate.UTC = realDate.UTC;
      // @ts-expect-error Browser runtime override for deterministic tests.
      globalThis.Date = FixedDate;
    }, testClock.toMillis());
    return {
      close: () => closeApplicationContext(context),
      context,
      page: await context.newPage(),
    };
  } catch (error) {
    try {
      await closeApplicationContext(context);
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
