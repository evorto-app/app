import { DateTime } from 'luxon';

import { userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: userStateFile });

test('Manage user profile', async ({ page }, testInfo) => {
  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
# User Profile Management

Your user profile contains your personal information and preferences. You can view and edit your profile at any time.

## Accessing Your Profile

To access your profile, click on your avatar or username in the top-right corner of the screen, then select **Profile** from the dropdown menu.
`,
  });

  // Click on the user menu and then the profile link
  await page.getByRole('button', { name: 'User menu' }).click();
  await takeScreenshot(
    testInfo,
    page.getByRole('menu'),
    page,
    'User menu dropdown'
  );

  await page.getByRole('menuitem', { name: 'Profile' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-user-profile'),
    page,
    'User profile page'
  );

  await testInfo.attach('markdown', {
    body: `
## Profile Information

The profile page displays your personal information, including:

- Name
- Email address
- Profile picture
- Contact information
- Preferences

You can edit most of this information by clicking the **Edit** button.
`,
  });

  await page.getByRole('button', { name: 'Edit profile' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('form'),
    page,
    'Edit profile form'
  );

  await testInfo.attach('markdown', {
    body: `
## Editing Your Profile

In the edit profile form, you can update your:

- Display name
- Contact information
- Profile picture
- Communication preferences
- Notification settings

Make your changes and click **Save** to update your profile.
`,
  });

  // Fill in some example data
  await page.getByLabel('Display name').fill('John Doe');
  await takeScreenshot(
    testInfo,
    page.locator('form'),
    page,
    'Filled edit profile form'
  );

  await testInfo.attach('markdown', {
    body: `
## Your Events

The profile page also shows your event registrations. You can see:

- Upcoming events you're registered for
- Past events you've attended
- Your tickets and QR codes for events

This makes it easy to keep track of your event participation.
`,
  });

  await page.getByRole('tab', { name: 'My events' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-user-profile'),
    page,
    'User events tab'
  );

  await testInfo.attach('markdown', {
    body: `
## Account Settings

You can also manage your account settings from your profile page.
`,
  });

  await page.getByRole('tab', { name: 'Settings' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-user-profile'),
    page,
    'Account settings tab'
  );

  await testInfo.attach('markdown', {
    body: `
In the settings tab, you can:

- Change your password
- Update your email preferences
- Manage connected accounts
- Set your language and regional preferences
- Configure privacy settings

These settings help you customize your experience with the application.
`,
  });
});
