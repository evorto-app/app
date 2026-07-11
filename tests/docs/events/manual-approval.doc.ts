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
  await expect(eventLink).toBeVisible();
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
    organizer.page.getByRole('heading', { level: 2, name: 'Participants' }),
  ).toBeVisible();
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
    registrationCard.getByText('Manual approval option'),
  ).toBeVisible();
  await expect(
    registrationCard.getByText(
      'Applying does not charge you or confirm a spot. An organizer reviews the application first; if this option has a fee, payment starts only after approval.',
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
    page.getByText('Your registration is pending organizer approval.'),
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

test.describe('Manual approval registrations', () => {
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
This guide uses two signed-in accounts in the same tenant:
- a **participant** whose tenant role is eligible for the event option;
- an **event manager** with **events:organizeAll**, or an organizer/helper who already has a confirmed organizer registration for this event.

The event must be published and its registration window must be open. An application does not reserve a spot, charge the participant, or create a ticket. Those outcomes happen only after an authorized organizer approves it.
{% /callout %}

# Manual approval registrations

Manual approval is useful when organizers need to review each participant before confirming a place. Free approvals become confirmed immediately. Paid approvals create a Stripe Checkout link and remain unconfirmed until Stripe reports a successful payment.

## Open the event as a participant

1. Sign in and select **Events** in the main navigation.
2. Open the event you want to attend.
3. Find the card labeled **Manual approval option**.
`,
      });

      await page.goto('/');
      const eventLink = page
        .locator(`a[href="/events/${scenario.eventId}"]`)
        .first();
      await expect(eventLink).toBeVisible();
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
        applicationCard.getByText('Manual approval option'),
      ).toBeVisible();
      await expect(
        applicationCard.getByText(
          'Applying does not charge you or confirm a spot. An organizer reviews the application first; if this option has a fee, payment starts only after approval.',
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
## Apply for review

Select **Apply for approval** only after reviewing the option. The application is saved immediately, but no capacity is consumed and no payment is started. You may withdraw it from the event page while it is still pending.
`,
      });
      await applyForApproval(page, scenario);
      await expect(
        page.getByRole('button', { name: 'Apply for approval' }),
      ).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Pay now' })).toHaveCount(0);
      await expect(
        page.getByRole('img', { name: 'QR code for the registration' }),
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
## Approve the application as an organizer

1. Sign in with the event-manager or organizer account.
2. Open **Events**, then open the same event.
3. Select **Organize this event**.
4. In **Participants**, verify the participant and the **Awaiting approval** status.
5. Select **Approve application**.

For a free option, this decision immediately confirms one spot. Evorto also queues a single approval email to the participant's notification address.
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
      await expect(
        organizer.page.getByText('Registration confirmed'),
      ).toBeVisible({ timeout: 20_000 });
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
          subject: 'Registration approved',
        });

      await testInfo.attach('markdown', {
        body: `
## See the confirmed registration

The participant's already-open page does not assume that another account changed it in the background. Refresh or reopen the event after the organizer finishes. A successful free approval then shows the confirmed registration and its QR ticket.

The application and approval actions disappear after completion. Refreshing or selecting the old action again cannot create a second registration, consume another spot, or queue another approval email.
`,
      });
      await page.reload();
      await waitForRegistrationStatus(page);
      await expect(page.getByText('You are registered')).toBeVisible();
      await expect(
        page.getByRole('img', { name: 'QR code for the registration' }),
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

  test('Approve a paid application and complete Checkout', async ({
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
# Paid manual approval

A paid manual-approval option still begins with an application, not a payment. Follow **Events → event → Manual approval option → Apply for approval**. The participant is not charged and no Checkout exists before the organizer approves the application.
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
## Organizer approval requests payment

Selecting **Approve application** reserves one spot and prepares one Stripe Checkout session. It does not confirm the participant yet. The organizer sees **Payment pending**, and the approval action is removed so repeated clicks cannot create another live payment.
`,
      });
      await approveButton.click();
      await expect(
        organizer.page.getByText(
          'Application approved. Payment is required before confirmation.',
        ),
      ).toBeVisible({ timeout: 20_000 });
      await expect(organizer.page.getByText('Payment pending')).toBeVisible();
      await expect(approveButton).toHaveCount(0);

      await expect
        .poll(async () => {
          const transactions = await database.query.transactions.findMany({
            where: {
              eventRegistrationId: registration.id,
              status: 'pending',
              type: 'registration',
            },
          });
          return {
            count: transactions.length,
            hasSession: Boolean(transactions[0]?.stripeCheckoutSessionId),
            hasUrl: Boolean(transactions[0]?.stripeCheckoutUrl),
          };
        })
        .toEqual({ count: 1, hasSession: true, hasUrl: true });
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
        'Registration approved: payment required',
      );

      await testInfo.attach('markdown', {
        body: `
## Participant completes payment

Refresh or reopen the event as the participant. The pending registration now explains that payment is required and shows **Pay now**. A ticket is still unavailable.

1. Select **Pay now**.
2. Review the event and amount on Stripe Checkout.
3. Enter the payment details and submit the payment.
4. Return to Evorto after Stripe accepts it.

Only Stripe payment success confirms the registration. Closing Checkout leaves the registration pending, and the same **Pay now** link can be used again while the session is active.

{% callout type="note" title="About the payment screen" %}
Stripe Checkout opens on Stripe's website, and the available payment methods can vary. This guide verifies the exact **Pay now** destination and the signed completion event Evorto accepts from Stripe, so it shows Evorto immediately before and after payment instead of reproducing Stripe's card form.
{% /callout %}
`,
      });
      await page.reload();
      await waitForRegistrationStatus(page);
      await expect(
        page.getByText('Complete payment to confirm your registration.'),
      ).toBeVisible();
      const payNow = page.getByRole('link', { name: 'Pay now' });
      await expect(payNow).toHaveAttribute(
        'href',
        pendingTransaction.stripeCheckoutUrl,
      );
      await expect(
        page.getByRole('img', { name: 'QR code for the registration' }),
      ).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        page.locator('app-event-active-registration'),
        page,
        'Paid application awaiting Checkout',
      );

      await deliverCompletedRegistrationCheckoutWebhook({
        amount: pendingTransaction.amount,
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
## Paid registration confirmed

After Stripe reports successful payment, Evorto moves the reserved spot to confirmed capacity. Reopen the event to see the registration confirmation and QR ticket. There is still exactly one registration payment and one approval email for this application.
`,
      });
      await page.reload();
      await waitForRegistrationStatus(page);
      await expect(page.getByText('You are registered')).toBeVisible();
      await expect(
        page.getByRole('img', { name: 'QR code for the registration' }),
      ).toBeVisible();
      await takeScreenshot(
        testInfo,
        page.locator('app-event-active-registration'),
        page,
        'Paid application confirmed after Stripe payment',
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

  test('Recover interrupted payment setup or cancel safely', async ({
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
        organizer.page.getByText('Payment setup needs retry'),
      ).toBeVisible();
      const retryButton = organizer.page.getByRole('button', {
        name: 'Retry payment setup',
      });
      await expect(retryButton).toBeEnabled();
      await expect(retryButton).not.toHaveAttribute('jsaction', /click/, {
        timeout: 20_000,
      });

      await testInfo.attach('markdown', {
        body: `
# Recover interrupted payment setup

If Stripe Checkout could not be prepared after capacity was reserved, Evorto keeps the single payment claim instead of creating another one.

- The organizer sees **Payment setup needs retry** and **Retry payment setup**.
- The participant sees that the payment link is being prepared and is told to refresh shortly.
- Retrying resumes the same payment claim and does not reserve another spot.
- While the payment claim is still being reconciled, cancellation keeps the registration and reserved spot intact. First use **Retry payment setup** so Evorto can bind the Checkout, then **Cancel registration** safely expires it before releasing the reservation.
`,
      });
      await takeScreenshot(
        testInfo,
        [organizer.page.getByText('Payment setup needs retry'), retryButton],
        organizer.page,
        'Organizer can retry interrupted payment setup',
      );

      await page.reload();
      await waitForRegistrationStatus(page);
      const preparingStatus = page.getByRole('status').filter({
        hasText: 'Your payment link is being prepared.',
      });
      await expect(preparingStatus).toBeVisible();
      await expect(page.getByRole('link', { name: 'Pay now' })).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        preparingStatus,
        page,
        'Participant waits for a payment link',
      );

      await retryButton.click();
      await expect(
        organizer.page.getByText(
          'Application approved. Payment is required before confirmation.',
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
        name: 'Cancel registration',
      });
      // The reloaded SSR page exposes this action before its client listener.
      // Wait for event replay to hand the button to the hydrated application.
      await expect(cancelRegistrationButton).not.toHaveAttribute(
        'jsaction',
        /click/,
        { timeout: 20_000 },
      );
      await cancelRegistrationButton.click();
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
## Recovery complete

After Stripe confirms the pending Checkout is expired, Evorto cancels the local payment claim, releases the reserved spot, and returns the event to the application choice. If Stripe cannot confirm expiry, nothing is released and the participant receives a retryable error instead. The participant may apply again while registration remains open.

{% callout type="note" title="Current boundaries" %}
- A separate **Reject application** action is not currently available; organizers may approve or cancel a registration.
- Application and approval are tenant-scoped. Organizer access in another tenant does not grant access here.
- Payment confirmation and the QR ticket appear only after Stripe reports a successful payment.
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
