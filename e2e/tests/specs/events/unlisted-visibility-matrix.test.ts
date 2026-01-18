import { expect } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { adminStateFile, userStateFile } from '../../../../helpers/user-data';
import { test as base } from '../../../fixtures/base-test';
import * as schema from '../../../../src/db/schema';

const test = base.extend<{
  unlistedEvent: { id: string; title: string } | null;
}>({
  unlistedEvent: async ({ database }, use) => {
    const events = await database
      .select({ id: schema.eventInstances.id, title: schema.eventInstances.title })
      .from(schema.eventInstances)
      .where(eq(schema.eventInstances.unlisted, true))
      .limit(1);
    await use(events[0] ?? null);
  },
});

test.describe('Unlisted events visibility', () => {
  test.use({ storageState: userStateFile });

  test('regular user does not see unlisted in list', async ({ page, unlistedEvent }) => {
    if (!unlistedEvent) {
      test.skip(true, 'No unlisted event seeded');
      return;
    }
    await page.goto('/events');
    // Should not appear in listing for regular user
    await expect(page.getByRole('link', { name: unlistedEvent.title })).toHaveCount(0);
    // No unlisted badges for regular users
    await expect(page.getByText('unlisted')).toHaveCount(0);
  });

  test('regular user can open unlisted via direct link', async ({ page, unlistedEvent }) => {
    if (!unlistedEvent) {
      test.skip(true, 'No unlisted event seeded');
      return;
    }
    await page.goto(`/events/${unlistedEvent.id}`);
    // Title should be visible on event details page
    await expect(page.getByRole('heading', { name: unlistedEvent.title })).toBeVisible();
  });
});

test.describe('Admin can see unlisted', () => {
  test.use({ storageState: adminStateFile });

  test('admin sees unlisted in list with indicator', async ({ page, unlistedEvent }) => {
    if (!unlistedEvent) {
      test.skip(true, 'No unlisted event seeded');
      return;
    }
    await page.goto('/events');
    await expect(page.getByRole('link', { name: unlistedEvent.title })).toBeVisible();
    // The card contains an "unlisted" indicator element
    await expect(page.getByText('unlisted')).toBeVisible();
  });
});
