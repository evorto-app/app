import { and, eq } from 'drizzle-orm';

import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import {
  seedMembersHubTenantScopeDecoy,
  seedUserRoleAssignmentScenario,
} from '../../support/utils/user-role-assignment-scenario';

test.use({ storageState: adminStateFile });

test('Manage organization roles, existing-user assignments, and Members Hub @admin @permissions', async ({
  browser,
  database,
  page,
  seedDate,
  tenant,
  tenantDomain,
  testClock,
}, testInfo) => {
  const roleName = `Role docs ${seedDate.getTime()}`;
  const roleDescription = 'Role created by the generated roles guide';
  const updatedRoleDescription =
    'Role edited and verified by the generated roles guide';
  const regularUser = usersToAuthenticate.find(
    (candidate) => candidate.roles === 'user',
  );
  if (!regularUser) {
    throw new Error('Expected a regular authenticated user for Members Hub');
  }
  const [regularMembership] = await database
    .select({ id: schema.usersToTenants.id })
    .from(schema.usersToTenants)
    .where(
      and(
        eq(schema.usersToTenants.tenantId, tenant.id),
        eq(schema.usersToTenants.userId, regularUser.id),
      ),
    )
    .limit(1);
  const regularUserRecord = await database.query.users.findFirst({
    columns: { firstName: true, lastName: true },
    where: { id: regularUser.id },
  });
  if (!regularMembership || !regularUserRecord) {
    throw new Error(
      'Expected the regular authenticated user to belong to the documentation tenant',
    );
  }
  const regularMemberDisplayName = `${regularUserRecord.firstName} ${regularUserRecord.lastName}`;
  const assignmentScenario = await seedUserRoleAssignmentScenario({
    database,
    roleName: 'Event assistant',
    tenant,
    userEmail: 'casey.role-docs@evorto.test',
  });
  const tenantScopeDecoy = await seedMembersHubTenantScopeDecoy({
    database,
    roleName,
  });

  const findAssignmentTarget = async (email: string) => {
    await expect(page.locator('[ngh]')).toHaveCount(0, { timeout: 20_000 });
    const userList = page.locator('app-user-list');
    await expect(userList.getByRole('table')).toBeVisible({
      timeout: 15_000,
    });
    const userSearchInput = userList.getByPlaceholder('Name or email');
    await userSearchInput.fill(email);
    const userRow = userList.getByRole('row').filter({
      has: page.getByText(email, { exact: true }),
    });
    await expect(userRow).toBeVisible({ timeout: 15_000 });
    return {
      roleSelect: userRow.getByRole('combobox', { name: 'Assigned roles' }),
      userRow,
    };
  };

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
You need an administrator account with:
- **Manage roles** access to create and manage roles.
- **View all users** access to review the organization member list.
- **Assign all user roles** access to assign any existing organization role to any member, including yourself. This is full organization-administrator authority.
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
      page.getByText(
        'Manage role assignments for existing members. Role changes apply only to this organization.',
      ),
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

The **All users** page supports searching organization members by name or email. Administrators with **Assign all user roles** access can change roles for existing members; users without that access see read-only role chips. Because this permission allows assigning any existing organization role, including to yourself, it is full organization-administrator authority rather than limited delegation.

## Assign a role to an existing user

Use the search field to find the person by name or email. Open **Assigned roles** in that person's row and select one or more roles. The selection is saved immediately, so there is no separate Save button. Assigning a role changes only this organization membership; it does not edit the role itself or affect the person's memberships in other organizations.
`,
    });

    let { roleSelect, userRow } = await findAssignmentTarget(
      assignmentScenario.user.email,
    );
    await expect(roleSelect).toBeEnabled();
    await roleSelect.press('Enter');
    let assignmentOption = page.getByRole('option', {
      exact: true,
      name: assignmentScenario.role.name,
    });
    await expect(assignmentOption).toHaveAttribute('aria-selected', 'false');
    await assignmentOption.click();
    await page.keyboard.press('Escape');
    await expect(page.getByText('User roles updated')).toBeVisible();
    await expect
      .poll(assignmentScenario.readAssignedRoleIds)
      .toEqual([assignmentScenario.role.id]);

    await page.reload();
    ({ roleSelect, userRow } = await findAssignmentTarget(
      assignmentScenario.user.email,
    ));
    await expect(roleSelect).toContainText(assignmentScenario.role.name);
    await takeScreenshot(
      testInfo,
      userRow,
      page,
      'Existing user with assigned tenant role',
    );
    await roleSelect.press('Enter');
    assignmentOption = page.getByRole('option', {
      exact: true,
      name: assignmentScenario.role.name,
    });
    await expect(assignmentOption).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');

    await testInfo.attach('markdown', {
      body: `
Reloading the page and seeing the selected role again confirms that the assignment was saved.

## Remove a role from an existing user

Open **Assigned roles** again and deselect the role. Removal is also saved immediately. A user keeps the combined permissions from any roles that remain assigned. Administrators cannot remove every role from their own account, which prevents accidentally locking themselves out.
`,
    });

    await roleSelect.press('Enter');
    assignmentOption = page.getByRole('option', {
      exact: true,
      name: assignmentScenario.role.name,
    });
    await expect(assignmentOption).toHaveAttribute('aria-selected', 'true');
    await assignmentOption.click();
    await page.keyboard.press('Escape');
    await expect.poll(assignmentScenario.readAssignedRoleIds).toEqual([]);

    await page.reload();
    ({ roleSelect, userRow } = await findAssignmentTarget(
      assignmentScenario.user.email,
    ));
    await expect(roleSelect).not.toContainText(assignmentScenario.role.name);
    await roleSelect.press('Enter');
    await expect(
      page.getByRole('option', {
        exact: true,
        name: assignmentScenario.role.name,
      }),
    ).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Escape');
    await takeScreenshot(
      testInfo,
      userRow,
      page,
      'Existing user after tenant role removal',
    );

    await testInfo.attach('markdown', {
      body: `
After removal, the person's row no longer lists the role. Users with **View all users** access but without **Assign all user roles** access see role chips instead of this editable selector.

Navigate to the **User roles** page to create or edit organization roles.
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
- **Show in hub**: This role and its assigned members will be listed in the current organization's Members Hub.

You can also add permissions to the role. The permissions are grouped by category. Learn more at [about permissions](/docs/about-permissions).

Permissions that are required by another permission are automatically included and shown as non-editable dependent permissions with the same admin-facing labels used in the permission reference.

Selecting **Assign all user roles** displays an explicit warning: this permission can assign any existing organization role to any member, including the current administrator, and can therefore acquire every permission present in those roles.
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
    const fullOrganizationAdminPermission = roleFormCheckbox(
      /^Assign all user roles \(organization admin\)$/,
    );
    await fullOrganizationAdminPermission.setChecked(true);
    await expect(
      roleForm.getByText('Full organization-administrator authority.'),
    ).toBeVisible();
    await expect(roleForm.getByText(/including to themselves/)).toBeVisible();
    await fullOrganizationAdminPermission.setChecked(false);
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
The role can now be used for organization features such as event and template eligibility.

## Edit a role and show it in Members Hub

On the role details page, select the pencil action to edit the role. This example changes the description, turns on **Show this role in the hub**, and grants **View Members Hub** from the **Members Hub** permission group. This permission makes the **Members Hub** navigation available to assigned members; the hub flag determines whether this role and its members appear there.
`,
    });

    const roleDetails = page.locator('app-role-details');
    const editRoleAction = roleDetails.locator(
      `a[href="/admin/roles/${createdRole.id}/edit"]`,
    );
    await expect(editRoleAction).toBeVisible();
    await takeScreenshot(
      testInfo,
      roleDetails,
      page,
      'Created role details with edit action',
    );
    await editRoleAction.click();
    await expect(
      page.getByRole('heading', { exact: true, name: 'Edit Role' }),
    ).toBeVisible();

    const editRoleForm = page.locator('app-role-form');
    const editRoleFormCheckbox = (name: string | RegExp) =>
      editRoleForm.getByRole('checkbox', { name });
    await expect(
      editRoleForm.getByRole('textbox', { name: 'Name' }),
    ).toHaveValue(roleName);
    await expect(
      editRoleForm.getByRole('textbox', { name: 'Description' }),
    ).toHaveValue(roleDescription);
    await editRoleForm
      .getByRole('textbox', { name: 'Description' })
      .fill(updatedRoleDescription);
    await editRoleFormCheckbox(/^Show this role in the hub$/).setChecked(true);
    await editRoleFormCheckbox(/^Members Hub$/).setChecked(true);
    await expect(editRoleFormCheckbox(/^View Members Hub$/)).toBeChecked();
    await takeScreenshot(
      testInfo,
      editRoleForm,
      page,
      'Role edit with Members Hub visibility and access',
    );
    await editRoleForm.locator('button[type="submit"]').click();
    await expect(page.getByRole('heading', { name: roleName })).toBeVisible();
    await expect(page.getByText(updatedRoleDescription)).toBeVisible();
    await expect(page.getByText('View Members Hub')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: roleName })).toBeVisible();
    await expect(page.getByText(updatedRoleDescription)).toBeVisible();
    await expect(page.getByText('View Members Hub')).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-role-details'),
      page,
      'Reloaded role details with persisted Members Hub settings',
    );

    const updatedRole = await database.query.roles.findFirst({
      where: { id: createdRole.id, tenantId: tenant.id },
    });
    expect(updatedRole).toMatchObject({
      description: updatedRoleDescription,
      displayInHub: true,
    });
    expect(updatedRole?.permissions).toContain('internal:viewInternalPages');

    await testInfo.attach('markdown', {
      body: `
Reloading the details page and seeing the updated description and **View Members Hub** confirms that the edit was saved.

## Give a member access

Return to **Admin tools** → **Users**, search for the member, and select the new role under **Assigned roles**. The assignment takes effect for this organization as soon as the success message appears. Continue as that member to verify the access granted by the role.
`,
    });

    await page.goto('/admin/users');
    const regularAssignmentTarget = await findAssignmentTarget(
      regularUser.email,
    );
    await regularAssignmentTarget.roleSelect.press('Enter');
    const regularAssignmentOption = page.getByRole('option', {
      exact: true,
      name: roleName,
    });
    await expect(regularAssignmentOption).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await regularAssignmentOption.click();
    await page.keyboard.press('Escape');
    await expect(page.getByText('User roles updated')).toBeVisible();
    await expect
      .poll(async () => {
        const assignments = await database
          .select({ roleId: schema.rolesToTenantUsers.roleId })
          .from(schema.rolesToTenantUsers)
          .where(
            eq(schema.rolesToTenantUsers.userTenantId, regularMembership.id),
          );
        return assignments.map((assignment) => assignment.roleId);
      })
      .toContain(createdRole.id);

    await page.reload();
    const reloadedRegularAssignmentTarget = await findAssignmentTarget(
      regularUser.email,
    );
    await expect(reloadedRegularAssignmentTarget.roleSelect).toContainText(
      roleName,
    );
    await takeScreenshot(
      testInfo,
      reloadedRegularAssignmentTarget.userRow,
      page,
      'Regular member with persisted Members Hub role',
    );

    const memberSession = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: userStateFile,
      tenantDomain,
      testClock,
    });
    try {
      await memberSession.page.goto('.');
      const membersHubLink = memberSession.page.getByRole('link', {
        exact: true,
        name: 'Members Hub',
      });
      await expect(membersHubLink).toBeVisible();
      await membersHubLink.click();
      await expect(memberSession.page).toHaveURL(/\/internal\/members-hub$/u);
      await expect(
        memberSession.page.getByRole('heading', { name: 'Members Hub' }),
      ).toBeVisible();
      await expect(
        memberSession.page.getByRole('heading', { name: "Who's who" }),
      ).toBeVisible();
      await expect(
        memberSession.page.getByText(roleName, { exact: true }),
      ).toBeVisible();
      await expect(
        memberSession.page.getByText(updatedRoleDescription, { exact: true }),
      ).toBeVisible();
      await expect(
        memberSession.page.getByText(regularMemberDisplayName, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        memberSession.page.getByText(tenantScopeDecoy.memberDisplayName, {
          exact: true,
        }),
      ).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        memberSession.page.locator('app-members-hub'),
        memberSession.page,
        'Members Hub for an eligible organization member',
      );
    } finally {
      await memberSession.context.close();
    }

    await testInfo.attach('markdown', {
      body: `
## Open Members Hub

As the assigned member, select **Members Hub**. The page lists hub-visible roles, their descriptions, and the members assigned to each role in the current organization.

Roles and member lists stay within their organization. A same-named role in another organization does not combine or expose its members here. Members without **View Members Hub** do not receive the **Members Hub** navigation or page access.

**Assign all user roles** is full organization-administrator authority because it may assign any existing organization role, including to the current user. Role definitions, assignments, permissions, and Members Hub results stay inside the selected organization.
`,
    });
  } finally {
    try {
      await tenantScopeDecoy.cleanup();
    } finally {
      try {
        const generatedRoles = await database
          .select({ id: schema.roles.id })
          .from(schema.roles)
          .where(
            and(
              eq(schema.roles.tenantId, tenant.id),
              eq(schema.roles.name, roleName),
            ),
          );
        for (const generatedRole of generatedRoles) {
          await database
            .delete(schema.rolesToTenantUsers)
            .where(
              and(
                eq(schema.rolesToTenantUsers.roleId, generatedRole.id),
                eq(schema.rolesToTenantUsers.tenantId, tenant.id),
              ),
            );
        }
        await database
          .delete(schema.roles)
          .where(
            and(
              eq(schema.roles.tenantId, tenant.id),
              eq(schema.roles.name, roleName),
            ),
          );
      } finally {
        await assignmentScenario.cleanup();
      }
    }
  }
});
