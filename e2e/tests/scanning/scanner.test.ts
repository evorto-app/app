import { expect } from '@playwright/test';
import { and, eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import { test } from '../../fixtures/base-test';
import * as schema from '../../../src/db/schema';

test.use({ storageState: adminStateFile });

test('scan confirmed registration shows allow check-in', async ({ page, database }) => {
  const tenants = await database
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.domain, 'localhost'))
    .limit(1);
  const tenant = tenants[0];
  if (!tenant) test.skip(true, 'No tenant found');
  const regs = await database
    .select()
    .from(schema.eventRegistrations)
    .where(and(eq(schema.eventRegistrations.tenantId, tenant.id), eq(schema.eventRegistrations.status, 'CONFIRMED')))
    .limit(1);
  const reg = regs[0];
  if (!reg) test.skip(true, 'No confirmed registration available');
  await page.goto(`/scan/registration/${reg.id}`);
  await expect(page.getByRole('heading', { name: 'Registration scanned' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm Check In' })).toBeEnabled();
});
