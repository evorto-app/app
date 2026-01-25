import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { and, eq } from 'drizzle-orm';

import { userStateFile, usersToAuthenticate } from '../../../../../helpers/user-data';
import { relations } from '../../../../../src/db/relations';
import * as schema from '../../../../../src/db/schema';
import { test as base, expect } from '../../../../fixtures/parallel-test';

const primaryUser = usersToAuthenticate.find((user) => user.roles === 'user');
if (!primaryUser) {
  throw new Error('Expected regular user credentials to be present.');
}

const secondaryUser = usersToAuthenticate.find((user) => user.email === 'testuser2@evorto.app');
if (!secondaryUser) {
  throw new Error('Expected secondary test user credentials to be present.');
}

const SNACKBAR = 'mat-snack-bar-container';
const CTA_LINK_TEXT = 'Get your ESNcard →';

const test = base.extend<{
  clearPrimaryCards: void;
  seedSecondaryCard: (identifier: string) => Promise<void>;
}>({
  clearPrimaryCards: [
    async ({ database, tenant }, use) => {
      await database
        .delete(schema.userDiscountCards)
        .where(
          and(
            eq(schema.userDiscountCards.tenantId, tenant.id),
            eq(schema.userDiscountCards.userId, primaryUser.id),
          ),
        );
      await use();
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

test.use({ seedDiscounts: false, storageState: userStateFile });

type Database = NeonDatabase<Record<string, never>, typeof relations>;

async function updateProvider(options: {
  database: Database;
  enabled: boolean;
  showCta?: boolean;
  tenantId: string;
}) {
  const { database, enabled, showCta = true, tenantId } = options;
  const currentTenant = await database.query.tenants.findFirst({
    where: { id: tenantId },
  });
  const currentProviders = (currentTenant?.discountProviders ?? {}) as Record<
    string,
    { config?: { ctaEnabled?: boolean; ctaLink?: string }; enabled?: boolean }
  >;
  const nextProviders = {
    ...currentProviders,
    esnCard: {
      enabled,
      config: enabled
        ? {
            ctaEnabled: showCta,
            ctaLink: showCta ? 'https://example.com/esncard' : undefined,
          }
        : {
            ctaEnabled: false,
            ctaLink: undefined,
          },
    },
  };
  await database
    .update(schema.tenants)
    .set({ discountProviders: nextProviders as typeof currentProviders })
    .where(eq(schema.tenants.id, tenantId));
}

test.describe('Contract: discounts.cards CRUD (getMyCards, upsertMyCard, deleteMyCard)', () => {
  test.beforeEach(async ({ database, tenant }) => {
    await updateProvider({
      database,
      enabled: true,
      tenantId: tenant.id,
    });
  });

  test('shows CTA when enabled and no card is on file', async ({ page }) => {
    await page.goto('/profile/discount-cards', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('link', { name: CTA_LINK_TEXT })).toBeVisible();
  });

  test('rejects invalid ESNcard numbers', async ({ page }) => {
    test.skip(true, 'ESNcard validation requires reliable upstream test numbers.');
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
    test.skip(true, 'ESNcard validation requires reliable upstream test numbers.');
    const duplicateId = `ESN-DUP-${Date.now()}`;

    await seedSecondaryCard(duplicateId);

    await page.goto('/profile/discount-cards', {
      waitUntil: 'domcontentloaded',
    });
    await page.getByTestId('esn-card-input').fill(duplicateId);
    await page.getByTestId('add-esn-card-button').click();
    await expect(page.locator(SNACKBAR)).toContainText('Card is already in use by another user');
  });

  test('blocks card creation when provider is disabled', async ({ database, page, tenant }) => {
    test.skip(true, 'ESNcard validation requires reliable upstream test numbers.');
    await updateProvider({
      database,
      enabled: false,
      tenantId: tenant.id,
    });

    await page.goto('/profile/discount-cards', {
      waitUntil: 'domcontentloaded',
    });
    await page.getByTestId('esn-card-input').fill(`ESN-DIS-${Date.now()}`);
    await page.getByTestId('add-esn-card-button').click();
    await expect(page.locator(SNACKBAR)).toContainText('Provider not enabled for this tenant');

    await updateProvider({
      database,
      enabled: true,
      tenantId: tenant.id,
    });
  });

  test('allows adding and deleting a verified card', async ({ page }) => {
    test.skip(true, 'ESNcard validation requires reliable upstream test numbers.');
    const identifier = `ESN-SUCCESS-${Date.now()}`;

    await page.goto('/profile/discount-cards', {
      waitUntil: 'domcontentloaded',
    });
    await page.getByTestId('esn-card-input').fill(identifier);
    await page.getByTestId('add-esn-card-button').click();
    await expect(page.locator(SNACKBAR)).toContainText('Card added successfully');
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });

    const cardSection = page.getByText(`Card: ${identifier}`).locator('..').locator('..');
    await expect(cardSection).toContainText(identifier);
    await expect(cardSection).toContainText('Verified');

    page.once('dialog', (dialog) => dialog.accept());
    await cardSection.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator(SNACKBAR)).toContainText('Card deleted successfully');
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });
    await expect(page.getByText(`Card: ${identifier}`)).toHaveCount(0);
  });
});
