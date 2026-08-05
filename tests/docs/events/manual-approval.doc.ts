import type { Browser, Page } from '@playwright/test';
import type { DateTime } from 'luxon';

import { adminStateFile, userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import {
  type ManualApprovalScenario,
  seedManualApprovalScenario,
  waitForRegistrationStatus,
} from '../../support/utils/manual-approval-scenario';
import { deliverCompletedRegistrationCheckoutWebhook } from '../../support/utils/registration-checkout-webhook';

test.use({ storageState: userStateFile, trace: 'on-first-retry' });

const openEventFromNormalNavigation = async (
  page: Page,
  scenario: ManualApprovalScenario,
): Promise<void> => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Events' }).first(),
  ).toBeVisible();
  const eventLink = page
    .locator(`a[href="/events/${scenario.eventId}"]`)
    .first();
  await expect(eventLink).toBeVisible({ timeout: 20_000 });
  await eventLink.click();
  await expect(page).toHaveURL(new RegExp(`/events/${scenario.eventId}$`));
  await expect(
    page.getByRole('heading', { level: 1, name: scenario.eventTitle }),
  ).toBeVisible({ timeout: 15_000 });
  await waitForRegistrationStatus(page);
};

const openOrganizerView = async ({
  browser,
  participantPage,
  scenario,
  testClock,
}: {
  browser: Browser;
  participantPage: Page;
  scenario: ManualApprovalScenario;
  testClock: DateTime;
}) => {
  const organizer = await openAuthenticatedTestPage({
    baseUrl: new URL(participantPage.url()).origin,
    browser,
    storageState: adminStateFile,
    tenantDomain: scenario.tenant.domain,
    testClock,
  });
  await openEventFromNormalNavigation(organizer.page, scenario);
  const organizeLink = organizer.page.getByRole('link', {
    name: 'Organize this event',
  });
  await expect(organizeLink).toBeVisible();
  await organizeLink.click();
  await expect(
    organizer.page.getByRole('heading', {
      level: 2,
      name: 'Attendee sign-ups',
    }),
  ).toBeVisible({ timeout: 20_000 });
  return organizer;
};

const applyForApproval = async (
  page: Page,
  scenario: ManualApprovalScenario,
) => {
  const registrationCard = page
    .locator('app-event-registration-option')
    .filter({ hasText: scenario.optionTitle });
  await expect(
    registrationCard.getByText('Organizer approval required'),
  ).toBeVisible();
  await expect(
    registrationCard.getByText(
      'Applying does not charge you or confirm a place. An organizer reviews the application first; if this choice has a fee, payment starts only after approval.',
    ),
  ).toBeVisible();
  const applyButton = registrationCard.getByRole('button', {
    name: 'Apply for approval',
  });
  // SSR exposes the application action before Angular attaches its live click
  // listener. Event replay removes `jsaction` once the action is interactive.
  await expect(applyButton).not.toHaveAttribute('jsaction', /click/, {
    timeout: 20_000,
  });
  await applyButton.click();
  await expect(
    page.getByText('Your sign-up is waiting for organizer approval.'),
  ).toBeVisible({ timeout: 15_000 });
  return registrationCard;
};

const requireParticipantRegistration = async (
  database: Parameters<typeof seedManualApprovalScenario>[0]['database'],
  scenario: ManualApprovalScenario,
) => {
  const registration = await database.query.eventRegistrations.findFirst({
    where: {
      eventId: scenario.eventId,
      registrationOptionId: scenario.optionId,
      status: { NOT: 'CANCELLED' },
      tenantId: scenario.tenant.id,
      userId: scenario.participant.id,
    },
  });
  if (!registration) {
    throw new Error('Expected documented participant application');
  }
  return registration;
};

const approvalEmailsForRegistration = async (
  database: Parameters<typeof seedManualApprovalScenario>[0]['database'],
  registrationId: string,
  tenantId: string,
) => {
  const emails = await database.query.emailOutbox.findMany({
    where: { kind: 'manualApproval', tenantId },
  });
  return emails.filter((email) =>
    email.idempotencyKey.includes(`/${registrationId}/`),
  );
};

test.describe('Manual approval sign-ups', () => {
  test('Apply and receive free confirmation', async ({
    browser,
    database,
    page,
    seeded,
    testClock,
  }, testInfo) => {
    const scenario = await seedManualApprovalScenario({
      database,
      kind: 'free',
      seeded,
    });
    let organizer:
      Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

    try {
      await testInfo.attach('markdown', {
        body: `
{% callout type="note" title="Before you start" %}
An attendee whose organization role allows the event choice applies for a place. A person with **Organize all events** access, or an organizer/helper with a confirmed organizer ticket for this event, reviews the application.

Both people must be signed in to the same organization.

The event must be published and its sign-up window must be open. An application does not reserve a place, charge the attendee, or create a ticket. Those outcomes happen only after an organizer who can review applications approves it.
{% /callout %}


Manual approval is useful when organizers need to review each attendee before confirming a place. Free approvals confirm the place immediately. For paid places, the attendee receives a payment link and is confirmed after payment succeeds.

### Open the event as an attendee

1. Sign in and select **Events** in the main navigation.
2. Open the event you want to attend.
3. Find the card labeled **Organizer approval required**.
`,
      });

      await page.goto('/');
      const eventLink = page
        .locator(`a[href="/events/${scenario.eventId}"]`)
        .first();
      await expect(eventLink).toBeVisible({ timeout: 20_000 });
      await takeScreenshot(
        testInfo,
        eventLink,
        page,
        'Open the manual approval event from Events',
      );
      await eventLink.click();
      await waitForRegistrationStatus(page);

      const applicationCard = page
        .locator('app-event-registration-option')
        .filter({ hasText: scenario.optionTitle });
      await expect(
        applicationCard.getByText('Organizer approval required'),
      ).toBeVisible();
      await expect(
        applicationCard.getByText(
          'Applying does not charge you or confirm a place. An organizer reviews the application first; if this choice has a fee, payment starts only after approval.',
        ),
      ).toBeVisible();
      await takeScreenshot(
        testInfo,
        applicationCard,
        page,
        'Review the manual approval choice before applying',
      );

      await testInfo.attach('markdown', {
        body: `
### Apply for review

Select **Apply for approval** only after reviewing the choice. The application is saved immediately, but no place is reserved and no payment is started. You may withdraw it from the event page while it is still pending.
`,
      });
      await applyForApproval(page, scenario);
      await expect(
        page.getByRole('button', { name: 'Apply for approval' }),
      ).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Pay now' })).toHaveCount(0);
      await expect(
        page.getByRole('img', { name: 'QR code for the event ticket' }),
      ).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        page.locator('app-event-active-registration'),
        page,
        'Application awaiting organizer approval',
      );

      const registration = await requireParticipantRegistration(
        database,
        scenario,
      );
      expect(registration.status).toBe('PENDING');
      expect(
        await database.query.transactions.findMany({
          where: { eventRegistrationId: registration.id },
        }),
      ).toHaveLength(0);
      expect(
        await database.query.eventRegistrationOptions.findFirst({
          columns: { confirmedSpots: true, reservedSpots: true },
          where: { id: scenario.optionId },
        }),
      ).toEqual({ confirmedSpots: 0, reservedSpots: 0 });

      await testInfo.attach('markdown', {
        body: `
### Approve the application as an organizer

1. A person who can organize the event signs in.
2. Open **Events**, then open the same event.
3. Select **Organize this event**.
4. In **Attendee sign-ups**, verify the attendee and the **Awaiting approval** status.
5. Select **Approve application**.

For a free choice, this decision immediately confirms one place. Evorto also tries to send an approval email to the attendee. If that email does not arrive, the confirmed ticket is still available from the event page.
`,
      });
      organizer = await openOrganizerView({
        browser,
        participantPage: page,
        scenario,
        testClock,
      });
      await expect(
        organizer.page.getByText(
          `${scenario.participant.firstName} ${scenario.participant.lastName}`,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(organizer.page.getByText('Awaiting approval')).toBeVisible();
      const approveButton = organizer.page.getByRole('button', {
        name: 'Approve application',
      });
      await expect(approveButton).not.toHaveAttribute('jsaction', /click/, {
        timeout: 20_000,
      });
      await takeScreenshot(
        testInfo,
        [organizer.page.getByText('Awaiting approval'), approveButton],
        organizer.page,
        'Organizer reviews the pending application',
      );
      await approveButton.click();
      await expect(organizer.page.getByText('Sign-up confirmed')).toBeVisible({
        timeout: 20_000,
      });
      await expect(approveButton).toHaveCount(0);

      await expect
        .poll(async () => {
          const persisted = await database.query.eventRegistrations.findFirst({
            where: { id: registration.id },
          });
          const option =
            await database.query.eventRegistrationOptions.findFirst({
              columns: { confirmedSpots: true, reservedSpots: true },
              where: { id: scenario.optionId },
            });
          const emails = await approvalEmailsForRegistration(
            database,
            registration.id,
            scenario.tenant.id,
          );
          return {
            confirmedSpots: option?.confirmedSpots,
            emailCount: emails.length,
            reservedSpots: option?.reservedSpots,
            status: persisted?.status,
            subject: emails[0]?.subject,
          };
        })
        .toEqual({
          confirmedSpots: 1,
          emailCount: 1,
          reservedSpots: 0,
          status: 'CONFIRMED',
          subject: 'Sign-up approved',
        });

      await testInfo.attach('markdown', {
        body: `
### See the confirmed ticket

Open the event again after the organizer finishes to see the confirmed ticket and its QR code.

Once approval finishes, the application and approval actions disappear. The event keeps the same confirmed ticket and does not offer another approval action. No further action is needed.
`,
      });
      await page.reload();
      await waitForRegistrationStatus(page);
      await expect(page.getByText('Your place is confirmed')).toBeVisible();
      await expect(
        page.getByRole('img', { name: 'QR code for the event ticket' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Apply for approval' }),
      ).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        page.locator('app-event-active-registration'),
        page,
        'Free application confirmed with ticket',
      );
      expect(
        await approvalEmailsForRegistration(
          database,
          registration.id,
          scenario.tenant.id,
        ),
      ).toHaveLength(1);
    } finally {
      await organizer?.context.close();
      await scenario.cleanup();
    }
  });

  test('Withdraw a pending application and apply again', async ({
    database,
    page,
    seeded,
  }, testInfo) => {
    const scenario = await seedManualApprovalScenario({
      database,
      kind: 'paid',
      seeded,
    });

    try {
      const existingParticipantRegistrations =
        await database.query.eventRegistrations.findMany({
          columns: { id: true },
          where: {
            registrationOptionId: scenario.optionId,
            tenantId: scenario.tenant.id,
            userId: scenario.participant.id,
          },
        });
      const existingRegistrationIds = new Set(
        existingParticipantRegistrations.map((registration) => registration.id),
      );
      const capacityBeforeApplying =
        await database.query.eventRegistrationOptions.findFirst({
          columns: {
            confirmedSpots: true,
            reservedSpots: true,
            waitlistSpots: true,
          },
          where: { id: scenario.optionId },
        });

      await testInfo.attach('markdown', {
        body: `
{% callout type="note" title="Before you start" %}
Start with a published event that has an open **Organizer approval required** choice. You must be signed in and allowed to use that choice.

Withdrawing is available only while the application is still waiting for organizer approval. It does not cancel a confirmed ticket or a sign-up waiting for payment. Applying for the paid choice in this example does not charge the attendee or reserve a place.
{% /callout %}


1. Select **Events** in the main navigation.
2. Open the event.
3. Find the **Organizer approval required** choice and select **Apply for approval**.
4. Wait for **Your sign-up is waiting for organizer approval**.

The pending application card explains that withdrawal happens before approval. It has no QR ticket or payment action because the organizer has not approved it.
`,
      });

      await openEventFromNormalNavigation(page, scenario);
      const applicationCard = await applyForApproval(page, scenario);
      const firstApplication = await requireParticipantRegistration(
        database,
        scenario,
      );
      expect(firstApplication.status).toBe('PENDING');
      expect(
        await database.query.transactions.findMany({
          where: { eventRegistrationId: firstApplication.id },
        }),
      ).toHaveLength(0);
      expect(
        await database.query.eventRegistrationOptions.findFirst({
          columns: {
            confirmedSpots: true,
            reservedSpots: true,
            waitlistSpots: true,
          },
          where: { id: scenario.optionId },
        }),
      ).toEqual(capacityBeforeApplying);

      const activeApplication = page.locator('app-event-active-registration');
      await expect(
        activeApplication.getByText(
          'This withdraws your pending application before organizer approval.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Pay now' })).toHaveCount(0);
      await expect(
        page.getByRole('img', { name: 'QR code for the event ticket' }),
      ).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        activeApplication,
        page,
        'Pending application before withdrawal',
      );

      await testInfo.attach('markdown', {
        body: `
### Review the withdrawal before confirming

1. On the pending application, select **Withdraw application**.
2. Read the **Withdraw your application?** confirmation.
3. Select **Go back** if you are not certain. When the confirmation opens, pressing Enter chooses **Go back** and leaves the application unchanged.
4. To continue, open **Withdraw application** again and select **Withdraw application** in the confirmation.

The confirmation explains exactly what changes: the pending application is withdrawn immediately, it does not affect any confirmed places, and no refund starts. The withdrawal cannot be undone, but you can submit a new application while sign-up remains open.
`,
      });

      const cancelRegistration = activeApplication.getByRole('button', {
        exact: true,
        name: 'Withdraw application',
      });
      await expect(cancelRegistration).not.toHaveAttribute(
        'jsaction',
        /click/,
        { timeout: 20_000 },
      );
      await cancelRegistration.click();
      const cancellationDialog = page.getByRole('dialog', {
        name: 'Withdraw your application?',
      });
      await expect(cancellationDialog).toBeVisible();
      await expect(
        cancellationDialog.getByText(
          'This immediately withdraws your pending application. It does not affect any confirmed places or start a refund. This action cannot be undone.',
          { exact: true },
        ),
      ).toBeVisible();
      const keepRegistration = cancellationDialog.getByRole('button', {
        exact: true,
        name: 'Go back',
      });
      await expect(keepRegistration).toBeFocused();
      await takeScreenshot(
        testInfo,
        cancellationDialog,
        page,
        'Review the pending application withdrawal',
      );
      await keepRegistration.click();
      await expect(cancellationDialog).toHaveCount(0);
      await expect(activeApplication).toBeVisible();
      expect(
        await database.query.eventRegistrations.findFirst({
          where: { id: firstApplication.id },
        }),
      ).toEqual(expect.objectContaining({ status: 'PENDING' }));

      await cancelRegistration.click();
      await page
        .getByRole('dialog', { name: 'Withdraw your application?' })
        .getByRole('button', { exact: true, name: 'Withdraw application' })
        .click();
      await expect(activeApplication).toHaveCount(0, { timeout: 20_000 });
      await expect(
        applicationCard.getByRole('button', { name: 'Apply for approval' }),
      ).toBeVisible({ timeout: 20_000 });

      await expect
        .poll(async () => {
          const persistedApplication =
            await database.query.eventRegistrations.findFirst({
              where: { id: firstApplication.id },
            });
          const option =
            await database.query.eventRegistrationOptions.findFirst({
              columns: {
                confirmedSpots: true,
                reservedSpots: true,
                waitlistSpots: true,
              },
              where: { id: scenario.optionId },
            });
          const transactions = await database.query.transactions.findMany({
            where: { eventRegistrationId: firstApplication.id },
          });
          return {
            capacity: option,
            paymentCount: transactions.length,
            status: persistedApplication?.status,
          };
        })
        .toEqual({
          capacity: capacityBeforeApplying,
          paymentCount: 0,
          status: 'CANCELLED',
        });

      await testInfo.attach('markdown', {
        body: `
### Apply again if you still want to attend

After withdrawal, the event shows **Apply for approval** again. The cancelled application no longer blocks a new application.

Select **Apply for approval** to apply again. This still does not reserve a place or start payment; a paid option asks for payment only after organizer approval.
`,
      });

      await applyForApproval(page, scenario);
      const participantRegistrations =
        await database.query.eventRegistrations.findMany({
          orderBy: { createdAt: 'asc' },
          where: {
            registrationOptionId: scenario.optionId,
            tenantId: scenario.tenant.id,
            userId: scenario.participant.id,
          },
        });
      const documentedApplications = participantRegistrations.filter(
        (registration) => !existingRegistrationIds.has(registration.id),
      );
      expect(documentedApplications).toHaveLength(2);
      expect(
        documentedApplications.find(
          (registration) => registration.id === firstApplication.id,
        ),
      ).toEqual(expect.objectContaining({ status: 'CANCELLED' }));
      const reappliedApplication = documentedApplications.find(
        (registration) =>
          registration.id !== firstApplication.id &&
          registration.status === 'PENDING',
      );
      if (!reappliedApplication) {
        throw new Error('Expected a new pending application after withdrawal');
      }
      expect(
        await database.query.transactions.findMany({
          where: { eventRegistrationId: reappliedApplication.id },
        }),
      ).toHaveLength(0);
      expect(
        await database.query.eventRegistrationOptions.findFirst({
          columns: {
            confirmedSpots: true,
            reservedSpots: true,
            waitlistSpots: true,
          },
          where: { id: scenario.optionId },
        }),
      ).toEqual(capacityBeforeApplying);
      await takeScreenshot(
        testInfo,
        page.locator('app-event-active-registration'),
        page,
        'New application awaiting organizer review',
      );
    } finally {
      await scenario.cleanup();
    }
  });

  test('Approve a paid application and finish payment', async ({
    browser,
    database,
    page,
    request,
    seeded,
    testClock,
  }, testInfo) => {
    test.slow();
    const scenario = await seedManualApprovalScenario({
      database,
      kind: 'paid',
      seeded,
    });
    let organizer:
      Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

    try {
      await testInfo.attach('markdown', {
        body: `

A paid manual-approval choice still begins with an application, not a payment. Open **Events**, select the event, find the card labeled **Organizer approval required**, and select **Apply for approval**. The attendee is not charged before the organizer approves the application.
`,
      });
      await openEventFromNormalNavigation(page, scenario);
      await applyForApproval(page, scenario);
      const registration = await requireParticipantRegistration(
        database,
        scenario,
      );
      expect(
        await database.query.transactions.findMany({
          where: { eventRegistrationId: registration.id },
        }),
      ).toHaveLength(0);

      organizer = await openOrganizerView({
        browser,
        participantPage: page,
        scenario,
        testClock,
      });
      await expect(organizer.page.getByText('Awaiting approval')).toBeVisible();
      const approveButton = organizer.page.getByRole('button', {
        name: 'Approve application',
      });
      await expect(approveButton).not.toHaveAttribute('jsaction', /click/, {
        timeout: 20_000,
      });
      await takeScreenshot(
        testInfo,
        approveButton,
        organizer.page,
        'Approve a paid application',
      );

      await testInfo.attach('markdown', {
        body: `
### Organizer approval requests payment

Selecting **Approve application** reserves one place and prepares the attendee's payment link. It does not confirm the attendee yet. The organizer sees **Payment pending**, and the approval action disappears.

The approval email that Evorto tries to send shows the payment deadline in the organization's local time and names the organization clearly. If it does not arrive, the attendee can still reopen the event to see the deadline and continue payment.
`,
      });
      await approveButton.click();
      await expect(
        organizer.page.getByText(
          'Application approved. The attendee must pay before their place is confirmed.',
        ),
      ).toBeVisible({ timeout: 20_000 });
      await expect(organizer.page.getByText('Payment pending')).toBeVisible();
      await expect(approveButton).toHaveCount(0);

      await expect(async () => {
        const transactions = await database.query.transactions.findMany({
          where: {
            eventRegistrationId: registration.id,
            status: 'pending',
            type: 'registration',
          },
        });
        expect({
          count: transactions.length,
          hasSession: Boolean(transactions[0]?.stripeCheckoutSessionId),
          hasUrl: Boolean(transactions[0]?.stripeCheckoutUrl),
        }).toEqual({ count: 1, hasSession: true, hasUrl: true });
      }).toPass({
        intervals: [250, 500, 1_000],
        timeout: 15_000,
      });
      const [pendingTransaction] = await database.query.transactions.findMany({
        where: {
          eventRegistrationId: registration.id,
          status: 'pending',
          type: 'registration',
        },
      });
      if (
        !pendingTransaction?.stripeAccountId ||
        !pendingTransaction.stripeCheckoutSessionId ||
        !pendingTransaction.stripeCheckoutUrl
      ) {
        throw new Error(
          'Expected documented paid approval Checkout ownership details',
        );
      }
      expect(pendingTransaction.stripeAccountId).toBe(
        scenario.tenant.stripeAccountId,
      );
      expect(
        await database.query.eventRegistrationOptions.findFirst({
          columns: { confirmedSpots: true, reservedSpots: true },
          where: { id: scenario.optionId },
        }),
      ).toEqual({ confirmedSpots: 0, reservedSpots: 1 });
      const paymentApprovalEmails = await approvalEmailsForRegistration(
        database,
        registration.id,
        scenario.tenant.id,
      );
      expect(paymentApprovalEmails).toHaveLength(1);
      expect(paymentApprovalEmails[0]?.subject).toBe(
        'Sign-up approved: payment required',
      );
      expect(paymentApprovalEmails[0]?.text).toMatch(
        /\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/u,
      );
      expect(paymentApprovalEmails[0]?.text).toContain(
        `(local time for ${scenario.tenant.name})`,
      );

      await testInfo.attach('markdown', {
        body: `
### Attendee completes payment

Open the event again as the attendee. The approved application now explains that payment is required and shows **Pay now**. A ticket is still unavailable.

1. Select **Pay now**.
2. Review the event and amount on the payment page.
3. Enter the payment details and submit the payment.
4. Return to Evorto after payment succeeds.

The ticket is confirmed only after payment succeeds. Closing the payment page leaves the sign-up waiting for payment, and the same **Pay now** link can be used again.

{% callout type="note" title="About the payment screen" %}
**Pay now** opens a secure payment page. Available payment methods may vary. Review the event and amount before submitting payment, then return to Evorto to check that the ticket is confirmed.
{% /callout %}
`,
      });
      await page.reload();
      await waitForRegistrationStatus(page);
      await expect(
        page.getByText('Complete payment to confirm your ticket.'),
      ).toBeVisible();
      const payNow = page.getByRole('link', { name: 'Pay now' });
      await expect(payNow).toHaveAttribute(
        'href',
        pendingTransaction.stripeCheckoutUrl,
      );
      await expect(
        page.getByRole('img', { name: 'QR code for the event ticket' }),
      ).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        page.locator('app-event-active-registration'),
        page,
        'Paid application waiting for payment',
      );

      await deliverCompletedRegistrationCheckoutWebhook({
        amount: pendingTransaction.amount,
        applicationFeeAmount: pendingTransaction.appFee,
        currency: pendingTransaction.currency,
        paymentIntentId: pendingTransaction.stripePaymentIntentId,
        registrationId: registration.id,
        request,
        sessionId: pendingTransaction.stripeCheckoutSessionId,
        stripeAccountId: pendingTransaction.stripeAccountId,
        tenantId: scenario.tenant.id,
        transactionId: pendingTransaction.id,
      });

      await expect
        .poll(
          async () => {
            const transaction = await database.query.transactions.findFirst({
              where: { id: pendingTransaction.id },
            });
            const persistedRegistration =
              await database.query.eventRegistrations.findFirst({
                where: { id: registration.id },
              });
            return `${transaction?.status}:${persistedRegistration?.status}`;
          },
          {
            intervals: [1_000, 2_000, 4_000],
            timeout: 90_000,
          },
        )
        .toBe('successful:CONFIRMED');

      await testInfo.attach('markdown', {
        body: `
### Paid ticket confirmed

After payment succeeds, reopen the event to see the confirmed ticket and QR code.
`,
      });
      await page.reload();
      await waitForRegistrationStatus(page);
      await expect(page.getByText('Your place is confirmed')).toBeVisible();
      await expect(
        page.getByRole('img', { name: 'QR code for the event ticket' }),
      ).toBeVisible();
      await takeScreenshot(
        testInfo,
        page.locator('app-event-active-registration'),
        page,
        'Paid application confirmed after payment',
      );
      expect(
        await database.query.transactions.findMany({
          where: {
            eventRegistrationId: registration.id,
            type: 'registration',
          },
        }),
      ).toHaveLength(1);
      expect(
        await approvalEmailsForRegistration(
          database,
          registration.id,
          scenario.tenant.id,
        ),
      ).toHaveLength(1);
      expect(
        await database.query.eventRegistrationOptions.findFirst({
          columns: { confirmedSpots: true, reservedSpots: true },
          where: { id: scenario.optionId },
        }),
      ).toEqual({ confirmedSpots: 1, reservedSpots: 0 });
    } finally {
      await organizer?.context.close();
      await scenario.cleanup();
    }
  });

  test('Resolve a payment problem or cancel safely', async ({
    browser,
    database,
    page,
    seeded,
    testClock,
  }, testInfo) => {
    test.slow();
    const scenario = await seedManualApprovalScenario({
      database,
      kind: 'paid',
      seeded,
    });
    let organizer:
      Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

    try {
      await openEventFromNormalNavigation(page, scenario);
      await applyForApproval(page, scenario);
      const registration = await requireParticipantRegistration(
        database,
        scenario,
      );
      organizer = await openOrganizerView({
        browser,
        participantPage: page,
        scenario,
        testClock,
      });
      await expect(organizer.page.getByText('Awaiting approval')).toBeVisible();

      const transactionId = await scenario.preparePaymentSetupRetry({
        baseUrl: new URL(page.url()).origin,
        registrationId: registration.id,
      });
      await organizer.page.reload();
      await expect(
        organizer.page.getByText('Payment needs attention'),
      ).toBeVisible({ timeout: 20_000 });
      const retryButton = organizer.page.getByRole('button', {
        name: 'Try payment again',
      });
      await expect(retryButton).toBeEnabled();
      await expect(retryButton).not.toHaveAttribute('jsaction', /click/, {
        timeout: 20_000,
      });

      await testInfo.attach('markdown', {
        body: `

If the payment link could not be prepared after a place was reserved, use the existing sign-up rather than applying again.

- The organizer sees **Payment needs attention** and **Try payment again**.
- The attendee sees that the payment link is not ready yet and should not apply or pay again.
- Select **Try payment again** once. This continues the existing sign-up and does not reserve another place.
- If **Payment needs attention** remains, stop there and ask Evorto support to review the existing sign-up. Do not create another application, reserve another place, or pay again.
- Until the payment link is ready, cancellation keeps the sign-up and reserved place intact. First use **Try payment again**. To cancel after the link is ready, select **Cancel pending sign-up**, review the effect on the reserved place and payment, then select **Cancel sign-up**. When the confirmation opens, pressing Enter chooses **Go back**, so the sign-up and place stay unchanged.
`,
      });
      await takeScreenshot(
        testInfo,
        [organizer.page.getByText('Payment needs attention'), retryButton],
        organizer.page,
        'Organizer can try the payment again',
      );

      await page.reload();
      await waitForRegistrationStatus(page);
      const preparingStatus = page.getByRole('status').filter({
        hasText: 'Your payment link is not ready yet.',
      });
      await expect(preparingStatus).toBeVisible();
      await expect(page.getByRole('link', { name: 'Pay now' })).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        preparingStatus,
        page,
        'Attendee waits for a payment link',
      );

      await retryButton.click();
      await expect(
        organizer.page.getByText(
          'Application approved. The attendee must pay before their place is confirmed.',
        ),
      ).toBeVisible({ timeout: 20_000 });
      await expect(organizer.page.getByText('Payment pending')).toBeVisible({
        timeout: 20_000,
      });
      await expect(retryButton).toHaveCount(0);
      await expect
        .poll(async () => {
          const transaction = await database.query.transactions.findFirst({
            where: { id: transactionId },
          });
          return {
            hasSession: Boolean(transaction?.stripeCheckoutSessionId),
            hasUrl: Boolean(transaction?.stripeCheckoutUrl),
            status: transaction?.status,
          };
        })
        .toEqual({ hasSession: true, hasUrl: true, status: 'pending' });

      await page.reload();
      await waitForRegistrationStatus(page);
      await expect(page.getByRole('link', { name: 'Pay now' })).toBeVisible();
      const cancelRegistrationButton = page.getByRole('button', {
        name: 'Cancel pending sign-up',
      });
      // The reloaded SSR page exposes this action before its client listener.
      // Wait for event replay to hand the button to the hydrated application.
      await expect(cancelRegistrationButton).not.toHaveAttribute(
        'jsaction',
        /click/,
        { timeout: 20_000 },
      );
      await cancelRegistrationButton.click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Cancel sign-up' })
        .click();
      await expect(
        page.getByRole('button', { name: 'Apply for approval' }),
      ).toBeVisible();
      await expect
        .poll(async () => {
          const persistedRegistration =
            await database.query.eventRegistrations.findFirst({
              where: { id: registration.id },
            });
          const transaction = await database.query.transactions.findFirst({
            where: { id: transactionId },
          });
          const option =
            await database.query.eventRegistrationOptions.findFirst({
              columns: { reservedSpots: true },
              where: { id: scenario.optionId },
            });
          return {
            registrationStatus: persistedRegistration?.status,
            reservedSpots: option?.reservedSpots,
            transactionStatus: transaction?.status,
          };
        })
        .toEqual({
          registrationStatus: 'CANCELLED',
          reservedSpots: 0,
          transactionStatus: 'cancelled',
        });

      await testInfo.attach('markdown', {
        body: `
### After payment can no longer be completed

After Evorto confirms that payment can no longer be completed, it releases the reserved place and offers the application choice again. If this cannot be confirmed, the place remains reserved and the attendee sees an error with a **Try again** action. Select **Try again** once on the existing sign-up. If the same message remains, do not apply or pay again; contact the event organizer, who can ask Evorto support to review the reserved place. Apply again only after the old sign-up has been cancelled and **Apply for approval** appears again.

{% callout type="note" title="Application status" %}
- Organizers resolve a pending application by approving or cancelling it.
- Application and approval belong to this organization. Organizer access in another organization does not grant access here.
- Payment confirmation and the QR ticket appear only after payment succeeds.
{% /callout %}
`,
      });
      await takeScreenshot(
        testInfo,
        page
          .locator('app-event-registration-option')
          .filter({ hasText: scenario.optionTitle }),
        page,
        'Cancelled payment returns to application choice',
      );
    } finally {
      await organizer?.context.close();
      await scenario.cleanup();
    }
  });
});
