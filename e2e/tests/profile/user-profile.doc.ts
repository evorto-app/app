import { userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: userStateFile });

test('Manage user profile', async ({ page }, testInfo) => {
  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
# User Profile Management

Your user profile contains your personal information and a quick overview of your recent activity. You can view and edit your profile at any time.

## Accessing Your Profile

To access your profile, click on the **Profile** link in the navigation bar at the bottom of the screen (or on the left side on larger screens).
`,
  });

  // Click on the Profile link in the navigation bar
  await page.getByRole('link', { name: 'Profile' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('.navigation'),
    page,
    'Navigation bar with Profile link',
  );
  await takeScreenshot(
    testInfo,
    page.locator('app-user-profile'),
    page,
    'User profile page',
  );

  await testInfo.attach('markdown', {
    body: `
## Profile Information

The profile page displays your personal information, including:

- Name
- Email address

From here you can open the edit dialog to update your profile details.
`,
  });

  // Wait for the page to stabilize
  await page.waitForTimeout(1000);

  // Take a screenshot of the entire profile component
  await takeScreenshot(
    testInfo,
    page.locator('app-user-profile'),
    page,
    'Profile information section',
  );

  await testInfo.attach('markdown', {
    body: `
## Editing Your Profile

Click **Edit profile** to open the profile dialog.
The form uses inline validation, and the save button is only enabled when both names are filled in.
`,
  });

  await page.getByRole('button', { name: 'Edit profile' }).click();
  const editDialog = page.locator('mat-dialog-container');
  await expect(editDialog).toBeVisible();
  await takeScreenshot(testInfo, editDialog, page, 'Edit profile dialog');

  await page.getByRole('textbox', { name: 'First name' }).fill('');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await takeScreenshot(
    testInfo,
    editDialog,
    page,
    'Edit profile validation state',
  );
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(editDialog).toHaveCount(0);

  await testInfo.attach('markdown', {
    body: `
## Summary

The user profile page provides a central place to view your personal information, event registrations, and account actions. This makes it easy to keep track of your activity and manage your account.
`,
  });
});
