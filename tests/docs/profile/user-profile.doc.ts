import { eq } from 'drizzle-orm';
import type { Locator, Page } from '@playwright/test';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import {
  seedProfileEventCards,
  type SeededProfileEventCards,
} from '../../support/utils/profile-event-cards';

test.use({ storageState: userStateFile });

const profileSummarySurface = (page: Page): Locator =>
  page
    .locator('app-user-profile section')
    .filter({ has: page.getByRole('button', { name: 'Edit profile' }) })
    .first();

const profileNavigationSurface = (page: Page): Locator =>
  page
    .locator('.navigation')
    .filter({ has: page.getByRole('link', { name: 'Profile' }) })
    .first();

const profileEditDialogSurface = (page: Page): Locator =>
  page
    .locator('mat-dialog-container')
    .filter({
      has: page.getByRole('heading', { name: 'Edit profile' }),
    })
    .filter({ has: page.getByRole('textbox', { name: 'First name' }) })
    .filter({ has: page.getByRole('textbox', { name: 'Last name' }) })
    .filter({
      has: page.getByRole('textbox', { name: 'Notification email' }),
    })
    .filter({ has: page.getByRole('textbox', { name: 'IBAN' }) })
    .filter({ has: page.getByRole('textbox', { name: 'PayPal email' }) })
    .filter({ has: page.getByRole('button', { name: 'Save' }) })
    .first();

const profileEventCardSurface = (
  page: Page,
  eventTitle: string,
  addOnTitle: string,
): Locator =>
  page
    .locator('article')
    .filter({ hasText: eventTitle })
    .filter({
      hasText: addOnTitle,
    })
    .first();

const profileEventsSectionSurface = (page: Page): Locator =>
  page
    .locator('app-user-profile section')
    .filter({
      has: page.getByRole('heading', { name: 'Your Event Registrations' }),
    })
    .first();

const profileReceiptCardSurface = (
  page: Page,
  receiptFileName: string,
): Locator =>
  page.locator('article').filter({ hasText: receiptFileName }).first();

test('Manage user profile', async ({
  database,
  page,
  seedDate,
  seeded,
}, testInfo) => {
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
  const documentedIban = 'DE89370400440532013000';
  const documentedPaypalEmail = `profile-docs-paypal-${seedDate.getTime()}@evorto.app`;
  const profileReceiptId = getId();
  const profileReceiptFileName = `profile-docs-receipt-${seedDate.getTime()}.pdf`;
  const profileEventId = seeded.scenario.events.freeOpen.eventId;
  const profileEvent = seeded.events.find(
    (event) => event.id === profileEventId,
  );
  if (!profileEvent) {
    throw new Error('Expected seeded free profile event');
  }
  let profileEventCards: SeededProfileEventCards | undefined;

  try {
    profileEventCards = await seedProfileEventCards({
      database,
      seedDate,
      seeded,
      userId: regularUser.id,
    });
    await database.insert(schema.financeReceipts).values({
      attachmentFileName: profileReceiptFileName,
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 2048,
      eventId: profileEventId,
      id: profileReceiptId,
      purchaseCountry: 'DE',
      receiptDate: seedDate,
      status: 'submitted',
      submittedByUserId: regularUser.id,
      taxAmount: 300,
      tenantId: seeded.tenant.id,
      totalAmount: 1875,
    });

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
    const profileNavigation = profileNavigationSurface(page);
    const profileSummary = profileSummarySurface(page);
    await takeScreenshot(
      testInfo,
      profileNavigation,
      page,
      'Navigation bar with Profile link',
    );
    await expect(profileSummary).toBeVisible();
    await takeScreenshot(
      testInfo,
      [profileNavigation, profileSummary],
      page,
      'User profile overview with section navigation and personal details',
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

    // Take a screenshot of the profile summary card.
    await takeScreenshot(
      testInfo,
      profileSummary,
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
    const editDialog = profileEditDialogSurface(page);
    await expect(editDialog).toBeVisible();
    await takeScreenshot(
      testInfo,
      editDialog,
      page,
      'Edit profile dialog with personal information fields',
    );

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

The notification email is user-managed and may differ from the Auth0 login email. Optional IBAN and PayPal fields store global reimbursement details for finance teams. After saving, the profile summary displays the updated notification email while the login email remains unchanged.
`,
    });

    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(editDialog).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Notification email' })
      .fill(documentedNotificationEmail);
    await page.getByRole('textbox', { name: 'IBAN' }).fill(documentedIban);
    await page
      .getByRole('textbox', { name: 'PayPal email' })
      .fill(documentedPaypalEmail);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(editDialog).toHaveCount(0);
    await expect(
      page.getByText(`Notifications: ${documentedNotificationEmail}`),
    ).toBeVisible();
    await expect(page.getByText(`Login: ${originalUser.email}`)).toBeVisible();
    const updatedProfileUser = await database.query.users.findFirst({
      where: { id: regularUser.id },
    });
    if (!updatedProfileUser) {
      throw new Error('Expected generated profile docs user after update');
    }
    expect(updatedProfileUser.communicationEmail).toBe(
      documentedNotificationEmail,
    );
    expect(updatedProfileUser.iban).toBe(documentedIban);
    expect(updatedProfileUser.paypalEmail).toBe(documentedPaypalEmail);
    await takeScreenshot(
      testInfo,
      profileSummarySurface(page),
      page,
      'Profile notification email persisted',
    );

    await testInfo.attach('markdown', {
      body: `
## Summary

The user profile now uses a two-column layout:

- Left side: section navigation cards
- Right side: selected section content
- The **Events** section links each registration back to event details, shows registration status, selected option, guest quantity and purchased add-ons when applicable, payment state, and check-in time when available, and exposes implemented recovery actions such as continuing a pending checkout payment or opening the event page where confirmed tickets are shown
- Profile event cards point pending checkout registrations at the implemented profile action, route ticket/cancellation/unpaid-transfer details back to the event page, expose waitlist routing back to the event page, and stop advertising cancellation or transfer once a registration is checked in
- Other sections include **Overview**, **Discounts**, and **Receipts**
`,
    });

    await page.getByRole('button', { name: 'Events' }).click();
    await expect(
      page.getByRole('heading', { name: 'Your Event Registrations' }),
    ).toBeVisible();
    const documentedEventCard = profileEventCardSurface(
      page,
      profileEventCards.confirmed.eventTitle,
      profileEventCards.confirmed.addOnTitle,
    );
    await expect(documentedEventCard).toBeVisible();
    await expect(
      documentedEventCard.getByText(profileEventCards.confirmed.eventTitle),
    ).toBeVisible();
    await expect(
      documentedEventCard.getByText('Confirmed', { exact: true }),
    ).toBeVisible();
    await expect(
      documentedEventCard.getByText('Includes 1 guest'),
    ).toBeVisible();
    await expect(
      documentedEventCard.getByText(
        `2 x ${profileEventCards.confirmed.addOnTitle}`,
      ),
    ).toBeVisible();
    await expect(
      documentedEventCard.getByText('No payment required'),
    ).toBeVisible();
    await expect(
      documentedEventCard.getByText('Available on the event page.'),
    ).toBeVisible();
    await expect(
      documentedEventCard.getByRole('link', { name: 'Open event page' }),
    ).toHaveAttribute('href', `/events/${profileEventCards.confirmed.eventId}`);
    await expect(
      documentedEventCard.getByRole('link', { name: 'Continue payment' }),
    ).toHaveCount(0);
    const pendingCheckoutCard = page
      .locator('article')
      .filter({ hasText: profileEventCards.pendingCheckout.title });
    await expect(pendingCheckoutCard).toBeVisible();
    await expect(
      pendingCheckoutCard.getByText('Pending', { exact: true }),
    ).toBeVisible();
    await expect(
      pendingCheckoutCard.getByText('Payment pending'),
    ).toBeVisible();
    await expect(
      pendingCheckoutCard.getByText(
        'Finish the checkout payment to confirm your spot.',
      ),
    ).toBeVisible();
    await expect(
      pendingCheckoutCard.getByText(
        'Continue payment from this card, or open the event page for registration details.',
      ),
    ).toBeVisible();
    await expect(
      pendingCheckoutCard.getByRole('link', { name: 'Continue payment' }),
    ).toHaveAttribute('href', profileEventCards.pendingCheckout.checkoutUrl);
    await expect(
      pendingCheckoutCard.getByRole('link', { name: 'Open event page' }),
    ).toHaveAttribute(
      'href',
      `/events/${profileEventCards.pendingCheckout.eventId}`,
    );
    const waitlistCard = page
      .locator('article')
      .filter({ hasText: profileEventCards.waitlist.title });
    await expect(waitlistCard).toBeVisible();
    await expect(
      waitlistCard.getByText('Waitlist', { exact: true }),
    ).toBeVisible();
    await expect(waitlistCard.getByText('No payment required')).toBeVisible();
    await expect(
      waitlistCard.getByText(
        'Open the event page for waitlist details and the leave-waitlist action.',
      ),
    ).toBeVisible();
    await expect(
      waitlistCard.getByRole('link', { name: 'Open event page' }),
    ).toHaveAttribute('href', `/events/${profileEventCards.waitlist.eventId}`);
    await expect(
      waitlistCard.getByRole('link', { name: 'Continue payment' }),
    ).toHaveCount(0);
    const checkedInEventCard = page
      .locator('article')
      .filter({ hasText: profileEventCards.checkedIn.addOnTitle });
    await expect(checkedInEventCard).toBeVisible();
    await expect(
      checkedInEventCard.getByText(profileEventCards.checkedIn.eventTitle),
    ).toBeVisible();
    await expect(
      checkedInEventCard.getByText('Confirmed', { exact: true }),
    ).toBeVisible();
    await expect(checkedInEventCard.getByText('Checked in:')).toBeVisible();
    await expect(
      checkedInEventCard.getByText(
        `1 x ${profileEventCards.checkedIn.addOnTitle}`,
      ),
    ).toBeVisible();
    await expect(
      checkedInEventCard.getByText(
        'You are checked in. Open the event page for ticket details. Cancellation and transfer are no longer available after check-in.',
      ),
    ).toBeVisible();
    await expect(
      checkedInEventCard.getByText('Available on the event page.'),
    ).toHaveCount(0);
    await expect(
      checkedInEventCard.getByRole('link', { name: 'Open event page' }),
    ).toHaveAttribute('href', `/events/${profileEventCards.checkedIn.eventId}`);
    await expect(
      checkedInEventCard.getByRole('link', { name: 'Continue payment' }),
    ).toHaveCount(0);

    const confirmedRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          id: profileEventCards.confirmed.registrationId,
          status: 'CONFIRMED',
          userId: regularUser.id,
        },
      });
    expect(confirmedRegistration).toEqual(
      expect.objectContaining({
        eventId: profileEventCards.confirmed.eventId,
        guestCount: 1,
      }),
    );
    const confirmedAddonPurchase =
      await database.query.eventRegistrationAddonPurchases.findFirst({
        where: {
          id: profileEventCards.confirmed.addOnPurchaseId,
          registrationId: profileEventCards.confirmed.registrationId,
        },
      });
    expect(confirmedAddonPurchase).toEqual(
      expect.objectContaining({
        addonId: profileEventCards.confirmed.addonId,
        quantity: 2,
      }),
    );

    const pendingCheckoutTransaction =
      await database.query.transactions.findFirst({
        where: {
          eventRegistrationId: profileEventCards.pendingCheckout.registrationId,
          id: profileEventCards.pendingCheckout.transactionId,
          status: 'pending',
        },
      });
    expect(pendingCheckoutTransaction).toEqual(
      expect.objectContaining({
        stripeCheckoutUrl: profileEventCards.pendingCheckout.checkoutUrl,
        type: 'registration',
      }),
    );
    const pendingCheckoutRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          id: profileEventCards.pendingCheckout.registrationId,
          status: 'PENDING',
          userId: regularUser.id,
        },
      });
    expect(pendingCheckoutRegistration).toEqual(
      expect.objectContaining({
        eventId: profileEventCards.pendingCheckout.eventId,
        registrationOptionId: profileEventCards.pendingCheckout.optionId,
      }),
    );

    const waitlistRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          id: profileEventCards.waitlist.registrationId,
          status: 'WAITLIST',
          userId: regularUser.id,
        },
      });
    expect(waitlistRegistration).toEqual(
      expect.objectContaining({
        eventId: profileEventCards.waitlist.eventId,
        registrationOptionId: profileEventCards.waitlist.optionId,
      }),
    );

    const checkedInRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          id: profileEventCards.checkedIn.registrationId,
          status: 'CONFIRMED',
          userId: regularUser.id,
        },
      });
    expect(checkedInRegistration).toEqual(
      expect.objectContaining({
        checkInTime: seedDate,
        eventId: profileEventCards.checkedIn.eventId,
      }),
    );
    const checkedInAddonPurchase =
      await database.query.eventRegistrationAddonPurchases.findFirst({
        where: {
          id: profileEventCards.checkedIn.addOnPurchaseId,
          registrationId: profileEventCards.checkedIn.registrationId,
        },
      });
    expect(checkedInAddonPurchase).toEqual(
      expect.objectContaining({
        addonId: profileEventCards.checkedIn.addonId,
        quantity: 1,
      }),
    );
    await takeScreenshot(
      testInfo,
      [
        profileEventsSectionSurface(page),
        documentedEventCard,
        pendingCheckoutCard,
        waitlistCard,
        checkedInEventCard,
      ],
      page,
      'Profile events tab showing confirmed, pending, waitlist, and checked-in registrations',
    );

    await page.getByRole('button', { name: 'Receipts' }).click();
    await expect(
      page.getByRole('heading', { name: 'Submitted receipts' }),
    ).toBeVisible();
    const profileReceiptCard = profileReceiptCardSurface(
      page,
      profileReceiptFileName,
    );
    await expect(profileReceiptCard).toBeVisible();
    await expect(profileReceiptCard.getByText('Submitted')).toBeVisible();
    await expect(
      profileReceiptCard.getByText(profileEvent.title),
    ).toBeVisible();
    await expect(profileReceiptCard.getByText('18.75 €')).toBeVisible();
    const profileReceipt = await database.query.financeReceipts.findFirst({
      where: {
        id: profileReceiptId,
        submittedByUserId: regularUser.id,
        tenantId: seeded.tenant.id,
      },
    });
    if (!profileReceipt) {
      throw new Error('Expected generated profile docs receipt after read');
    }
    expect(profileReceipt).toEqual(
      expect.objectContaining({
        attachmentFileName: profileReceiptFileName,
        status: 'submitted',
        totalAmount: 1875,
      }),
    );
    await takeScreenshot(
      testInfo,
      profileReceiptCard,
      page,
      'Profile receipts tab showing submitted reimbursement receipts',
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
    await database
      .delete(schema.financeReceipts)
      .where(eq(schema.financeReceipts.id, profileReceiptId));
    await profileEventCards?.cleanup();
  }
});
