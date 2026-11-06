import { organizerStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: organizerStateFile });
test('Manage and use Members Hub resources', async ({
  page,
  permissionOverride,
}, testInfo) => {
  await permissionOverride({
    roleName: 'Section member',
    add: ['internal:manageResources'],
  });
  await page.goto('/events');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Members Hub', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Manage resources', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add resource', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Shared documents');
  await page
    .getByLabel('Web or email address', { exact: true })
    .fill('https://drive.google.com/');
  await page.getByRole('button', { name: 'Change Icon', exact: true }).click();
  const picker = page.getByRole('dialog', {
    name: 'Choose an icon',
    exact: true,
  });
  await picker
    .getByRole('textbox', { name: 'Search', exact: true })
    .fill('user manual');
  await picker
    .getByRole('button', { name: 'Select User Manual icon', exact: true })
    .click();
  await takeScreenshot(
    testInfo,
    page.getByRole('region', { name: 'Resources', exact: true }),
    page,
    'Edit a hub resource',
  );
  await page
    .getByRole('button', { name: 'Save resources', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Shared documents', exact: true }),
  ).toBeVisible();
  await permissionOverride({
    roleName: 'Section member',
    remove: ['internal:manageResources'],
  });
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Manage resources', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Shared documents', exact: true }),
  ).toHaveAttribute('target', '_blank');
  await takeScreenshot(
    testInfo,
    page.locator('app-members-hub'),
    page,
    'Resources available to section members',
  );
  await testInfo.attach('markdown', {
    body: `## Members Hub resources

Open **Members Hub** to find useful links below the role directory. Web links open in a new tab; email links open your email app.

To maintain the list, your role needs **View Members Hub** and **Manage hub resources**. An organization administrator can grant these under Member roles. Select **Manage resources**, then **Add resource**. Enter a name and web or email address then use **Change Icon** to search and choose an icon, just as when creating an event. Use **Move up**, **Move down**, or **Remove** to maintain the list, then **Save resources**. **Cancel** discards your changes.

If someone else saves while you are editing, your draft stays visible and your save is rejected. Cancel and reopen the editor to load the latest list before applying your changes again.
`,
  });
});
