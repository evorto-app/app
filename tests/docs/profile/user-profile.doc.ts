import { eq } from 'drizzle-orm';

import { addConsumedFinanceReceiptUpload } from '../../../helpers/add-finance-receipt-upload';
import { getId } from '../../../helpers/get-id';
import {
  defaultStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import {
  seedProfileEventCards,
  type SeededProfileEventCards,
} from '../../support/utils/profile-event-cards';

test.use({ storageState: defaultStateFile });

test('Manage your profile', async ({
  database,
  page,
  seedDate,
  seeded,
}, testInfo) => {
  const profileUser = usersToAuthenticate.find(
    (user) => user.stateFile === defaultStateFile,
  );
  if (!profileUser) {
    throw new Error('Expected dedicated profile user fixture');
  }
  const originalUser = await database.query.users.findFirst({
    where: { id: profileUser.id },
  });
  if (!originalUser) {
    throw new Error('Expected dedicated profile user to exist');
  }
  const documentedNotificationEmail = 'alex.member@example.org';
  const documentedIban = 'DE89370400440532013000';
  const documentedPaypalEmail = 'alex.paypal@example.org';
  const profileReceiptId = getId();
  const profileReceiptFileName = 'train-tickets.pdf';
  let profileReceiptUploadId: string | undefined;
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
      userId: profileUser.id,
    });
    profileReceiptUploadId = await addConsumedFinanceReceiptUpload(database, {
      eventId: profileEventId,
      fileName: profileReceiptFileName,
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      tenantId: seeded.tenant.id,
      uploadedByUserId: profileUser.id,
    });
    await database.insert(schema.financeReceipts).values({
      alcoholAmount: 0,
      attachmentFileName: profileReceiptFileName,
      attachmentUploadId: profileReceiptUploadId,
      currency: seeded.tenant.currency,
      depositAmount: 0,
      eventId: profileEventId,
      hasAlcohol: false,
      hasDeposit: false,
      id: profileReceiptId,
      purchaseCountry: 'DE',
      receiptDate: seedDate.toISOString().slice(0, 10),
      status: 'submitted',
      submittedByUserId: profileUser.id,
      taxAmount: 300,
      tenantId: seeded.tenant.id,
      totalAmount: 1875,
    });

    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `

Your profile contains your personal information and a quick overview of your recent activity. You can view and edit it at any time.

## Open your profile

To access your profile, select **Profile** in the navigation bar at the bottom of the screen (or on the left side on larger screens).
`,
    });

    // Click on the Profile link in the navigation bar
    await page.getByRole('link', { name: 'Profile', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Account details' }),
    ).toBeVisible();
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
      'Profile contact details and available actions',
    );

    await testInfo.attach('markdown', {
      body: `
## Profile information

The profile page displays your personal information, including:

- Name
- Sign-in email address and email for updates
- IBAN or PayPal details used when finance teams reimburse receipts

From here you can open the edit dialog to update your profile details.

## Use a private transfer code

If another attendee sends you a transfer code, select **Use transfer code** under **Ticket transfers**. Paste the complete code, including its hyphens, and review the event, questions you need to answer, price, guests, add-ons, check-ins, and handed-out items before accepting it. The code is not included in the transfer page's web address.
`,
    });

    const useTransferCode = page.getByRole('link', {
      exact: true,
      name: 'Use transfer code',
    });
    await expect(useTransferCode).toBeVisible();
    const ticketTransfers = page.locator('section').filter({
      has: useTransferCode,
    });
    await expect(
      ticketTransfers.getByRole('heading', { name: 'Ticket transfers' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      ticketTransfers,
      page,
      'Private transfer code guidance and Use transfer code action',
    );

    const editProfileButton = page.getByRole('button', {
      name: 'Edit profile',
    });
    await expect(editProfileButton).toBeVisible();
    // SSR exposes the button before Angular attaches its live click listener.
    // Event replay removes `jsaction` once the hydrated action is interactive.
    await expect(editProfileButton).not.toHaveAttribute('jsaction', /click/);

    await testInfo.attach('markdown', {
      body: `
## Edit your profile

Select **Edit profile** to open the profile dialog.
Messages beside each field explain what needs to be corrected, and **Save** becomes available after **First name**, **Last name**, and **Email for updates** are valid. IBAN and PayPal details are optional reimbursement details shared across your organizations. The profile summary updates immediately after saving.
`,
    });

    await editProfileButton.click();
    const editDialog = page.getByRole('dialog', { name: 'Edit profile' });
    await expect(editDialog).toBeVisible();
    await takeScreenshot(testInfo, editDialog, page, 'Edit profile dialog');

    await page.getByRole('textbox', { name: 'First name' }).fill('');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await takeScreenshot(
      testInfo,
      editDialog,
      page,
      'Profile fields that need attention',
    );
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(editDialog).toHaveCount(0);

    await testInfo.attach('markdown', {
      body: `
## Change your email for updates

You can use a different address for updates than for signing in. Optional IBAN and PayPal fields tell finance teams where to send reimbursements. After saving, the profile summary displays the updated email for updates while the sign-in email remains unchanged.
`,
    });

    await editProfileButton.click();
    await expect(editDialog).toBeVisible();
    await editDialog
      .getByRole('textbox', { exact: true, name: 'Email for updates' })
      .fill(documentedNotificationEmail);
    await editDialog
      .getByRole('textbox', {
        exact: true,
        name: 'IBAN (for reimbursements)',
      })
      .fill(documentedIban);
    await editDialog
      .getByRole('textbox', {
        exact: true,
        name: 'PayPal email (for reimbursements)',
      })
      .fill(documentedPaypalEmail);
    await editDialog.getByRole('button', { exact: true, name: 'Save' }).click();
    await expect(editDialog).toHaveCount(0);
    await expect(
      page.getByText(documentedNotificationEmail, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(originalUser.email, { exact: true }),
    ).toBeVisible();
    const updatedProfileUser = await database.query.users.findFirst({
      where: { id: profileUser.id },
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
      page.locator('app-user-profile'),
      page,
      'Saved email for updates',
    );

    await testInfo.attach('markdown', {
      body: `
## Profile pages

- **Overview** shows contact details and whether reimbursement details are ready, without displaying full bank details.
- **Events** links each ticket to its event and shows the sign-up choice, guests, add-ons, payment, and check-in details.
- From an event card, you can continue a payment or open the event to view its ticket, cancellation, transfer, or waitlist details.
- Other pages include **Discounts** and **Receipts**.
`,
    });

    await page
      .getByRole('navigation', { name: 'Profile sections' })
      .getByRole('link', { name: 'Events' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Your events' }),
    ).toBeVisible();
    const documentedEventCard = page
      .locator('article')
      .filter({ hasText: profileEventCards.confirmed.addOnTitle });
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
      pendingCheckoutCard.getByText('Waiting for confirmation', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      pendingCheckoutCard.getByText('Payment not finished', { exact: true }),
    ).toBeVisible();
    await expect(
      pendingCheckoutCard.getByText('Finish payment to confirm your place.'),
    ).toBeVisible();
    await expect(
      pendingCheckoutCard.getByText(
        'Finish payment here, or open the event page for your sign-up details.',
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
      waitlistCard.getByText('On waitlist', { exact: true }),
    ).toBeVisible();
    await expect(waitlistCard.getByText('No payment required')).toBeVisible();
    await expect(
      waitlistCard.getByText(
        'Open the event page for waitlist details and whether you can leave it.',
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
        'You are checked in. Open the event page for ticket details. You can no longer cancel, but you can still transfer the ticket and its existing check-ins.',
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
          userId: profileUser.id,
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
          userId: profileUser.id,
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
          userId: profileUser.id,
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
          userId: profileUser.id,
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
      page.locator('app-profile-events'),
      page,
      'Profile events page',
    );

    await page
      .getByRole('navigation', { name: 'Profile sections' })
      .getByRole('link', { name: 'Receipts' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Your receipts' }),
    ).toBeVisible();
    const profileReceiptCard = page
      .locator('article')
      .filter({ hasText: profileReceiptFileName });
    await expect(profileReceiptCard).toBeVisible();
    await expect(profileReceiptCard.getByText('Submitted')).toBeVisible();
    await expect(
      profileReceiptCard.getByText(profileEvent.title),
    ).toBeVisible();
    await expect(profileReceiptCard.getByText('18,75 €')).toBeVisible();
    const profileReceipt = await database.query.financeReceipts.findFirst({
      where: {
        id: profileReceiptId,
        submittedByUserId: profileUser.id,
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
      page.locator('app-profile-receipts'),
      page,
      'Profile receipts page',
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
      .where(eq(schema.users.id, profileUser.id));
    await database
      .delete(schema.financeReceipts)
      .where(eq(schema.financeReceipts.id, profileReceiptId));
    if (profileReceiptUploadId) {
      await database
        .delete(schema.financeReceiptUploads)
        .where(eq(schema.financeReceiptUploads.id, profileReceiptUploadId));
    }
    await profileEventCards?.cleanup();
  }
});
