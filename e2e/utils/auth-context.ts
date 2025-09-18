import { Browser, Page } from '@playwright/test';

type AuthenticatedRun = (page: Page) => Promise<void>;

export async function runWithStorageState(
  browser: Browser,
  storageState: string,
  run: AuthenticatedRun,
): Promise<void> {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  try {
    await run(page);
  } finally {
    await context.close();
  }
}
