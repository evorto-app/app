import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Create a role', async ({ page }, testInfo) => {
  await page.goto('.');
  const connectionError = page.getByText('Connection terminated unexpectedly');
  if (await connectionError.isVisible()) {
    await page.reload();
  }
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have an admin account with all required permissions. These are:
- **admin:manageRoles**: This permission is required to create and manage roles.
{% /callout %}
Roles are the way to manage permissions in the app.
You can create roles with different permissions and assign them to users.
A user will have any permission that is assigned to at least one of their roles.
You can also use roles to group users, for example to make some events only available to specific users.

Start by navigating to the **User roles** page under **Admin tools**. Here you can see an overview of the existing roles.
Click on _Create role_ to create a new role.`,
  });
  await page.getByRole('link', { name: 'Admin Tools' }).click();
  await page.getByRole('link', { name: 'User roles' }).click();
  await takeScreenshot(
    testInfo,
    page.getByRole('link', { name: 'Create role' }),
    page,
  );
  await page.getByRole('link', { name: 'Create role' }).click();
  await testInfo.attach('markdown', {
    body: `
## Role definition
You can now define the role. You have to add a name for the role as well as a short description.
There are some flags you can set:
- **Default user role**: This role will be assigned to all new users.
- **Default organizer role**: This role will be automatically included in the allowed roles of an organizer registration.
- **Show in hub**: This role will be shown in the hub, so users can see who has this role.

You can also add permissions to the role. The permissions are grouped by category. Learn more at [about permissions](/docs/about-permissions).

Permissions that are required by another permission are automatically included and shown as non-editable dependent permissions.
`,
  });
  await page.getByRole('textbox', { name: 'Name' }).fill('Test role');
  await page
    .getByRole('textbox', { name: 'Description' })
    .fill('Test role description');
  await page.getByRole('checkbox', { name: 'Events' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-role-form'),
    page,
    'Role form with permission groups',
  );
  await page.getByRole('button', { name: 'Save role' }).click();
  await expect(page.locator('app-role-details')).toHaveText(/Test role.*/);
  await testInfo.attach('markdown', {
    body: `
After you have saved your newly configured role, you will be redirected to the role details page.
The roles is now ready for it's first users.
`,
  });
});
