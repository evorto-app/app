import { and, eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { userStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/permissions-test';

test.use({ storageState: userStateFile });

test('adds internal:viewInternalPages to Regular user opens Members Hub', async ({
  database,
  page,
  permissionOverride,
  tenant,
}) => {
  const roleId = getId();
  const userId = getId();
  const userTenantId = getId();

  await database.insert(schema.users).values({
    auth0Id: `test|${userId}`,
    communicationEmail: `hub-${userId}@evorto.test`,
    email: `hub-${userId}@evorto.test`,
    firstName: 'Hub',
    id: userId,
    lastName: 'Reviewer',
  });
  await database.insert(schema.usersToTenants).values({
    id: userTenantId,
    tenantId: tenant.id,
    userId,
  });
  await database.insert(schema.roles).values({
    description: 'Visible in the internal hub',
    displayInHub: true,
    id: roleId,
    name: 'Members Hub Test Team',
    permissions: [],
    tenantId: tenant.id,
  });
  await database.insert(schema.rolesToTenantUsers).values({
    roleId,
    userTenantId,
  });

  try {
    await permissionOverride({
      roleName: 'Regular user',
      add: ['internal:viewInternalPages'],
    });

    await page.goto('.');
    const internalLink = page.getByRole('link', { name: 'Internal' });
    await expect(internalLink).toBeVisible();

    await internalLink.click();
    await expect(page).toHaveURL(/\/internal\/members-hub$/);
    await expect(
      page.getByRole('heading', { name: 'Members Hub' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: "Who's who" }),
    ).toBeVisible();
    await expect(page.getByText('Members Hub Test Team')).toBeVisible();
    await expect(page.getByText('Visible in the internal hub')).toBeVisible();
    await expect(page.getByText('Hub Reviewer')).toBeVisible();
  } finally {
    await database
      .delete(schema.rolesToTenantUsers)
      .where(
        and(
          eq(schema.rolesToTenantUsers.roleId, roleId),
          eq(schema.rolesToTenantUsers.userTenantId, userTenantId),
        ),
      );
    await database.delete(schema.roles).where(eq(schema.roles.id, roleId));
    await database
      .delete(schema.usersToTenants)
      .where(eq(schema.usersToTenants.id, userTenantId));
    await database.delete(schema.users).where(eq(schema.users.id, userId));
  }
});
