import { and, eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { gaStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: gaStateFile });

for (const member of [true, false]) {
  test(`global administrator manages tenant with ${member ? 'a role granting no permissions' : 'no membership'} @permissions @globalAdmin`, async ({
    database,
    page: platformPage,
    registerDatabaseCleanup,
    tenant,
  }) => {
    const administrator = usersToAuthenticate.find(
      (user) => user.platformAdministrator,
    );
    if (!administrator)
      throw new Error('Expected a platform administrator fixture');
    const membership = await database.query.usersToTenants.findFirst({
      where: { tenantId: tenant.id, userId: administrator.id },
    });
    if (!membership)
      throw new Error('Expected an initial owned tenant membership');
    const originalAssignments = await database
      .select()
      .from(schema.rolesToTenantUsers)
      .where(eq(schema.rolesToTenantUsers.userTenantId, membership.id));
    const lowPrivilegeRoleId = getId();
    const createdRoleName = `Platform-managed ${getId()}`;
    let removedMembership = false;
    registerDatabaseCleanup(async (cleanupDatabase) => {
      await cleanupDatabase
        .delete(schema.rolesToTenantUsers)
        .where(eq(schema.rolesToTenantUsers.userTenantId, membership.id));
      await cleanupDatabase
        .delete(schema.roles)
        .where(
          and(
            eq(schema.roles.tenantId, tenant.id),
            eq(schema.roles.id, lowPrivilegeRoleId),
          ),
        );
      if (removedMembership)
        await cleanupDatabase.insert(schema.usersToTenants).values(membership);
      if (originalAssignments.length)
        await cleanupDatabase
          .insert(schema.rolesToTenantUsers)
          .values(originalAssignments);
      await cleanupDatabase
        .delete(schema.roles)
        .where(
          and(
            eq(schema.roles.tenantId, tenant.id),
            eq(schema.roles.name, createdRoleName),
          ),
        );
    });
    await database
      .delete(schema.rolesToTenantUsers)
      .where(eq(schema.rolesToTenantUsers.userTenantId, membership.id));
    if (member) {
      await database.insert(schema.roles).values({
        id: lowPrivilegeRoleId,
        tenantId: tenant.id,
        name: 'No capabilities',
        description: 'No tenant permission grants',
        permissions: [],
      });
      await database.insert(schema.rolesToTenantUsers).values({
        roleId: lowPrivilegeRoleId,
        tenantId: tenant.id,
        userTenantId: membership.id,
      });
    } else {
      await database
        .delete(schema.usersToTenants)
        .where(eq(schema.usersToTenants.id, membership.id));
      removedMembership = true;
    }

    await platformPage.goto(`/global-admin/tenants/${tenant.id}`);
    const opened = platformPage.waitForEvent('popup');
    await platformPage
      .getByRole('link', { name: 'Open organization', exact: true })
      .click();
    const page = await opened;
    await page.goto('/admin/roles');
    await expect(
      page.getByRole('heading', { name: 'Member roles', level: 1 }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Admin Tools', exact: true }),
    ).toBeVisible();
    const createRole = page.getByRole('link', {
      name: 'Create role',
      exact: true,
    });
    await expect(createRole).not.toHaveAttribute('jsaction', /click/);
    await createRole.click();
    const form = page.locator('app-role-form');
    await form.locator('input').first().fill(createdRoleName);
    await form
      .locator('textarea')
      .first()
      .fill('Created through ordinary tenant administration');
    const submit = form.locator('button[type="submit"]');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(
      page.getByRole('heading', { name: createdRoleName, exact: true }),
    ).toBeVisible();
    const role = await database.query.roles.findFirst({
      where: { name: createdRoleName },
    });
    expect(role?.tenantId).toBe(tenant.id);
    const currentMembership = await database.query.usersToTenants.findFirst({
      where: { tenantId: tenant.id, userId: administrator.id },
    });
    if (member) expect(currentMembership?.id).toBe(membership.id);
    else expect(currentMembership).toBeUndefined();
  });
}
