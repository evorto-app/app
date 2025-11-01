import * as schema from '@db/schema';
import { and, eq } from 'drizzle-orm';

import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../../helpers/user-data';
import { expect, test } from '../../../fixtures/parallel-test';
import { takeScreenshot } from '../../../reporters/documentation-reporter';

const SNACKBAR = 'mat-snack-bar-container';
const CTA_SECTION = '[data-testid="esn-cta-section"]';
const CARD_IDENTIFIER_CELL = '[data-testid="refresh-esn-card"]';

test.describe('Documentation: Discount provider journey — admin setup', () => {
  test.use({ storageState: adminStateFile });

  test('Admin enables ESN discount provider', async ({ page }, testInfo) => {
    await page.goto('/admin/settings/discounts');

    testInfo.attach('markdown', {
      body: `
    The platform supports discount providers that can be enabled and configured in the admin settings. Currently supported providers are:
    - ESNcard: If enabled, users can enter their ESNcard number to prove their membership. Once the discount is active, secondary prices for cardholders can be entered.

    # Activate the ESN provider`,
    });

    await page.getByRole('switch', { name: 'Disabled' }).click();
    await page.getByRole('switch', { name: 'Show buy ESNcard link' }).click();

    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.locator(SNACKBAR)).toContainText(
      'Discount settings saved successfully',
    );
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });

    await takeScreenshot(
      testInfo,
      page.locator('app-discount-settings'),
      page,
      'Admin enables ESN provider',
    );

    await testInfo.attach('markdown', {
      body: `

      1. Visit **Admin → Settings → Discounts**.
      2. Toggle on the **ESN provider**. You can decide if there should be a link to to buy the ESNcard shown to users who don't have one.
      3. Save changes to make the CTA available for members.`,
    });
  });
});

test.describe('Documentation: Discount provider journey — user experience', () => {
  test.use({ seedDiscounts: false, storageState: userStateFile });

  test('User reviews ESN discount card states', async ({
    database,
    page,
    tenant,
  }, testInfo) => {
    const user = usersToAuthenticate.find(
      (candidate) => candidate.stateFile === userStateFile,
    );
    if (!user) {
      throw new Error('Documentation test requires seeded regular user');
    }

    await database
      .delete(schema.userDiscountCards)
      .where(
        and(
          eq(schema.userDiscountCards.tenantId, tenant.id),
          eq(schema.userDiscountCards.userId, user.id),
        ),
      );

    // Ensure ESNcard discount provider is enabled for this tenant (and CTA visible)
    const existing = await database
      .select({ discountProviders: schema.tenants.discountProviders })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenant.id));

    const currentProviders = (existing[0]?.discountProviders ?? {}) as any;
    const nextProviders = {
      ...currentProviders,
      esnCard: {
        ...currentProviders?.esnCard,
        config: {
          ...(currentProviders?.esnCard?.config as any),
          ctaEnabled: true,
          ctaLink: 'https://example.com/buy-esncard',
        },
        enabled: true,
      },
    } as const;

    await database
      .update(schema.tenants)
      .set({ discountProviders: nextProviders as any })
      .where(eq(schema.tenants.id, tenant.id));

    await page.goto('/profile', {
      waitUntil: 'domcontentloaded',
    });
    await expect(
      page.getByText('Get discounts on events with your ESNcard!'),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.getByText('Get discounts on events with your ESNcard!'),
      page,
      "Callout for users who don't have an ESNcard yet",
    );

    await discountSection.getByRole('link', { name: 'Manage Cards' }).click();
    await page.waitForURL('**/profile/discount-cards');
    await expect(page.locator(CTA_SECTION)).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator(CTA_SECTION),
      page,
      'Discount cards CTA and form',
    );

    const identifier = `ESN-DOC-${Date.now()}`;
    await database.insert(schema.userDiscountCards).values({
      identifier,
      lastCheckedAt: new Date(),
      status: 'verified',
      tenantId: tenant.id,
      type: 'esnCard',
      userId: user.id,
      validFrom: new Date(),
      validTo: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180),
    });

    await page.reload({ waitUntil: 'domcontentloaded' });

    const cardPanel = page
      .locator(CARD_IDENTIFIER_CELL)
      .first()
      .locator('..')
      .locator('..');
    await expect(cardPanel).toContainText(identifier);
    await expect(cardPanel).toContainText('Verified');
    await takeScreenshot(testInfo, cardPanel, page, 'Verified ESNcard on file');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('delete-esn-card').click();
    await expect(page.locator(SNACKBAR)).toContainText(
      'Card deleted successfully',
    );
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });
    await expect(page.locator(CARD_IDENTIFIER_CELL)).toHaveCount(0);
    await expect(page.locator(CTA_SECTION)).toBeVisible();

    await testInfo.attach('markdown', {
      body: `\n## Member manages ESNcards\n\n1. Navigate to **Profile → Discount cards** to access the CTA and form.\n2. Seed a verified ESNcard (documentation helper) and review the card details.\n3. Remove the card to confirm the CTA reappears for future entries.\n`,
    });
  });
});
