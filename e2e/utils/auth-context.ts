import { Browser, Page } from '@playwright/test';

type AuthenticatedRun = (page: Page) => Promise<void>;

export async function runWithStorageState(
  browser: Browser,
  storageState: string,
  run: AuthenticatedRun,
  tenantDomain?: string,
): Promise<void> {
  const context = await browser.newContext({ storageState });
  if (tenantDomain) {
    await context.addCookies([
      {
        domain: 'localhost',
        expires: -1,
        name: 'evorto-tenant',
        path: '/',
        value: tenantDomain,
      },
    ]);
  }
  const page = await context.newPage();
  try {
    await run(page);
  } finally {
    await context.close();
  }
}
