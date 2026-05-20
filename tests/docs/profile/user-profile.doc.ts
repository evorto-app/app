import { eq } from 'drizzle-orm';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: userStateFile });

test('Manage user profile', async ({ database, page, seedDate }, testInfo) => {
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
  const documentedNotificationEmail = `profile-docs-${seedDate.getTime()}@evorto.app`;

  try {
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
- Login email address and notification email address
- Global reimbursement details (IBAN / PayPal) used when finance teams record manual receipt reimbursements

From here you can open the edit dialog to update your profile details.
`,
    });

    await expect(
      page.getByRole('button', { name: 'Edit profile' }),
    ).toBeVisible();

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
The form uses inline validation, and the save button is only enabled when both names and the notification email are filled in. IBAN and PayPal details are optional global reimbursement details, not tenant-specific payout instructions. Saving the dialog updates the profile summary immediately after the profile query refreshes.
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
## Notification Email Persistence

The notification email is user-managed and may differ from the Auth0 login email. After saving, the profile summary displays the updated notification email while the login email remains unchanged.
`,
    });

    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(editDialog).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Notification email' })
      .fill(documentedNotificationEmail);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(editDialog).toHaveCount(0);
    await expect(
      page.getByText(`Notifications: ${documentedNotificationEmail}`),
    ).toBeVisible();
    await expect(page.getByText(`Login: ${originalUser.email}`)).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-user-profile'),
      page,
      'Profile notification email persisted',
    );

    await testInfo.attach('markdown', {
      body: `
## Summary

The user profile now uses a two-column layout:

- Left side: section navigation cards
- Right side: selected section content
- The **Events** section links each registration back to event details, shows registration status, selected option, guest quantity when applicable, payment state, and check-in time when available, and exposes implemented recovery actions such as continuing a pending checkout payment or opening the event page where confirmed tickets are shown
- Profile event cards point pending checkout registrations at the implemented profile action, route ticket/cancellation/unpaid-transfer details back to the event page, and stop advertising cancellation or transfer once a registration is checked in
- Other sections include **Overview**, **Discounts**, and **Receipts**
`,
    });

    await page.getByRole('button', { name: 'Events' }).click();
    await expect(
      page.getByRole('heading', { name: 'Your Event Registrations' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-user-profile'),
      page,
      'Profile events tab',
    );

    await page.getByRole('button', { name: 'Receipts' }).click();
    await takeScreenshot(
      testInfo,
      page.locator('app-user-profile'),
      page,
      'Profile receipts tab',
    );
  } finally {
    await database
      .update(schema.users)
      .set({
        communicationEmail: originalUser.communicationEmail,
        firstName: originalUser.firstName,
        iban: originalUser.iban,
        lastName: originalUser.lastName,
        paypalEmail: originalUser.paypalEmail,
      })
      .where(eq(schema.users.id, regularUser.id));
  }
});
