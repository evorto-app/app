import { Browser, Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';

import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../../../helpers/user-data';
import * as schema from '../../../../../src/db/schema';
import { test as base, expect } from '../../../../fixtures/parallel-test';
import { runWithStorageState } from '../../../../utils/auth-context';

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

const test = base.extend<{
  seedSecondaryCard: (identifier: string) => Promise<void>;
}>({
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

test.use({ seedDiscounts: false, storageState: userStateFile });

const providerSwitch = (page: Page) =>
  page.getByTestId('enable-esn-provider').getByRole('switch');

const ctaSwitch = (page: Page) =>
  page.getByTestId('esn-show-cta-toggle').getByRole('switch');

async function updateProvider(options: {
  browser: Browser;
  enabled: boolean;
  showCta?: boolean;
}) {
  const { browser, enabled, showCta = true } = options;
  await runWithStorageState(
    browser,
    adminStateFile,
    async (page) => {
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
      await expect(page.locator(SNACKBAR)).toContainText(
        'Discount settings saved successfully',
      );
      await page.locator(SNACKBAR).waitFor({ state: 'detached' });
    },
  );
}

test.describe('Contract: discounts.cards CRUD (getMyCards, upsertMyCard, deleteMyCard)', () => {
  test.beforeEach(async ({ browser, database, tenant }) => {
    await database
      .delete(schema.userDiscountCards)
      .where(
        and(
          eq(schema.userDiscountCards.tenantId, tenant.id),
          eq(schema.userDiscountCards.userId, primaryUser.id),
        ),
      );

    await updateProvider({
      browser,
      enabled: true,
    });
  });

  test('shows CTA when enabled and no card is on file', async ({ page }) => {
    await page.goto('/profile/discount-cards', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator(CTA_SECTION)).toBeVisible();
  });

  test('rejects invalid ESN card numbers', async ({ page }) => {
    test.skip(
      true,
      'ESN card validation requires reliable upstream test numbers.',
    );
    await page.goto('/profile/discount-cards', {
      waitUntil: 'domcontentloaded',
    });
    await page.getByTestId('esn-card-input').fill('ESN-INVALID-0000');
    await page.getByTestId('add-esn-card-button').click();
    await expect(page.locator(SNACKBAR)).toContainText('Card is not active');
  });

  test('enforces uniqueness across users before validation', async ({
    page,
    seedSecondaryCard,
  }) => {
    test.skip(
      true,
      'ESN card validation requires reliable upstream test numbers.',
    );
    const duplicateId = `ESN-DUP-${Date.now()}`;

    await seedSecondaryCard(duplicateId);

    await page.goto('/profile/discount-cards', {
      waitUntil: 'domcontentloaded',
    });
    await page.getByTestId('esn-card-input').fill(duplicateId);
    await page.getByTestId('add-esn-card-button').click();
    await expect(page.locator(SNACKBAR)).toContainText(
      'Card is already in use by another user',
    );
  });

  test('blocks card creation when provider is disabled', async ({
    browser,
    page,
    tenant,
  }) => {
    test.skip(
      true,
      'ESN card validation requires reliable upstream test numbers.',
    );
    await updateProvider({
      browser,
      enabled: false,
      tenantDomain: tenant.domain,
    });

    await page.goto('/profile/discount-cards', {
      waitUntil: 'domcontentloaded',
    });
    await page.getByTestId('esn-card-input').fill(`ESN-DIS-${Date.now()}`);
    await page.getByTestId('add-esn-card-button').click();
    await expect(page.locator(SNACKBAR)).toContainText(
      'Provider not enabled for this tenant',
    );

    await updateProvider({
      browser,
      enabled: true,
      tenantDomain: tenant.domain,
    });
  });

  test('allows adding and deleting a verified card', async ({ page }) => {
    test.skip(
      true,
      'ESN card validation requires reliable upstream test numbers.',
    );
    const identifier = `ESN-SUCCESS-${Date.now()}`;

    await page.goto('/profile/discount-cards', {
      waitUntil: 'domcontentloaded',
    });
    await page.getByTestId('esn-card-input').fill(identifier);
    await page.getByTestId('add-esn-card-button').click();
    await expect(page.locator(SNACKBAR)).toContainText(
      'Card added successfully',
    );
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });

    const cardSection = page
      .locator(CARD_IDENTIFIER_CELL)
      .first()
      .locator('..')
      .locator('..');
    await expect(cardSection).toContainText(identifier);
    await expect(cardSection).toContainText('Verified');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('delete-esn-card').click();
    await expect(page.locator(SNACKBAR)).toContainText(
      'Card deleted successfully',
    );
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });
    await expect(page.locator(CARD_IDENTIFIER_CELL)).toHaveCount(0);
  });
});
