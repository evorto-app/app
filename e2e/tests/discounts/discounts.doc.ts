import { promises as fs } from 'node:fs';

import { Page } from '@playwright/test';

import {
  adminStateFile,
  userStateFile,
} from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

const SNACKBAR = 'mat-snack-bar-container';
const CTA_SECTION = '[data-testid="esn-cta-section"]';
const CARD_IDENTIFIER_CELL = '[data-testid="refresh-esn-card"]';

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

test.describe('Documentation: Discount provider journey', () => {
  test('admin configures ESN provider and member registers a card', async ({ browser, tenant }, testInfo) => {
    test.skip(true, 'ESN card validation requires reliable upstream test numbers.');
    await withContext(browser, tenant.domain, adminStateFile, async (adminPage) => {
      await adminPage.goto('/admin/settings/discounts', {
        waitUntil: 'domcontentloaded',
      });

      const providerToggle = adminPage
        .getByTestId('enable-esn-provider')
        .getByRole('switch');
      if ((await providerToggle.getAttribute('aria-checked')) !== 'true') {
        await providerToggle.click();
        await expect(providerToggle).toHaveAttribute('aria-checked', 'true');
      }

      const ctaToggle = adminPage
        .getByTestId('esn-show-cta-toggle')
        .getByRole('switch');
      await expect(ctaToggle).toBeVisible();
      if ((await ctaToggle.getAttribute('aria-checked')) !== 'true') {
        await ctaToggle.click();
        await expect(ctaToggle).toHaveAttribute('aria-checked', 'true');
      }

      await adminPage.getByTestId('save-discount-settings').click();
      await expect(adminPage.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
      await adminPage.locator(SNACKBAR).waitFor({ state: 'detached' });

      await takeScreenshot(testInfo, adminPage, adminPage, 'Admin enables ESN provider');
    });

    await withContext(browser, tenant.domain, userStateFile, async (userPage) => {
      await userPage.goto('/profile/discount-cards', {
        waitUntil: 'domcontentloaded',
      });
      await expect(userPage.locator(CTA_SECTION)).toBeVisible();
      await takeScreenshot(testInfo, userPage.locator(CTA_SECTION), userPage, 'CTA encourages ESN registration');

      const identifier = `ESN-DOC-${Date.now()}`;
      await userPage.getByTestId('esn-card-input').fill(identifier);
      await userPage.getByTestId('add-esn-card-button').click();
      await expect(userPage.locator(SNACKBAR)).toContainText('Card added successfully');
      await userPage.locator(SNACKBAR).waitFor({ state: 'detached' });

      const cardPanel = userPage.locator(CARD_IDENTIFIER_CELL).first().locator('..').locator('..');
      await expect(cardPanel).toContainText(identifier);
      await expect(cardPanel).toContainText('Verified');
      await takeScreenshot(testInfo, cardPanel, userPage, 'Verified ESN card on file');

      userPage.once('dialog', (dialog) => dialog.accept());
      await userPage.getByTestId('delete-esn-card').click();
      await expect(userPage.locator(SNACKBAR)).toContainText('Card deleted successfully');
      await userPage.locator(SNACKBAR).waitFor({ state: 'detached' });
    });

    await testInfo.attach('markdown', {
      body: `\n## Discount provider journey\n\n1. Administrators enable the ESN provider and optional CTA in Admin → Settings → Discounts.\n2. Members visit Profile → Discount cards, see the CTA, and add their identifier.\n3. The card verifies immediately and is managed from the same screen.\n`,
    });
  });
});
