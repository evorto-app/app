import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: userStateFile });

test('profile warns when browsing outside the user home tenant', async ({
  database,
  page,
  seedDate,
}) => {
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular profile user fixture');
  }

  const originalUser = await database.query.users.findFirst({
    where: { id: regularUser.id },
  });
  if (!originalUser) {
    throw new Error('Expected regular profile user to exist');
  }

  const alternateTenantId = getId();

  try {
    await database.insert(schema.tenants).values({
      domain: `profile-home-${seedDate.getTime()}`,
      id: alternateTenantId,
      name: 'Profile Home Tenant',
    });
    await database
      .update(schema.users)
      .set({ homeTenantId: alternateTenantId })
      .where(eq(schema.users.id, regularUser.id));

    await page.goto('/profile');

    await expect(
      page
        .getByRole('status')
        .getByText('You are browsing a tenant that is not your home tenant.'),
    ).toBeVisible();
  } finally {
    await database
      .update(schema.users)
      .set({ homeTenantId: originalUser.homeTenantId })
      .where(eq(schema.users.id, regularUser.id));
    await database
      .delete(schema.tenants)
      .where(eq(schema.tenants.id, alternateTenantId));
  }
});
