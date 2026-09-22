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
  registerDatabaseCleanup,
  scenario,
  testClock,
}: {
  browser: Browser;
  participantPage: Page;
  registerDatabaseCleanup: (cleanup: () => Promise<void>) => void;
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
  registerDatabaseCleanup(organizer.close);
  await openEventFromNormalNavigation(organizer.page, scenario);
  const organizeLink = organizer.page.getByRole('link', {
    name: 'Organize this event',
  });
  await expect(organizeLink).toBeVisible();
  await organizeLink.click();
  await expect(
    organizer.page.getByRole('heading', {
      level: 2,
      name: 'Participant registrations',
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
    registerDatabaseCleanup,
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
    registerDatabaseCleanup(scenario.cleanup);

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Before you start" %}
This guide uses two signed-in accounts in the same organization:
- a **participant** whose organization role is eligible for the event option;
- an **event manager** with **Organize all events** access, or an organizer/helper who already has a confirmed organizer registration for this event.

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
4. In **Participant registrations**, verify the participant and the **Awaiting approval** status.
5. Select **Approve application**.

For a free option, this decision immediately confirms one spot. Evorto also queues a single approval email to the participant's notification address.
`,
    });
    const organizer = await openOrganizerView({
      registerDatabaseCleanup,
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
        const option = await database.query.eventRegistrationOptions.findFirst({
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
This guide starts after you have found a published event with an open **Manual approval option**. You must be signed in and eligible for that option.

Withdrawing is available only while the application is still pending organizer approval. It does not cancel a confirmed ticket or a payment-in-progress registration. This example uses a paid option to make the boundary clear: applying has not opened Stripe Checkout, charged the participant, or reserved capacity yet.
{% /callout %}

# Withdraw a pending application

1. Select **Events** in the main navigation.
2. Open the event.
3. Find the **Manual approval option** and select **Apply for approval**.
4. Wait for **Your registration is pending organizer approval**.

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
        page.getByRole('img', { name: 'QR code for the registration' }),
      ).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        activeApplication,
        page,
        'Pending application before withdrawal',
      );

      await testInfo.attach('markdown', {
        body: `
## Review the withdrawal before confirming

1. On the pending application, select **Cancel registration**.
2. Read the **Cancel your pending registration?** confirmation.
3. Select **Keep registration** if you are not certain. It is focused by default, so pressing Enter when the dialog opens does not withdraw the application.
4. To continue, open **Cancel registration** again and select **Confirm cancellation**.

The confirmation states exactly what changes: the pending application is withdrawn immediately, no confirmed capacity is released, and no refund starts. The withdrawal cannot be undone, but you can submit a new application while registration remains open.
`,
      });

      const cancelRegistration = activeApplication.getByRole('button', {
        exact: true,
        name: 'Cancel registration',
      });
      await expect(cancelRegistration).not.toHaveAttribute(
        'jsaction',
        /click/,
        { timeout: 20_000 },
      );
      await cancelRegistration.click();
      const cancellationDialog = page.getByRole('dialog', {
        name: 'Cancel your pending registration?',
      });
      await expect(cancellationDialog).toBeVisible();
      await expect(
        cancellationDialog.getByText(
          'This immediately withdraws your pending application. It does not release confirmed capacity or start a refund. This action cannot be undone.',
          { exact: true },
        ),
      ).toBeVisible();
      const keepRegistration = cancellationDialog.getByRole('button', {
        exact: true,
        name: 'Keep registration',
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
        .getByRole('dialog', { name: 'Cancel your pending registration?' })
        .getByRole('button', { exact: true, name: 'Confirm cancellation' })
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
## Apply again if you still want to attend

After withdrawal, the event shows **Apply for approval** again. The cancelled application remains in the audit history as **Cancelled**, but it no longer blocks a new application.

Select **Apply for approval** to create a new pending application. The new application is a separate record for the organizer to review. Withdrawing and applying again still does not reserve capacity or start payment; a paid option reaches Stripe Checkout only after organizer approval.
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

  test('Approve a paid application and complete Checkout', async ({
    registerDatabaseCleanup,
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
    registerDatabaseCleanup(scenario.cleanup);

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

    const organizer = await openOrganizerView({
      registerDatabaseCleanup,
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
  });

  test('Ask for payment review while the existing sign-up stays reserved', async ({
    browser,
    database,
    page,
    registerDatabaseCleanup,
    seeded,
    testClock,
  }, testInfo) => {
    test.slow();
    const scenario = await seedManualApprovalScenario({
      database,
      kind: 'paid',
      seeded,
    });
    registerDatabaseCleanup(scenario.cleanup);
    await openEventFromNormalNavigation(page, scenario);
    await applyForApproval(page, scenario);
    const registration = await requireParticipantRegistration(
      database,
      scenario,
    );
    const organizer = await openOrganizerView({
      browser,
      participantPage: page,
      registerDatabaseCleanup,
      scenario,
      testClock,
    });
    const transactionId = await scenario.preparePaymentSetupRetry({
      baseUrl: new URL(page.url()).origin,
      registrationId: registration.id,
    });
    const originalClaim = await database.query.transactions.findFirst({
      where: { id: transactionId },
    });
    await organizer.page.reload();
    const reviewStatus = organizer.page
      .getByRole('status')
      .filter({ hasText: 'Payment setup needs review.' });
    await expect(reviewStatus).toBeVisible();
    await expect(
      organizer.page.getByRole('button', { name: 'Try payment again' }),
    ).toHaveCount(0);
    await expect(
      organizer.page.getByRole('button', { name: 'Approve application' }),
    ).toHaveCount(0);
    await testInfo.attach('markdown', {
      body: `

If the payment page could not be safely prepared, keep the existing sign-up.

- The organizer sees **Payment needs attention** and instructions to contact Evorto support for review.
- The attendee should contact the event organizer. Do not apply again or start another payment.
- The place remains reserved and the ticket stays unconfirmed while the payment is unresolved.
- Cancellation cannot release the place until the payment state is confirmed. Evorto shows this block explicitly and preserves the original sign-up.
- There is no automatic retry action for this state. Review the existing payment first. A normal **Pay now** link or a cancelled sign-up is shown only after its actual state supports that action.

{% callout type="note" title="Application states" %}
- A pending application does not reserve a place or create a ticket. The attendee may withdraw it before approval.
- Approving a paid application holds the place while payment is pending. The QR ticket appears only after Stripe reports a successful payment.
- An unresolved payment keeps its original claim and reserved place until review establishes the payment state. Do not repeat approval or start another payment.
- Application and approval belong to this organization. Organizer access in another organization does not grant access here.
{% /callout %}
`,
    });
    await takeScreenshot(
      testInfo,
      reviewStatus,
      organizer.page,
      'Organizer asks for review of the existing payment',
    );
    await page.reload();
    await waitForRegistrationStatus(page);
    const attendeeStatus = page
      .getByRole('status')
      .filter({ hasText: 'Contact an organizer to review this payment.' });
    await expect(attendeeStatus).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pay now' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Try payment again' }),
    ).toHaveCount(0);
    await takeScreenshot(
      testInfo,
      attendeeStatus,
      page,
      'Attendee keeps the existing sign-up and asks for review',
    );
    const cancel = page.getByRole('button', { name: 'Cancel registration' });
    await expect(cancel).not.toHaveAttribute('jsaction', /click/);
    await cancel.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm cancellation' })
      .click();
    const cancellationError = page
      .getByRole('alert')
      .filter({ hasText: 'Payment setup needs review' });
    await expect(cancellationError).toBeVisible();
    expect(
      await database.query.transactions.findFirst({
        where: { id: transactionId },
      }),
    ).toEqual(originalClaim);
    expect(
      await database.query.eventRegistrations.findFirst({
        columns: { status: true },
        where: { id: registration.id },
      }),
    ).toEqual({ status: 'PENDING' });
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: scenario.optionId },
      }),
    ).toEqual({ confirmedSpots: 0, reservedSpots: 1 });
    expect(
      await approvalEmailsForRegistration(
        database,
        registration.id,
        scenario.tenant.id,
      ),
    ).toHaveLength(0);
    await takeScreenshot(
      testInfo,
      cancellationError,
      page,
      'Cancellation leaves the unresolved payment and reserved place unchanged',
    );
  });
});
