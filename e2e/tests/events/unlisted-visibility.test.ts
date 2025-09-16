import { expect } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { adminStateFile, userStateFile } from '../../../helpers/user-data';
import { test } from '../../fixtures/base-test';
import * as schema from '../../../src/db/schema';

async function getUnlistedEvent(database: Parameters<typeof test.extend>[0]['database']) {
  const tenants = await database
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.domain, 'localhost'))
    .limit(1);
  const tenant = tenants[0];
  if (!tenant) return null;
  const events = await database
    .select({ id: schema.eventInstances.id, title: schema.eventInstances.title })
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.unlisted, true))
    .limit(1);
  return events[0] ?? null;
}

test.describe('Unlisted events visibility', () => {
  test.use({ storageState: userStateFile });

  test('regular user does not see unlisted in list', async ({ page, database }) => {
    const unlisted = await getUnlistedEvent(database);
    if (!unlisted) test.skip(true, 'No unlisted event seeded');
    await page.goto('/events');
    // Should not appear in listing for regular user
    await expect(page.getByRole('link', { name: unlisted.title })).toHaveCount(0);
    // No unlisted badges for regular users
    await expect(page.getByText('unlisted')).toHaveCount(0);
  });

  test('regular user can open unlisted via direct link', async ({ page, database }) => {
    const unlisted = await getUnlistedEvent(database);
    if (!unlisted) test.skip(true, 'No unlisted event seeded');
    await page.goto(`/events/${unlisted.id}`);
    // Title should be visible on event details page
    await expect(page.getByRole('heading', { name: unlisted.title })).toBeVisible();
  });
});

test.describe('Admin can see unlisted', () => {
  test.use({ storageState: adminStateFile });

  test('admin sees unlisted in list with indicator', async ({ page, database }) => {
    const unlisted = await getUnlistedEvent(database);
    if (!unlisted) test.skip(true, 'No unlisted event seeded');
    await page.goto('/events');
    await expect(page.getByRole('link', { name: unlisted.title })).toBeVisible();
    // The card contains an "unlisted" indicator element
    await expect(page.getByText('unlisted')).toBeVisible();
  });
});

