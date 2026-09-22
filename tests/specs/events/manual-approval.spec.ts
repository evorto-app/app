import type { Browser, Page } from '@playwright/test';
import type { DateTime } from 'luxon';

import { adminStateFile, userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import {
  type ManualApprovalScenario,
  seedManualApprovalScenario,
  waitForRegistrationStatus,
} from '../../support/utils/manual-approval-scenario';
import { deliverCompletedRegistrationCheckoutWebhook } from '../../support/utils/registration-checkout-webhook';

test.use({ storageState: userStateFile, trace: 'on-first-retry' });

const openEventFromList = async (
  page: Page,
  scenario: ManualApprovalScenario,
): Promise<void> => {
  await page.goto('/');
  const eventLink = page
    .locator(`a[href="/events/${scenario.eventId}"]`)
    .first();
  await expect(eventLink).toBeVisible({ timeout: 20_000 });
  await eventLink.click();
  await expect(page).toHaveURL(new RegExp(`/events/${scenario.eventId}$`));
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

  await openEventFromList(organizer.page, scenario);
  await organizer.page
    .getByRole('link', { name: 'Organize this event' })
    .click();
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
): Promise<void> => {
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
    page.getByText('Your ticket is pending organizer approval.'),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole('button', { name: 'Apply for approval' }),
  ).toHaveCount(0);
};

const findParticipantRegistration = async (
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
    throw new Error('Expected participant manual approval registration');
  }
  return registration;
};

const approvalOutboxRows = async (
  database: Parameters<typeof seedManualApprovalScenario>[0]['database'],
  registrationId: string,
  tenantId: string,
) => {
  const rows = await database.query.emailOutbox.findMany({
    where: {
      kind: 'manualApproval',
      tenantId,
    },
  });
  return rows.filter((row) =>
    row.idempotencyKey.includes(`/${registrationId}/`),
  );
};

test.describe('Manual approval registrations', () => {
  test.describe.configure({ mode: 'default' });

  test('confirms a free application exactly once', async ({
    registerDatabaseCleanup,
    browser,
    database,
    page,
    seeded,
    testClock,
  }) => {
    test.setTimeout(180_000);
    const scenario = await seedManualApprovalScenario({
      database,
      kind: 'free',
      seeded,
    });
    registerDatabaseCleanup(scenario.cleanup);

    await openEventFromList(page, scenario);
    await applyForApproval(page, scenario);
    const registration = await findParticipantRegistration(database, scenario);

    expect(registration.status).toBe('PENDING');
    expect(
      await database.query.transactions.findMany({
        where: { eventRegistrationId: registration.id },
      }),
    ).toHaveLength(0);
    expect(
      await approvalOutboxRows(database, registration.id, scenario.tenant.id),
    ).toHaveLength(0);
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: scenario.optionId },
      }),
    ).toEqual({ confirmedSpots: 0, reservedSpots: 0 });

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
    await expect(approveButton).toBeEnabled();
    await expect(approveButton).not.toHaveAttribute('jsaction', /click/, {
      timeout: 20_000,
    });
    await approveButton.click();
    await expect(organizer.page.getByText('Ticket confirmed')).toBeVisible({
      timeout: 20_000,
    });
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
        const outbox = await approvalOutboxRows(
          database,
          registration.id,
          scenario.tenant.id,
        );
        return {
          confirmedSpots: option?.confirmedSpots,
          outboxCount: outbox.length,
          reservedSpots: option?.reservedSpots,
          status: persisted?.status,
          subject: outbox[0]?.subject,
        };
      })
      .toEqual({
        confirmedSpots: 1,
        outboxCount: 1,
        reservedSpots: 0,
        status: 'CONFIRMED',
        subject: 'Sign-up approved',
      });

    await page.reload();
    await waitForRegistrationStatus(page);
    await expect(page.getByText('Your place is confirmed')).toBeVisible();
    await expect(
      page.getByRole('img', { name: 'QR code for your event ticket' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Apply for approval' }),
    ).toHaveCount(0);
    expect(
      await database.query.transactions.findMany({
        where: { eventRegistrationId: registration.id },
      }),
    ).toHaveLength(0);
    expect(
      await approvalOutboxRows(database, registration.id, scenario.tenant.id),
    ).toHaveLength(1);
  });

  test('creates one Checkout and confirms a paid application after payment', async ({
    registerDatabaseCleanup,
    browser,
    database,
    page,
    request,
    seeded,
    testClock,
  }) => {
    test.setTimeout(180_000);
    const scenario = await seedManualApprovalScenario({
      database,
      kind: 'paid',
      seeded,
    });
    registerDatabaseCleanup(scenario.cleanup);

    await openEventFromList(page, scenario);
    await applyForApproval(page, scenario);
    const registration = await findParticipantRegistration(database, scenario);
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
    await approveButton.click();
    await expect(
      organizer.page.getByText(
        'Application approved. Payment is required before confirmation.',
      ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(organizer.page.getByText('Payment pending')).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      organizer.page.getByRole('button', { name: 'Approve application' }),
    ).toHaveCount(0);

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
      throw new Error('Expected paid approval Checkout ownership details');
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
    const approvalEmails = await approvalOutboxRows(
      database,
      registration.id,
      scenario.tenant.id,
    );
    expect(approvalEmails).toHaveLength(1);
    expect(approvalEmails[0]?.subject).toBe(
      'Sign-up approved: payment required',
    );

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
      page.getByRole('img', { name: 'QR code for your event ticket' }),
    ).toHaveCount(0);

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
          const persistedTransaction =
            await database.query.transactions.findFirst({
              where: { id: pendingTransaction.id },
            });
          const persistedRegistration =
            await database.query.eventRegistrations.findFirst({
              where: { id: registration.id },
            });
          return `${persistedTransaction?.status}:${persistedRegistration?.status}`;
        },
        {
          intervals: [1_000, 2_000, 4_000],
          timeout: 90_000,
        },
      )
      .toBe('successful:CONFIRMED');

    await page.reload();
    await waitForRegistrationStatus(page);
    await expect(page.getByText('Your place is confirmed')).toBeVisible();
    await expect(
      page.getByRole('img', { name: 'QR code for your event ticket' }),
    ).toBeVisible();
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: scenario.optionId },
      }),
    ).toEqual({ confirmedSpots: 1, reservedSpots: 0 });
    expect(
      await database.query.transactions.findMany({
        where: {
          eventRegistrationId: registration.id,
          type: 'registration',
        },
      }),
    ).toHaveLength(1);
    expect(
      await approvalOutboxRows(database, registration.id, scenario.tenant.id),
    ).toHaveLength(1);
  });

  test('cancels a manually approved application after its Checkout is ready', async ({
    browser,
    database,
    page,
    registerDatabaseCleanup,
    seeded,
    testClock,
  }) => {
    test.setTimeout(180_000);
    const scenario = await seedManualApprovalScenario({
      database,
      kind: 'paid',
      seeded,
    });
    registerDatabaseCleanup(scenario.cleanup);
    await openEventFromList(page, scenario);
    await applyForApproval(page, scenario);
    const registration = await findParticipantRegistration(database, scenario);
    const organizer = await openOrganizerView({
      browser,
      participantPage: page,
      registerDatabaseCleanup,
      scenario,
      testClock,
    });
    const approve = organizer.page.getByRole('button', {
      name: 'Approve application',
    });
    await expect(approve).not.toHaveAttribute('jsaction', /click/, {
      timeout: 20_000,
    });
    await approve.click();
    await expect(organizer.page.getByText('Payment pending')).toBeVisible({
      timeout: 20_000,
    });
    const claims = await database.query.transactions.findMany({
      where: { eventRegistrationId: registration.id, type: 'registration' },
    });
    expect(claims).toHaveLength(1);
    const claim = claims[0];
    if (!claim?.stripeCheckoutSessionId || !claim.stripeCheckoutUrl) {
      throw new Error('Expected a ready Checkout from normal manual approval');
    }
    expect(claim.stripeAccountId).toBe(scenario.tenant.stripeAccountId);
    expect(
      await approvalOutboxRows(database, registration.id, scenario.tenant.id),
    ).toHaveLength(1);
    await page.reload();
    await waitForRegistrationStatus(page);
    await expect(page.getByRole('link', { name: 'Pay now' })).toHaveAttribute(
      'href',
      claim.stripeCheckoutUrl,
    );
    const cancel = page.getByRole('button', { name: 'Cancel sign-up' });
    await expect(cancel).not.toHaveAttribute('jsaction', /click/, {
      timeout: 20_000,
    });
    await cancel.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel sign-up' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Apply for approval' }),
    ).toBeVisible({ timeout: 20_000 });
    expect(
      await database.query.transactions.findMany({
        where: { eventRegistrationId: registration.id, type: 'registration' },
      }),
    ).toEqual([
      expect.objectContaining({
        id: claim.id,
        status: 'cancelled',
        stripeAccountId: scenario.tenant.stripeAccountId,
      }),
    ]);
    expect(
      await database.query.eventRegistrations.findFirst({
        columns: { status: true },
        where: { id: registration.id },
      }),
    ).toEqual({ status: 'CANCELLED' });
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: scenario.optionId },
      }),
    ).toEqual({ confirmedSpots: 0, reservedSpots: 0 });
  });

  test('explains uncertain payment setup and preserves the original claim when cancellation is blocked', async ({
    browser,
    database,
    page,
    registerDatabaseCleanup,
    seeded,
    testClock,
  }) => {
    const scenario = await seedManualApprovalScenario({
      database,
      kind: 'paid',
      seeded,
    });
    registerDatabaseCleanup(scenario.cleanup);
    await openEventFromList(page, scenario);
    await applyForApproval(page, scenario);
    const registration = await findParticipantRegistration(database, scenario);
    const organizer = await openOrganizerView({
      browser,
      participantPage: page,
      registerDatabaseCleanup,
      scenario,
      testClock,
    });
    const transactionId = await scenario.prepareUncertainPaymentClaim({
      baseUrl: new URL(page.url()).origin,
      registrationId: registration.id,
    });
    const originalClaim = await database.query.transactions.findFirst({
      where: { id: transactionId },
    });
    expect(originalClaim).toMatchObject({
      status: 'pending',
      stripeAccountId: scenario.tenant.stripeAccountId,
      stripeCheckoutIncidentSessionId: null,
      stripeCheckoutSessionId: null,
      stripeCheckoutUrl: null,
    });
    await organizer.page.reload();
    await expect(
      organizer.page.getByText('Payment needs attention'),
    ).toBeVisible();
    await expect(
      organizer.page
        .getByRole('status')
        .filter({ hasText: 'Payment setup needs review.' }),
    ).toBeVisible();
    await expect(
      organizer.page.getByRole('button', { name: 'Try payment again' }),
    ).toHaveCount(0);
    await expect(
      organizer.page.getByRole('button', { name: 'Approve application' }),
    ).toHaveCount(0);
    await page.reload();
    await waitForRegistrationStatus(page);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Contact an organizer to review this payment.' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Try payment again' }),
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Pay now' })).toHaveCount(0);
    const cancel = page.getByRole('button', { name: 'Cancel sign-up' });
    await expect(cancel).not.toHaveAttribute('jsaction', /click/, {
      timeout: 20_000,
    });
    await cancel.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel sign-up' })
      .click();
    await expect(
      page
        .getByRole('alert')
        .getByText(
          'Payment setup needs review, so this request did not cancel the registration or release its reserved place. Keep this sign-up and contact the event organizer or Evorto support before starting another payment.',
        ),
    ).toBeVisible();
    expect(
      await database.query.transactions.findFirst({
        where: { id: transactionId },
      }),
    ).toEqual(originalClaim);
    expect(
      await database.query.transactions.findMany({
        where: {
          eventRegistrationId: registration.id,
          type: 'registration',
        },
      }),
    ).toHaveLength(1);
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
      await approvalOutboxRows(database, registration.id, scenario.tenant.id),
    ).toHaveLength(0);
    await page.reload();
    await waitForRegistrationStatus(page);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Contact an organizer to review this payment.' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Apply for approval' }),
    ).toHaveCount(0);
  });
});
