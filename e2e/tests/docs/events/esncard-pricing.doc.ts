import { DateTime } from 'luxon';

import { adminStateFile } from '../../../../helpers/user-data';
import { expect, test } from '../../../fixtures/parallel-test';
import { takeScreenshot } from '../../../reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('ESNcard pricing in event editor', async ({ events, page }, testInfo) => {
  const paidEvent = events.find((event) => {
    return (
      event.status === 'APPROVED' &&
      event.unlisted === false &&
      event.registrationOptions.some((option) => {
        return (
          DateTime.fromJSDate(option.openRegistrationTime).diffNow().milliseconds < 0 &&
          option.isPaid &&
          option.title === 'Participant registration' &&
          DateTime.fromJSDate(option.closeRegistrationTime).diffNow().milliseconds > 0 &&
          (option.discounts?.length ?? 0) > 0
        );
      })
    );
  });

  if (!paidEvent) {
    throw new Error('No paid event found for ESNcard pricing');
  }

  await page.goto(`/events/${paidEvent.id}/edit`);
  await testInfo.attach('markdown', {
    body: `
# ESNcard Pricing (Event Editor)

When the ESNcard provider is enabled for the tenant, event editors can configure discounted prices for eligible registration options. Discounts are defined per registration option and stored alongside the base price.
`,
  });

  const discountSection = page.locator('mat-card').filter({ hasText: 'Discount Pricing' });
  await expect(discountSection).toBeVisible();
  await takeScreenshot(testInfo, discountSection, page, 'ESNcard discount pricing in editor');
});
