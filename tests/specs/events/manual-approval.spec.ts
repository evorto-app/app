import type { Browser, Page } from '@playwright/test';
import type { DateTime } from 'luxon';

import { and, eq } from 'drizzle-orm';

import { adminStateFile, userStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
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
  await expect(eventLink).toBeVisible();
  await eventLink.click();
  await expect(page).toHaveURL(new RegExp(`/events/${scenario.eventId}$`));
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

  await openEventFromList(organizer.page, scenario);
  await organizer.page
    .getByRole('link', { name: 'Organize this event' })
    .click();
  await expect(
    organizer.page.getByRole('heading', {
      level: 2,
      name: 'Participants',
    }),
  ).toBeVisible();

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
    registrationCard.getByText('Manual approval option'),
  ).toBeVisible();
  await expect(
    registrationCard.getByText(
      'Applying does not charge you or confirm a spot. An organizer reviews the application first; if this option has a fee, payment starts only after approval.',
    ),
  ).toBeVisible();
  await registrationCard
    .getByRole('button', { name: 'Apply for approval' })
    .click();
  await expect(
    page.getByText('Your registration is pending organizer approval.'),
  ).toBeVisible();
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
  test('confirms a free application exactly once', async ({
    browser,
    database,
    page,
    seeded,
    testClock,
  }) => {
    const scenario = await seedManualApprovalScenario({
      database,
      kind: 'free',
      seeded,
    });
    let organizer:
      Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

    try {
      await openEventFromList(page, scenario);
      await applyForApproval(page, scenario);
      const registration = await findParticipantRegistration(
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
        await approvalOutboxRows(database, registration.id, scenario.tenant.id),
      ).toHaveLength(0);
      expect(
        await database.query.eventRegistrationOptions.findFirst({
          columns: { confirmedSpots: true, reservedSpots: true },
          where: { id: scenario.optionId },
        }),
      ).toEqual({ confirmedSpots: 0, reservedSpots: 0 });

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
      await expect(approveButton).toBeEnabled();
      await approveButton.click();
      await expect(
        organizer.page.getByText('Registration confirmed'),
      ).toBeVisible();
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
          subject: 'Registration approved',
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
      expect(
        await database.query.transactions.findMany({
          where: { eventRegistrationId: registration.id },
        }),
      ).toHaveLength(0);
      expect(
        await approvalOutboxRows(database, registration.id, scenario.tenant.id),
      ).toHaveLength(1);
    } finally {
      await organizer?.context.close();
      await scenario.cleanup();
    }
  });

  test('creates one Checkout and confirms a paid application after payment', async ({
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
    let organizer:
      Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

    try {
      await openEventFromList(page, scenario);
      await applyForApproval(page, scenario);
      const registration = await findParticipantRegistration(
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
      await approveButton.click();
      await expect(
        organizer.page.getByText(
          'Application approved. Payment is required before confirmation.',
        ),
      ).toBeVisible();
      await expect(organizer.page.getByText('Payment pending')).toBeVisible();
      await expect(
        organizer.page.getByRole('button', { name: 'Approve application' }),
      ).toHaveCount(0);

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
        'Registration approved: payment required',
      );

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
      await expect(page.getByText('You are registered')).toBeVisible();
      await expect(
        page.getByRole('img', { name: 'QR code for the registration' }),
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
    } finally {
      await organizer?.context.close();
      await scenario.cleanup();
    }
  });

  test('recovers an interrupted payment setup and allows participant cancellation', async ({
    browser,
    database,
    page,
    seeded,
    testClock,
  }) => {
    test.setTimeout(180_000);
    const scenario = await seedManualApprovalScenario({
      database,
      kind: 'paid',
      seeded,
    });
    let organizer:
      Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

    try {
      await openEventFromList(page, scenario);
      await applyForApproval(page, scenario);
      const registration = await findParticipantRegistration(
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
      await expect(
        organizer.page.getByRole('button', { name: 'Approve application' }),
      ).toBeVisible();

      const transactionId = await scenario.preparePaymentSetupRetry({
        baseUrl: new URL(page.url()).origin,
        registrationId: registration.id,
      });
      expect(
        await database.query.transactions.findFirst({
          columns: { stripeAccountId: true },
          where: { id: transactionId },
        }),
      ).toEqual({ stripeAccountId: scenario.tenant.stripeAccountId });
      await organizer.page.reload();
      await expect(
        organizer.page.getByText('Payment setup needs retry'),
      ).toBeVisible();
      const retryButton = organizer.page.getByRole('button', {
        name: 'Retry payment setup',
      });
      await expect(retryButton).toBeEnabled();

      await page.reload();
      await waitForRegistrationStatus(page);
      await expect(
        page.getByRole('status').filter({
          hasText: 'Your payment link is being prepared.',
        }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Pay now' })).toHaveCount(0);

      await retryButton.click();
      await expect(
        organizer.page.getByText(
          'Application approved. Payment is required before confirmation.',
        ),
      ).toBeVisible();
      await expect(organizer.page.getByText('Payment pending')).toBeVisible();
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
      await page.getByRole('button', { name: 'Cancel registration' }).click();
      await expect(
        page.getByRole('button', { name: 'Apply for approval' }),
      ).toBeVisible();
      await expect
        .poll(async () => {
          const persistedRegistration =
            await database.query.eventRegistrations.findFirst({
              where: { id: registration.id },
            });
          const persistedTransaction =
            await database.query.transactions.findFirst({
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
            transactionStatus: persistedTransaction?.status,
          };
        })
        .toEqual({
          registrationStatus: 'CANCELLED',
          reservedSpots: 0,
          transactionStatus: 'cancelled',
        });
      expect(
        await database
          .select({ id: schema.transactions.id })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.eventRegistrationId, registration.id),
              eq(schema.transactions.type, 'registration'),
            ),
          ),
      ).toHaveLength(1);
    } finally {
      await organizer?.context.close();
      await scenario.cleanup();
    }
  });
});
