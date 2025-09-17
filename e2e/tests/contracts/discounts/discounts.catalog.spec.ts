import { promises as fs } from 'node:fs';

import { Page } from '@playwright/test';

import { expect, test } from '../../../fixtures/parallel-test';
import { adminStateFile } from '../../../../helpers/user-data';

const SNACKBAR = 'mat-snack-bar-container';

async function loadState(statePath: string, tenantDomain: string) {
  const raw = await fs.readFile(statePath, 'utf-8');
  const state = JSON.parse(raw) as {
    cookies: Array<{
      domain: string;
      expires?: number;
      name: string;
      path: string;
      value: string;
      sameSite?: 'Strict' | 'Lax' | 'None';
      httpOnly?: boolean;
      secure?: boolean;
    }>;
    origins: unknown[];
  };

  const cookie = {
    domain: 'localhost',
    expires: -1,
    httpOnly: false,
    name: 'evorto-tenant',
    path: '/',
    sameSite: 'Lax' as const,
    secure: false,
    value: tenantDomain,
  };

  state.cookies = state.cookies.filter((c) => c.name !== 'evorto-tenant');
  state.cookies.push(cookie);
  return state;
}

async function withAdminPage(
  browser: Parameters<typeof test.extend>[0]['browser'],
  tenantDomain: string,
  run: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({ storageState: await loadState(adminStateFile, tenantDomain) });
  const page = await context.newPage();
  try {
    await page.goto('/admin/settings/discounts', {
      waitUntil: 'domcontentloaded',
    });
    await run(page);
  } finally {
    await context.close();
  }
}

async function toggleProvider(page: Page, enabled: boolean) {
  const toggle = page.getByTestId('enable-esn-provider').locator('button');
  const state = await toggle.getAttribute('aria-checked');
  if ((state === 'true') !== enabled) {
    await toggle.click();
  }
}

test.describe('Contract: discounts.catalog → getTenantProviders', () => {
  test('persists provider configuration across reloads', async ({ browser, tenant }) => {
    await withAdminPage(browser, tenant.domain, async (page) => {
      await toggleProvider(page, false);
      await page.getByTestId('save-discount-settings').click();
      await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
      await page.locator(SNACKBAR).waitFor({ state: 'detached' });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('enable-esn-provider').locator('button')).toHaveAttribute('aria-checked', 'false');

      await toggleProvider(page, true);
      const ctaToggle = page.getByTestId('esn-show-cta-toggle');
      await expect(ctaToggle).toBeVisible();
      if ((await ctaToggle.getAttribute('aria-checked')) !== 'true') {
        await ctaToggle.click();
      }

      await page.getByTestId('save-discount-settings').click();
      await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
      await page.locator(SNACKBAR).waitFor({ state: 'detached' });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('enable-esn-provider').locator('button')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('esn-show-cta-toggle').locator('button')).toHaveAttribute('aria-checked', 'true');
    });
  });
});
