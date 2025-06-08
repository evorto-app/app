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

To access your profile, click on the **Profile** link in the navigation bar at the bottom of the screen (or on the left side on larger screens).
`,
  });

  // Click on the Profile link in the navigation bar
  await page.getByRole('link', { name: 'Profile' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('.navigation'),
    page,
    'Navigation bar with Profile link'
  );
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
- Contact information
- Preferences

You can view your profile information at any time by clicking on the Profile link in the navigation bar.
`,
  });

  // Wait for the page to stabilize
  await page.waitForTimeout(1000);

  // Take a screenshot of the entire profile component
  await takeScreenshot(
    testInfo,
    page.locator('app-user-profile'),
    page,
    'Profile information section'
  );

  await testInfo.attach('markdown', {
    body: `
## Summary

The user profile page provides a central place to view and manage your personal information, event registrations, and account settings. This makes it easy to keep track of your activity and customize your experience with the application.
`,
  });
});
