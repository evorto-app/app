import { promises as fs } from 'node:fs';

import { Page } from '@playwright/test';

import { expect, test } from '../../../fixtures/parallel-test';
import {
  adminStateFile,
  userStateFile,
} from '../../../../helpers/user-data';

const SNACKBAR = 'mat-snack-bar-container';
const CTA_SECTION = '[data-testid="esn-cta-section"]';

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

async function withContext(
  browser: Parameters<typeof test.extend>[0]['browser'],
  tenantDomain: string,
  statePath: string,
  run: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({ storageState: await loadState(statePath, tenantDomain) });
  const page = await context.newPage();
  try {
    await run(page);
  } finally {
    await context.close();
  }
}

test.describe('Contract: discounts.setTenantProviders', () => {
  test('updates tenant providers and reflects on the user profile', async ({ browser, tenant }) => {
    await withContext(browser, tenant.domain, adminStateFile, async (page) => {
      await page.goto('/admin/settings/discounts', {
        waitUntil: 'domcontentloaded',
      });

      const providerToggle = page.getByTestId('enable-esn-provider').locator('button');
      if ((await providerToggle.getAttribute('aria-checked')) !== 'true') {
        await providerToggle.click();
      }

      const ctaToggle = page.getByTestId('esn-show-cta-toggle');
      await expect(ctaToggle).toHaveCount(1);
      const ctaButton = ctaToggle.locator('button');
      if ((await ctaButton.getAttribute('aria-checked')) === 'true') {
        await ctaButton.click();
      }

      await page.getByTestId('save-discount-settings').click();
      await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
      await page.locator(SNACKBAR).waitFor({ state: 'detached' });
    });

    await withContext(browser, tenant.domain, userStateFile, async (page) => {
      await page.goto('/profile/discount-cards', {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator(CTA_SECTION)).toHaveCount(0);
    });

    await withContext(browser, tenant.domain, adminStateFile, async (page) => {
      await page.goto('/admin/settings/discounts', {
        waitUntil: 'domcontentloaded',
      });
      const ctaToggle = page.getByTestId('esn-show-cta-toggle');
      if ((await ctaToggle.locator('button').getAttribute('aria-checked')) !== 'true') {
        await ctaToggle.locator('button').click();
        await page.getByTestId('save-discount-settings').click();
        await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
        await page.locator(SNACKBAR).waitFor({ state: 'detached' });
      }
    });

    await withContext(browser, tenant.domain, userStateFile, async (page) => {
      await page.goto('/profile/discount-cards', {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator(CTA_SECTION)).toBeVisible();
    });
  });
});
