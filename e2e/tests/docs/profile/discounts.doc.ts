import * as schema from '@db/schema';
import { and, eq } from 'drizzle-orm';

import { userStateFile, usersToAuthenticate } from '../../../../helpers/user-data';
import { expect, test } from '../../../fixtures/parallel-test';
import { takeScreenshot } from '../../../reporters/documentation-reporter';

test.use({ storageState: userStateFile });

const docUser = usersToAuthenticate.find((candidate) => candidate.stateFile === userStateFile);
if (!docUser) {
  throw new Error('Documentation test requires seeded regular user');
}

test('Manage ESNcard discount @finance', async ({ database, page, tenant }, testInfo) => {
  await database
    .delete(schema.userDiscountCards)
    .where(
      and(
        eq(schema.userDiscountCards.tenantId, tenant.id),
        eq(schema.userDiscountCards.userId, docUser.id),
      ),
    );

  await database
    .insert(schema.userDiscountCards)
    .values({
      identifier: `EXPIRED-${tenant.id.slice(0, 6)}`,
      lastCheckedAt: new Date(),
      status: 'verified',
      tenantId: tenant.id,
      type: 'esnCard',
      userId: docUser.id,
      validFrom: new Date('2023-01-01'),
      validTo: new Date(Date.now() - 1000 * 60 * 60 * 24),
    })
    .execute();

  await database
    .update(schema.tenants)
    .set({
      discountProviders: {
        esnCard: {
          config: {
            ctaEnabled: true,
            ctaLink: 'https://example.com/buy-esncard',
          },
          enabled: true,
        },
      },
    })
    .where(eq(schema.tenants.id, tenant.id));

  await page.goto('./profile');
  await testInfo.attach('markdown', {
    body: `
# ESNcard Discount

Add your ESNcard to receive discounted prices on eligible events. Your card is validated against esncard.org and discounts apply only while the card is valid.
`,
  });

  await expect(page.getByRole('heading', { name: 'Discount Cards' })).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { name: 'Discount Cards' }),
    page,
    'Discount cards section',
  );

  await testInfo.attach('markdown', {
    body: `
If you already added your ESNcard, you will see its status and validity here. You can refresh its status or remove it. Use the form to add or update your ESNcard number.
`,
  });

  await page.getByRole('link', { name: 'Manage Cards' }).click();
  await page.waitForURL('**/profile/discount-cards');
  await expect(page.getByText('Need a valid ESNcard?')).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.getByText('Need a valid ESNcard?'),
    page,
    'CTA shown when no valid ESNcard is on file',
  );
});
