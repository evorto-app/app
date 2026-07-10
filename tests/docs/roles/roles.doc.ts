import { and, eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Manage tenant roles and review users @admin', async ({
  database,
  page,
  seedDate,
  tenant,
}, testInfo) => {
  const roleName = `Role docs ${seedDate.getTime()}`;
  const roleDescription = 'Role created by the generated roles guide';

  try {
    await page.goto('.');
    const connectionError = page.getByText(
      'Connection terminated unexpectedly',
    );
    if (await connectionError.isVisible()) {
      await page.reload();
    }
    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have an admin account with all required permissions. These are:
- **admin:manageRoles**: This permission is required to create and manage roles.
- **users:viewAll**: This permission is required to review the tenant user list.
- **users:assignRoles**: This full tenant-administrator permission can assign any existing tenant role to any tenant user, including yourself.
{% /callout %}
Roles are the way to manage permissions in the app.
You can create roles with different permissions.
A user will have any permission that is assigned to at least one of their roles.
You can also use roles to group users, for example to make some events only available to specific users.

Start by navigating to **Admin tools**. The current relaunch admin surface separates existing-user role assignment from role creation and editing.
`,
    });
    await page.getByRole('link', { name: 'Admin Tools' }).click();
    await page.getByRole('link', { name: 'Users' }).click();
    await expect(
      page.getByRole('heading', { name: 'All users' }),
    ).toBeVisible();
    await expect(
      page.getByText('Manage tenant role assignments for existing users.'),
    ).toBeVisible();
    await expect(page.getByPlaceholder('Name or email')).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Name' }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Email' }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Roles' }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { exact: true, name: 'admin@evorto.app' }),
    ).toBeVisible();
    await expect(page.getByText('Admin').first()).toBeVisible();
    await expect(page.getByText('Edit template')).toHaveCount(0);
    await takeScreenshot(
      testInfo,
      page.locator('app-user-list'),
      page,
      'Tenant user role assignment list',
    );
    await testInfo.attach('markdown', {
      body: `
## User review

The **All users** page supports searching tenant users by name or email and, for administrators with **users:assignRoles**, exposes tenant-scoped role assignment controls for existing users. Users without that permission still see read-only role chips. Because the capability allows assigning any existing tenant role, including to yourself, it is full tenant-administrator authority rather than limited delegation.

Navigate to the **User roles** page to create or edit tenant roles.
`,
    });
    await page.goto('/admin/roles');
    await expect(
      page.getByRole('heading', { name: 'User roles' }).first(),
    ).toBeVisible();
    const createRoleAction = page
      .locator('app-role-list a')
      .filter({ hasText: 'Create role' })
      .first();
    await expect(createRoleAction).toBeVisible();
    await takeScreenshot(testInfo, createRoleAction, page);
    await createRoleAction.click();
    await expect(
      page.getByRole('heading', { name: 'Create Role' }),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    await testInfo.attach('markdown', {
      body: `
## Role definition
You can now define the role. You have to add a name for the role as well as a short description.
There are some flags you can set:
- **Default user role**: This role will be assigned to all new users.
- **Default organizer role**: This role will be automatically included in the allowed roles of an organizer registration.
- **Show in hub**: This role will be shown in the members hub, so users can see who has this role. When enabled, the form also lets you choose whether members are collapsed by default.

You can also add permissions to the role. The permissions are grouped by category. Learn more at [about permissions](/docs/about-permissions).

Permissions that are required by another permission are automatically included and shown as non-editable dependent permissions with the same admin-facing labels used in the permission reference.

Selecting **Assign all user roles (tenant admin)** displays an explicit warning: this capability can assign any existing tenant role to any tenant user, including the current administrator, and can therefore acquire every tenant capability present in those roles.
`,
    });
    const roleForm = page.locator('app-role-form');
    const roleFormCheckbox = (name: string | RegExp) =>
      roleForm.getByRole('checkbox', { name });
    const saveRoleButton = roleForm.locator('button[type="submit"]');
    await roleForm.getByRole('textbox', { name: 'Name' }).fill(roleName);
    await roleForm
      .getByRole('textbox', { name: 'Description' })
      .fill(roleDescription);
    await roleFormCheckbox(/^Events$/).setChecked(true);
    await expect(roleForm.getByRole('textbox', { name: 'Name' })).toHaveValue(
      roleName,
    );
    await expect(roleFormCheckbox(/^Create events$/)).toBeChecked();
    await expect(roleForm.getByText('Includes: View templates')).toBeVisible();
    await expect(roleFormCheckbox(/^View templates$/)).toBeChecked();
    const fullTenantAdminPermission = roleFormCheckbox(
      /^Assign all user roles \(tenant admin\)$/,
    );
    await fullTenantAdminPermission.setChecked(true);
    await expect(
      roleForm.getByText('Full tenant-administrator authority.'),
    ).toBeVisible();
    await expect(roleForm.getByText(/including to themselves/)).toBeVisible();
    await fullTenantAdminPermission.setChecked(false);
    await takeScreenshot(
      testInfo,
      roleForm,
      page,
      'Role form with permission groups',
    );
    await expect(saveRoleButton).toBeEnabled();
    await saveRoleButton.click();
    await expect(page.getByRole('heading', { name: roleName })).toBeVisible();
    await expect(page.getByText(roleDescription)).toBeVisible();
    await expect(page.getByText('Create events')).toBeVisible();
    await expect(page.getByText('View templates')).toBeVisible();

    const createdRole = await database.query.roles.findFirst({
      where: { name: roleName, tenantId: tenant.id },
    });
    if (!createdRole) {
      throw new Error('Expected generated roles doc to persist the role');
    }
    expect(createdRole.description).toBe(roleDescription);
    expect(createdRole.permissions).toContain('events:create');
    expect(createdRole.permissions).toContain('templates:view');

    await testInfo.attach('markdown', {
      body: `
After you have saved your newly configured role, you will be redirected to the role details page.
The role can now be used by flows that reference tenant roles, such as event and template eligibility.
Assigning roles to existing users happens from the **All users** page and is guarded by **users:assignRoles**. This capability is full tenant-administrator authority: it may assign any existing tenant role, including to the current user. Role changes apply only inside the current tenant.
`,
    });
  } finally {
    await database
      .delete(schema.roles)
      .where(
        and(
          eq(schema.roles.tenantId, tenant.id),
          eq(schema.roles.name, roleName),
        ),
      );
  }
});
