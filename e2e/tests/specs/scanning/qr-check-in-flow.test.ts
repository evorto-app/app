import { expect } from '@playwright/test';
import { and, eq } from 'drizzle-orm';

import { adminStateFile } from '../../../../helpers/user-data';
import { test as base } from '../../../fixtures/base-test';
import * as schema from '../../../../src/db/schema';

const test = base.extend<{
  confirmedRegistrationId: string | null;
}>({
  confirmedRegistrationId: async ({ database }, use) => {
    const tenants = await database
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.domain, 'localhost'))
      .limit(1);
    const tenant = tenants[0];
    if (!tenant) {
      await use(null);
      return;
    }
    const regs = await database
      .select()
      .from(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.status, 'CONFIRMED'),
        ),
      )
      .limit(1);
    await use(regs[0]?.id ?? null);
  },
});

test.use({ storageState: adminStateFile });

test('allows check-in for confirmed registration scan', async ({
  confirmedRegistrationId,
  page,
}) => {
  if (!confirmedRegistrationId) {
    test.skip(true, 'No confirmed registration available');
    return;
  }
  await page.goto(`/scan/registration/${confirmedRegistrationId}`);
  await expect(page.getByRole('heading', { name: 'Registration scanned' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm Check In' })).toBeEnabled();
});
