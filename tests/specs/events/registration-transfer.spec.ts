import { createId } from '@db/create-id';
import * as schema from '@db/schema';
import { and, eq, like } from 'drizzle-orm';

import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import { seedPaidRegistrationTransferScenario } from '../../support/utils/paid-registration-transfer-scenario';

test.use({ storageState: userStateFile, trace: 'on-first-retry' });

test('transfers a free registration through a private claim URL', async ({
  browser,
  database,
  page,
  seeded,
  tenant,
  testClock,
}) => {
  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const recipient = usersToAuthenticate.find((user) => user.roles === 'admin');
  const template = seeded.templates[0];
  if (!source || !recipient || !template) {
    throw new Error('Expected seeded source, recipient, and event template');
  }

  const eventId = createId();
  const optionId = createId();
  const sourceRegistrationId = createId();
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
  let recipientRegistrationId: string | undefined;
  let recipientPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  await database.insert(schema.eventInstances).values({
    creatorId: source.id,
    description: 'Transfer state-machine Playwright scenario',
    end: endsAt,
    icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
    id: eventId,
    start: startsAt,
    status: 'APPROVED',
    templateId: template.id,
    tenantId: tenant.id,
    title: 'Private transfer scenario',
    unlisted: true,
  });
  await database.insert(schema.eventRegistrationOptions).values({
    closeRegistrationTime: new Date(startsAt.getTime() - 60 * 60 * 1000),
    confirmedSpots: 1,
    eventId,
    id: optionId,
    isPaid: false,
    openRegistrationTime: new Date(Date.now() - 60 * 60 * 1000),
    organizingRegistration: false,
    price: 0,
    registeredDescription: 'Your transferred registration is confirmed.',
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 10,
    title: 'Participant',
    transferDeadlineHoursBeforeStart: 0,
  });
  await database.insert(schema.eventRegistrations).values({
    basePriceAtRegistration: 0,
    eventId,
    guestCount: 0,
    id: sourceRegistrationId,
    registrationOptionId: optionId,
    status: 'CONFIRMED',
    tenantId: tenant.id,
    userId: source.id,
  });

  try {
    await page.goto(`/events/${eventId}`);
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Create transfer link' }).click();
    await expect(
      page.getByRole('heading', { name: 'Private transfer link created' }),
    ).toBeVisible();
    const claimUrl = await page.getByLabel('Claim link').inputValue();
    const claimCode = await page.getByLabel('Manual claim code').inputValue();
    const claimToken = new URL(claimUrl).pathname.split('/').at(-1);
    if (!claimToken) throw new Error('Expected an opaque claim token in URL');
    expect(claimCode).toMatch(/^[A-F0-9]+(?:-[A-F0-9]+)+$/);

    const persistedOffer = await database.query.registrationTransfers.findFirst(
      {
        where: {
          sourceRegistrationId,
          tenantId: tenant.id,
        },
      },
    );
    expect(persistedOffer).toMatchObject({ status: 'open' });
    expect(persistedOffer?.claimTokenHash).toHaveLength(64);
    expect(persistedOffer?.claimTokenHash).not.toBe(claimToken);
    expect(persistedOffer?.claimCodeHash).toHaveLength(64);
    expect(persistedOffer?.claimCodeHash).not.toBe(claimCode);

    recipientPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: adminStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    await recipientPage.page.goto(new URL(claimUrl).pathname);
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Review before you claim',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByText('Private transfer scenario'),
    ).toBeVisible();
    await recipientPage.page
      .getByRole('button', { name: 'Claim registration' })
      .click();
    await expect(
      recipientPage.page.getByRole('heading', { name: 'Transfer complete' }),
    ).toBeVisible();

    const sourceRegistration =
      await database.query.eventRegistrations.findFirst({
        where: { id: sourceRegistrationId, tenantId: tenant.id },
      });
    const recipientRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          eventId,
          status: 'CONFIRMED',
          tenantId: tenant.id,
          userId: recipient.id,
        },
      });
    if (!recipientRegistration) {
      throw new Error('Expected confirmed recipient registration');
    }
    recipientRegistrationId = recipientRegistration.id;
    expect(sourceRegistration?.status).toBe('CANCELLED');
    expect(recipientRegistration).toMatchObject({
      basePriceAtRegistration: 0,
      guestCount: 0,
      registrationOptionId: optionId,
      status: 'CONFIRMED',
    });
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: optionId },
      }),
    ).toEqual({ confirmedSpots: 1, reservedSpots: 0 });
    expect(
      await database.query.registrationTransfers.findFirst({
        where: { sourceRegistrationId, tenantId: tenant.id },
      }),
    ).toMatchObject({
      recipientRegistrationId,
      recipientUserId: recipient.id,
      status: 'completed',
    });
    expect(
      await database
        .select({ id: schema.emailOutbox.id })
        .from(schema.emailOutbox)
        .where(
          and(
            eq(schema.emailOutbox.kind, 'registrationTransferred'),
            eq(schema.emailOutbox.tenantId, tenant.id),
            like(
              schema.emailOutbox.idempotencyKey,
              `%/${recipientRegistrationId}/%`,
            ),
          ),
        ),
    ).toHaveLength(2);
  } finally {
    await recipientPage?.context.close();
    if (recipientRegistrationId) {
      await database
        .delete(schema.emailOutbox)
        .where(
          like(
            schema.emailOutbox.idempotencyKey,
            `%/${recipientRegistrationId}/%`,
          ),
        );
    }
    await database
      .delete(schema.registrationTransfers)
      .where(
        eq(
          schema.registrationTransfers.sourceRegistrationId,
          sourceRegistrationId,
        ),
      );
    await database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.eventId, eventId));
    await database
      .delete(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.eventId, eventId));
    await database
      .delete(schema.eventInstances)
      .where(eq(schema.eventInstances.id, eventId));
  }
});

test('offers a paid registration privately while rejecting a source self-claim', async ({
  browser,
  database,
  page,
  seeded,
  tenant,
  testClock,
}) => {
  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const recipient = usersToAuthenticate.find((user) => user.roles === 'admin');
  const template = seeded.templates[0];
  if (!source || !recipient || !template) {
    throw new Error('Expected seeded paid-transfer users and template');
  }

  const eventId = createId();
  const optionId = createId();
  const sourceRegistrationId = createId();
  const sourceTransactionId = createId();
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  let recipientPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  await database.insert(schema.eventInstances).values({
    creatorId: source.id,
    description: 'Paid transfer offer Playwright scenario',
    end: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
    icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
    id: eventId,
    start: startsAt,
    status: 'APPROVED',
    templateId: template.id,
    tenantId: tenant.id,
    title: 'Paid private transfer scenario',
    unlisted: true,
  });
  await database.insert(schema.eventRegistrationOptions).values({
    closeRegistrationTime: new Date(startsAt.getTime() - 60 * 60 * 1000),
    confirmedSpots: 1,
    eventId,
    id: optionId,
    isPaid: true,
    openRegistrationTime: new Date(Date.now() - 60 * 60 * 1000),
    organizingRegistration: false,
    price: 1800,
    refundFeesOnCancellation: true,
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 10,
    title: 'Paid participant',
    transferDeadlineHoursBeforeStart: 0,
  });
  await database.insert(schema.eventRegistrations).values({
    basePriceAtRegistration: 1800,
    eventId,
    id: sourceRegistrationId,
    registrationOptionId: optionId,
    status: 'CONFIRMED',
    tenantId: tenant.id,
    userId: source.id,
  });
  await database.insert(schema.transactions).values({
    amount: 1800,
    appFee: 100,
    currency: 'EUR',
    eventId,
    eventRegistrationId: sourceRegistrationId,
    id: sourceTransactionId,
    method: 'stripe',
    status: 'successful',
    stripeFee: 200,
    stripeNetAmount: 1600,
    targetUserId: source.id,
    tenantId: tenant.id,
    type: 'registration',
  });

  try {
    await page.goto(`/events/${eventId}`);
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });
    await expect(
      page.getByRole('button', { name: 'Create transfer link' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Create transfer link' }).click();
    const claimUrl = await page.getByLabel('Claim link').inputValue();
    const claimPath = new URL(claimUrl).pathname;

    expect(
      await database.query.registrationTransfers.findFirst({
        where: { sourceRegistrationId, tenantId: tenant.id },
      }),
    ).toMatchObject({
      sourcePaymentTransactionId: sourceTransactionId,
      sourceRefundAmount: 1800,
      status: 'open',
    });

    await page.goto(claimPath);
    await expect(
      page.getByRole('heading', { name: 'Transfer could not be opened' }),
    ).toBeVisible();
    await expect(page.getByText(/cannot claim your own/i)).toBeVisible();

    recipientPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: adminStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    await recipientPage.page.goto(claimPath);
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Review before you claim',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByText('Paid private transfer scenario'),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByText('Current price').locator('..'),
    ).toContainText(/18[,.]00/);
    await expect(
      recipientPage.page.getByRole('button', { name: 'Claim registration' }),
    ).toBeVisible();
  } finally {
    await recipientPage?.context.close();
    await database
      .delete(schema.registrationTransfers)
      .where(
        eq(
          schema.registrationTransfers.sourceRegistrationId,
          sourceRegistrationId,
        ),
      );
    await database
      .delete(schema.transactions)
      .where(eq(schema.transactions.id, sourceTransactionId));
    await database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.id, sourceRegistrationId));
    await database
      .delete(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.id, optionId));
    await database
      .delete(schema.eventInstances)
      .where(eq(schema.eventInstances.id, eventId));
  }
});

test('completes a paid transfer and preserves its failed refund for operator requeue', async ({
  browser,
  database,
  page,
  seeded,
  tenant,
  testClock,
}) => {
  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const recipient = usersToAuthenticate.find((user) => user.roles === 'admin');
  const template = seeded.templates[0];
  if (!source || !recipient || !template) {
    throw new Error('Expected seeded paid-transfer users and template');
  }

  const scenario = await seedPaidRegistrationTransferScenario({
    database,
    recipient,
    source,
    templateId: template.id,
    tenant,
    title: 'Paid transfer recovery scenario',
  });
  let recipientPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  try {
    await page.goto(`/events/${scenario.eventId}`);
    recipientPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: adminStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    await recipientPage.page.goto(scenario.claimPath);
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Payment still required',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByRole('button', { name: 'Continue payment' }),
    ).toBeVisible();

    expect(await scenario.completeCheckout()).toBe('finalized');
    await recipientPage.page.reload();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Transfer complete — refund processing',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByRole('button', { name: 'Continue payment' }),
    ).toHaveCount(0);

    expect(
      await database.query.eventRegistrations.findFirst({
        columns: { status: true },
        where: {
          id: scenario.recipientRegistrationId,
          tenantId: tenant.id,
        },
      }),
    ).toEqual({ status: 'CONFIRMED' });
    expect(
      await database.query.eventRegistrations.findFirst({
        columns: { status: true },
        where: {
          id: scenario.sourceRegistrationId,
          tenantId: tenant.id,
        },
      }),
    ).toEqual({ status: 'CANCELLED' });
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: scenario.optionId },
      }),
    ).toEqual({ confirmedSpots: 1, reservedSpots: 0 });
    const refundClaim = await database.query.transactions.findFirst({
      where: {
        sourceTransactionId: scenario.sourceTransactionId,
        tenantId: tenant.id,
        type: 'refund',
      },
    });
    expect(refundClaim).toMatchObject({
      amount: -1800,
      method: 'stripe',
      status: 'pending',
      stripeAccountId: scenario.stripeAccountId,
      stripeRefundApplicationFee: true,
      targetUserId: source.id,
    });
    expect(refundClaim?.stripeRefundNextAttemptAt).not.toBeNull();
    expect(
      await database.query.registrationTransfers.findFirst({
        where: { id: scenario.transferId, tenantId: tenant.id },
      }),
    ).toMatchObject({
      recipientRegistrationId: scenario.recipientRegistrationId,
      refundTransactionId: refundClaim?.id,
      status: 'refund_pending',
    });

    const refundTransactionId = await scenario.failSourceRefund();
    expect(refundTransactionId).toBe(refundClaim?.id);
    await recipientPage.page.reload();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Transfer complete — refund needs attention',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByText(/do not need to pay or claim again/i),
    ).toBeVisible();
    expect(
      await database.query.registrationTransfers.findFirst({
        columns: { refundTransactionId: true, status: true },
        where: { id: scenario.transferId, tenantId: tenant.id },
      }),
    ).toEqual({
      refundTransactionId,
      status: 'refund_failed',
    });

    expect(await scenario.requeueSourceRefund()).toEqual({
      recoveryMode: 'newGeneration',
      transferStatus: 'requeued',
    });
    await recipientPage.page.reload();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Transfer complete — refund processing',
      }),
    ).toBeVisible();
    expect(
      await database.query.transactions.findFirst({
        columns: {
          status: true,
          stripeRefundAttempts: true,
          stripeRefundGeneration: true,
          stripeRefundHistory: true,
          stripeRefundId: true,
          stripeRefundNextAttemptAt: true,
          stripeRefundStatus: true,
        },
        where: { id: refundTransactionId, tenantId: tenant.id },
      }),
    ).toMatchObject({
      status: 'pending',
      stripeRefundAttempts: 0,
      stripeRefundGeneration: 1,
      stripeRefundHistory: [
        expect.objectContaining({
          refundId: `re_transfer_${scenario.sourceTransactionId}`,
          status: 'failed',
        }),
      ],
      stripeRefundId: null,
      stripeRefundStatus: null,
    });
    expect(
      (
        await database.query.transactions.findFirst({
          columns: { stripeRefundNextAttemptAt: true },
          where: { id: refundTransactionId, tenantId: tenant.id },
        })
      )?.stripeRefundNextAttemptAt,
    ).not.toBeNull();
  } finally {
    await recipientPage?.context.close();
    await scenario.cleanup();
  }
});

test('cancels a paid non-Stripe registration into one pending manual refund', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const template = seeded.templates[0];
  if (!source || !template) {
    throw new Error('Expected seeded paid-cancellation user and template');
  }

  const eventId = createId();
  const optionId = createId();
  const registrationId = createId();
  const sourceTransactionId = createId();
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await database.insert(schema.eventInstances).values({
    creatorId: source.id,
    description: 'Paid cancellation Playwright scenario',
    end: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
    icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
    id: eventId,
    start: startsAt,
    status: 'APPROVED',
    templateId: template.id,
    tenantId: tenant.id,
    title: 'Paid cancellation scenario',
    unlisted: true,
  });
  await database.insert(schema.eventRegistrationOptions).values({
    cancellationDeadlineHoursBeforeStart: 0,
    closeRegistrationTime: new Date(startsAt.getTime() - 60 * 60 * 1000),
    confirmedSpots: 1,
    eventId,
    id: optionId,
    isPaid: true,
    openRegistrationTime: new Date(Date.now() - 60 * 60 * 1000),
    organizingRegistration: false,
    price: 2400,
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 10,
    title: 'Paid participant',
  });
  await database.insert(schema.eventRegistrations).values({
    basePriceAtRegistration: 2400,
    eventId,
    id: registrationId,
    registrationOptionId: optionId,
    status: 'CONFIRMED',
    tenantId: tenant.id,
    userId: source.id,
  });
  await database.insert(schema.transactions).values({
    amount: 2400,
    currency: 'EUR',
    eventId,
    eventRegistrationId: registrationId,
    id: sourceTransactionId,
    method: 'cash',
    status: 'successful',
    targetUserId: source.id,
    tenantId: tenant.id,
    type: 'registration',
  });

  try {
    await page.goto(`/events/${eventId}`);
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });
    await expect(page.getByText('You are registered')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel registration' }).click();

    await expect
      .poll(async () => {
        const registration = await database.query.eventRegistrations.findFirst({
          where: { id: registrationId, tenantId: tenant.id },
        });
        return registration?.status;
      })
      .toBe('CANCELLED');
    expect(
      await database.query.transactions.findFirst({
        where: {
          sourceTransactionId,
          tenantId: tenant.id,
          type: 'refund',
        },
      }),
    ).toMatchObject({
      amount: -2400,
      manuallyCreated: true,
      method: 'cash',
      status: 'pending',
      targetUserId: source.id,
    });
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true },
        where: { id: optionId },
      }),
    ).toEqual({ confirmedSpots: 0 });
  } finally {
    await database
      .delete(schema.emailOutbox)
      .where(
        eq(
          schema.emailOutbox.idempotencyKey,
          `registration-cancelled/${tenant.id}/${registrationId}`,
        ),
      );
    await database
      .delete(schema.transactions)
      .where(
        and(
          eq(schema.transactions.eventRegistrationId, registrationId),
          eq(schema.transactions.type, 'refund'),
        ),
      );
    await database
      .delete(schema.transactions)
      .where(eq(schema.transactions.id, sourceTransactionId));
    await database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.id, registrationId));
    await database
      .delete(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.id, optionId));
    await database
      .delete(schema.eventInstances)
      .where(eq(schema.eventInstances.id, eventId));
  }
});
