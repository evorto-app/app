import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { DateTime } from 'luxon';

export interface AuthenticatedTestPage {
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
  browser: Browser;
  storageState: string;
  tenantDomain: string;
  testClock: DateTime;
}): Promise<AuthenticatedTestPage> => {
  const resolvedBaseUrl = new URL(baseUrl);
  const context = await browser.newContext({
    baseURL: resolvedBaseUrl.origin,
    colorScheme: 'light',
    ignoreHTTPSErrors: true,
    storageState,
  });

  try {
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
    await context.addCookies([
      {
        domain: resolvedBaseUrl.hostname,
        expires: -1,
        name: 'evorto-tenant',
        path: '/',
        value: tenantDomain,
      },
    ]);

    return {
      context,
      page: await context.newPage(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
};
