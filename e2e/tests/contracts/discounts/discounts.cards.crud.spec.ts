import { promises as fs } from 'node:fs';

import { and, eq } from 'drizzle-orm';
import { Page } from '@playwright/test';

import { expect, test as base } from '../../../fixtures/parallel-test';
import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../../helpers/user-data';
import * as schema from '../../../../src/db/schema';

const primaryUser = usersToAuthenticate.find((user) => user.roles === 'user');
if (!primaryUser) {
  throw new Error('Expected regular user credentials to be present.');
}

const secondaryUser = usersToAuthenticate.find(
  (user) => user.email === 'testuser2@evorto.app',
);
if (!secondaryUser) {
  throw new Error('Expected secondary test user credentials to be present.');
}

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

async function withStateContext(
  browser: Parameters<typeof test.extend>[0]['browser'],
  tenantDomain: string,
  statePath: string,
  run: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({ storageState: await loadState(statePath, tenantDomain) });
  const page = await context.newPage();
  try {
    await page.goto('/events', { waitUntil: 'domcontentloaded' });
    await run(page);
  } finally {
    await context.close();
  }
}

const test = base.extend<{
  clearPrimaryDiscountCards: void;
  seedSecondaryCard: (identifier: string) => Promise<void>;
}>({
  clearPrimaryDiscountCards: [
    async ({ database, tenant }, use) => {
      const clear = () =>
        database
          .delete(schema.userDiscountCards)
          .where(
            and(
              eq(schema.userDiscountCards.tenantId, tenant.id),
              eq(schema.userDiscountCards.userId, primaryUser.id),
            ),
          );

      await clear();
      await use();
      await clear();
    },
    { auto: true },
  ],
  seedSecondaryCard: async ({ database, tenant }, use) => {
    await use(async (identifier: string) => {
      await database
        .delete(schema.userDiscountCards)
        .where(
          and(
            eq(schema.userDiscountCards.tenantId, tenant.id),
            eq(schema.userDiscountCards.userId, secondaryUser.id),
          ),
        );

      await database.insert(schema.userDiscountCards).values({
        identifier,
        status: 'verified',
        tenantId: tenant.id,
        type: 'esnCard',
        userId: secondaryUser.id,
        validFrom: new Date(),
        validTo: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90),
      });
    });
  },
});

const providerSwitch = (page: Page) =>
  page.getByTestId('enable-esn-provider').getByRole('switch');

const ctaSwitch = (page: Page) =>
  page.getByTestId('esn-show-cta-toggle').getByRole('switch');

async function updateProvider(options: {
  browser: Parameters<typeof test.extend>[0]['browser'];
  enabled: boolean;
  tenantDomain: string;
  showCta?: boolean;
}) {
  const { browser, enabled, tenantDomain, showCta = true } = options;
  await withStateContext(browser, tenantDomain, adminStateFile, async (page) => {
    await page.goto('/admin/settings/discounts', {
      waitUntil: 'domcontentloaded',
    });

    const providerToggle = providerSwitch(page);
    const desired = enabled ? 'true' : 'false';
    if ((await providerToggle.getAttribute('aria-checked')) !== desired) {
      await providerToggle.click();
      await expect(providerToggle).toHaveAttribute('aria-checked', desired);
    }

    if (enabled) {
      const ctaToggle = ctaSwitch(page);
      const ctaDesired = showCta ? 'true' : 'false';
      await expect(ctaToggle).toBeVisible();
      if ((await ctaToggle.getAttribute('aria-checked')) !== ctaDesired) {
        await ctaToggle.click();
        await expect(ctaToggle).toHaveAttribute('aria-checked', ctaDesired);
      }
    }

    await page.getByTestId('save-discount-settings').click();
    await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });
  });
}

async function visitUserDiscountPage(
  browser: Parameters<typeof test.extend>[0]['browser'],
  tenantDomain: string,
  run: (page: Page) => Promise<void>,
) {
  await withStateContext(browser, tenantDomain, userStateFile, async (page) => {
    await page.goto('/profile/discount-cards', {
      waitUntil: 'domcontentloaded',
    });
    await run(page);
  });
}

test.describe('Contract: discounts.cards CRUD (getMyCards, upsertMyCard, deleteMyCard)', () => {
  test.beforeEach(async ({ browser, tenant }) => {
    await updateProvider({
      browser,
      enabled: true,
      tenantDomain: tenant.domain,
    });
  });

  test('shows CTA when enabled and no card is on file', async ({ browser, tenant }) => {
    await visitUserDiscountPage(browser, tenant.domain, async (page) => {
      await expect(page.locator(CTA_SECTION)).toBeVisible();
    });
  });

  test('rejects invalid ESN card numbers', async ({ browser, tenant }) => {
    test.skip(true, 'ESN card validation requires reliable upstream test numbers.');
    await visitUserDiscountPage(browser, tenant.domain, async (page) => {
      await page.getByTestId('esn-card-input').fill('ESN-INVALID-0000');
      await page.getByTestId('add-esn-card-button').click();
      await expect(page.locator(SNACKBAR)).toContainText('Card is not active');
    });
  });

  test('enforces uniqueness across users before validation', async ({
    browser,
    seedSecondaryCard,
    tenant,
  }) => {
    test.skip(true, 'ESN card validation requires reliable upstream test numbers.');
    const duplicateId = `ESN-DUP-${Date.now()}`;

    await seedSecondaryCard(duplicateId);

    await visitUserDiscountPage(browser, tenant.domain, async (page) => {
      await page.getByTestId('esn-card-input').fill(duplicateId);
      await page.getByTestId('add-esn-card-button').click();
      await expect(page.locator(SNACKBAR)).toContainText('Card is already in use by another user');
    });
  });

  test('blocks card creation when provider is disabled', async ({ browser, tenant }) => {
    test.skip(true, 'ESN card validation requires reliable upstream test numbers.');
    await updateProvider({
      browser,
      enabled: false,
      tenantDomain: tenant.domain,
    });

    await visitUserDiscountPage(browser, tenant.domain, async (page) => {
      await page.getByTestId('esn-card-input').fill(`ESN-DIS-${Date.now()}`);
      await page.getByTestId('add-esn-card-button').click();
      await expect(page.locator(SNACKBAR)).toContainText('Provider not enabled for this tenant');
    });

    await updateProvider({
      browser,
      enabled: true,
      tenantDomain: tenant.domain,
    });
  });

  test('allows adding and deleting a verified card', async ({ browser, tenant }) => {
    test.skip(true, 'ESN card validation requires reliable upstream test numbers.');
    const identifier = `ESN-SUCCESS-${Date.now()}`;

    await visitUserDiscountPage(browser, tenant.domain, async (page) => {
      await page.getByTestId('esn-card-input').fill(identifier);
      await page.getByTestId('add-esn-card-button').click();
      await expect(page.locator(SNACKBAR)).toContainText('Card added successfully');
      await page.locator(SNACKBAR).waitFor({ state: 'detached' });

      const cardSection = page.locator(CARD_IDENTIFIER_CELL).first().locator('..').locator('..');
      await expect(cardSection).toContainText(identifier);
      await expect(cardSection).toContainText('Verified');

      page.once('dialog', (dialog) => dialog.accept());
      await page.getByTestId('delete-esn-card').click();
      await expect(page.locator(SNACKBAR)).toContainText('Card deleted successfully');
      await page.locator(SNACKBAR).waitFor({ state: 'detached' });
      await expect(page.locator(CARD_IDENTIFIER_CELL)).toHaveCount(0);
    });
  });
});
