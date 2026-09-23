import type { BrowserContext } from '@playwright/test';

import { closeTenantRequestPages } from './tenant-request-routing';

export const closeApplicationPages = async (
  context: Pick<BrowserContext, 'pages' | 'unroute'>,
): Promise<void> => {
  const errors: unknown[] = [];
  const navigatedPages = new Set<ReturnType<typeof context.pages>[number]>();
  try {
    for (;;) {
      const pages = context.pages().filter((page) => !navigatedPages.has(page));
      if (pages.length === 0) break;
      for (const page of pages) {
        navigatedPages.add(page);
        if (page.isClosed()) continue;
        try {
          // Discard application callbacks before intentionally aborting requests.
          // Recheck for pages opened while an earlier navigation was pending.
          // Interception stays installed throughout navigation and page closure.
          await page.goto('about:blank', { waitUntil: 'commit' });
        } catch (error) {
          if (!page.isClosed()) errors.push(error);
        }
      }
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    await closeTenantRequestPages(context);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Application page cleanup failed');
  }
};
