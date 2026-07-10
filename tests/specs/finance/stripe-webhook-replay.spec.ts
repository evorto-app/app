import type { APIRequestContext } from '@playwright/test';
import Stripe from 'stripe';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: userStateFile });

const regularUserId =
  usersToAuthenticate.find((user) => user.roles === 'user')?.id ??
  usersToAuthenticate[0].id;
const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';
const stripeAccountId = process.env['STRIPE_TEST_ACCOUNT_ID'] ?? '';

type SignedCheckoutWebhookInput = {
  eventId: string;
  registrationId: string;
  sessionId: string;
  tenantId: string;
  transactionId: string;
} & (
  | {
      eventType: 'checkout.session.completed';
      paymentIntentId: string;
    }
  | {
      eventType: 'checkout.session.expired';
    }
);

const buildSignedCheckoutWebhook = (input: SignedCheckoutWebhookInput) => {
  const isCompleted = input.eventType === 'checkout.session.completed';
  const payload = JSON.stringify({
    account: stripeAccountId,
    api_version: '2024-11-20.acacia',
    created: 1_706_784_000,
    data: {
      object: {
        id: input.sessionId,
        metadata: {
          registrationId: input.registrationId,
          tenantId: input.tenantId,
          transactionId: input.transactionId,
        },
        object: 'checkout.session',
        ...(isCompleted
          ? {
              amount_total: 2500,
              currency: 'eur',
              payment_intent: {
                id: input.paymentIntentId,
                latest_charge: `ch_test_${getId()}`,
              },
              payment_status: 'paid',
              status: 'complete',
            }
          : {
              payment_status: 'unpaid',
              status: 'expired',
            }),
      },
    },
    id: input.eventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: input.eventType,
  });

  return {
    payload,
    signature: Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    }),
  };
};

type RejectedCheckoutOwnershipScenario = {
  eventType: 'checkout.session.completed' | 'checkout.session.expired';
  label: string;
  registrationMatches: boolean;
  sessionMatches: boolean;
  transactionStatus: 'cancelled' | 'pending';
};

const assertCheckoutOwnershipRejected = async (input: {
  appEventId: string;
  database: NodePgDatabase<typeof relations>;
  optionId: string;
  request: APIRequestContext;
  scenario: RejectedCheckoutOwnershipScenario;
  tenantId: string;
}) => {
  const metadataRegistrationId = getId();
  const localRegistrationId = input.scenario.registrationMatches
    ? metadataRegistrationId
    : getId();
  const transactionId = getId();
  const webhookSessionId = `cs_test_${getId()}`;
  const localSessionId = input.scenario.sessionMatches
    ? webhookSessionId
    : `cs_test_${getId()}`;
  const paymentIntentId = `pi_test_${getId()}`;
  const stripeEventId = `evt_test_${getId()}`;

  await input.database.insert(schema.eventRegistrations).values({
    eventId: input.appEventId,
    id: metadataRegistrationId,
    registrationOptionId: input.optionId,
    status:
      localRegistrationId === metadataRegistrationId ? 'PENDING' : 'CANCELLED',
    tenantId: input.tenantId,
    userId: regularUserId,
  });
  if (localRegistrationId !== metadataRegistrationId) {
    await input.database.insert(schema.eventRegistrations).values({
      eventId: input.appEventId,
      id: localRegistrationId,
      registrationOptionId: input.optionId,
      status: 'PENDING',
      tenantId: input.tenantId,
      userId: regularUserId,
    });
  }

  await input.database.insert(schema.transactions).values({
    amount: 2500,
    comment: 'Webhook ownership rejection test',
    currency: 'EUR',
    eventId: input.appEventId,
    eventRegistrationId: localRegistrationId,
    executiveUserId: regularUserId,
    id: transactionId,
    method: 'stripe',
    status: input.scenario.transactionStatus,
    stripeAccountId,
    stripeCheckoutSessionId: localSessionId,
    stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${localSessionId}`,
    targetUserId: regularUserId,
    tenantId: input.tenantId,
    type: 'registration',
  });
  await input.database
    .update(schema.eventRegistrationOptions)
    .set({
      reservedSpots: sql`${schema.eventRegistrationOptions.reservedSpots} + 1`,
    })
    .where(eq(schema.eventRegistrationOptions.id, input.optionId));
  const optionBeforeWebhook =
    await input.database.query.eventRegistrationOptions.findFirst({
      columns: {
        confirmedSpots: true,
        reservedSpots: true,
      },
      where: { id: input.optionId },
    });
  expect(optionBeforeWebhook).toBeTruthy();

  const signedWebhook =
    input.scenario.eventType === 'checkout.session.completed'
      ? buildSignedCheckoutWebhook({
          eventId: stripeEventId,
          eventType: input.scenario.eventType,
          paymentIntentId,
          registrationId: metadataRegistrationId,
          sessionId: webhookSessionId,
          tenantId: input.tenantId,
          transactionId,
        })
      : buildSignedCheckoutWebhook({
          eventId: stripeEventId,
          eventType: input.scenario.eventType,
          registrationId: metadataRegistrationId,
          sessionId: webhookSessionId,
          tenantId: input.tenantId,
          transactionId,
        });
  const delivery = await input.request.fetch('/webhooks/stripe', {
    data: Buffer.from(signedWebhook.payload, 'utf8'),
    failOnStatusCode: false,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signedWebhook.signature,
    },
    method: 'POST',
  });
  const body = await delivery.text();
  expect(
    delivery.status(),
    `Expected rejected ownership to be safely acknowledged, received ${delivery.status()} with body "${body}"`,
  ).toBe(200);

  const metadataRegistration =
    await input.database.query.eventRegistrations.findFirst({
      where: { id: metadataRegistrationId, tenantId: input.tenantId },
    });
  const localRegistration =
    await input.database.query.eventRegistrations.findFirst({
      where: { id: localRegistrationId, tenantId: input.tenantId },
    });
  const localTransaction = await input.database.query.transactions.findFirst({
    where: { id: transactionId, tenantId: input.tenantId },
  });
  const optionAfterWebhook =
    await input.database.query.eventRegistrationOptions.findFirst({
      columns: {
        confirmedSpots: true,
        reservedSpots: true,
      },
      where: { id: input.optionId },
    });

  expect(metadataRegistration?.status).toBe(
    localRegistrationId === metadataRegistrationId ? 'PENDING' : 'CANCELLED',
  );
  expect(localRegistration?.status).toBe('PENDING');
  expect({
    chargeId: localTransaction?.stripeChargeId,
    paymentIntentId: localTransaction?.stripePaymentIntentId,
    sessionId: localTransaction?.stripeCheckoutSessionId,
    status: localTransaction?.status,
  }).toEqual({
    chargeId: null,
    paymentIntentId: null,
    sessionId: localSessionId,
    status: input.scenario.transactionStatus,
  });
  expect(optionAfterWebhook).toMatchObject({
    confirmedSpots: optionBeforeWebhook?.confirmedSpots,
    reservedSpots: optionBeforeWebhook?.reservedSpots,
  });
};

test.beforeAll(() => {
  expect(
    webhookSecret.length,
    'STRIPE_WEBHOOK_SECRET is required for webhook replay tests',
  ).toBeGreaterThan(0);
  expect(
    stripeAccountId.length,
    'STRIPE_TEST_ACCOUNT_ID is required for webhook replay tests',
  ).toBeGreaterThan(0);
});

test('an exact pending transaction and checkout session match completes once under webhook replay @finance @stripe', async ({
  database,
  request,
  seeded,
  tenant,
}) => {
  const registrationId = getId();
  const transactionId = getId();
  const checkoutSessionId = `cs_test_${getId()}`;
  const paymentIntentId = `pi_test_${getId()}`;
  const stripeEventId = `evt_test_${getId()}`;
  const originalOption =
    await database.query.eventRegistrationOptions.findFirst({
      columns: {
        confirmedSpots: true,
        reservedSpots: true,
      },
      where: { id: seeded.scenario.events.paidOpen.optionId },
    });
  expect(originalOption).toBeTruthy();

  await database
    .delete(schema.stripeWebhookEvents)
    .where(eq(schema.stripeWebhookEvents.stripeEventId, stripeEventId));

  await database
    .update(schema.eventRegistrationOptions)
    .set({
      reservedSpots: sql`${schema.eventRegistrationOptions.reservedSpots} + 1`,
    })
    .where(
      eq(
        schema.eventRegistrationOptions.id,
        seeded.scenario.events.paidOpen.optionId,
      ),
    );

  await database.insert(schema.eventRegistrations).values({
    eventId: seeded.scenario.events.paidOpen.eventId,
    id: registrationId,
    registrationOptionId: seeded.scenario.events.paidOpen.optionId,
    status: 'PENDING',
    tenantId: tenant.id,
    userId: regularUserId,
  });

  await database.insert(schema.transactions).values({
    amount: 2500,
    comment: 'Webhook replay determinism test',
    currency: 'EUR',
    eventId: seeded.scenario.events.paidOpen.eventId,
    eventRegistrationId: registrationId,
    executiveUserId: regularUserId,
    id: transactionId,
    method: 'stripe',
    status: 'pending',
    stripeAccountId,
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
    targetUserId: regularUserId,
    tenantId: tenant.id,
    type: 'registration',
  });

  const payload = JSON.stringify({
    account: stripeAccountId,
    api_version: '2024-11-20.acacia',
    created: 1_706_784_000,
    data: {
      object: {
        amount_total: 2500,
        currency: 'eur',
        id: checkoutSessionId,
        metadata: {
          registrationId,
          tenantId: tenant.id,
          transactionId,
        },
        object: 'checkout.session',
        payment_intent: {
          id: paymentIntentId,
          latest_charge: 'ch_test_' + getId(),
        },
        payment_status: 'paid',
        status: 'complete',
      },
    },
    id: stripeEventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: 'checkout.session.completed',
  });

  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  const firstDelivery = await request.fetch('/webhooks/stripe', {
    data: Buffer.from(payload, 'utf8'),
    failOnStatusCode: false,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    method: 'POST',
  });
  const firstBody = await firstDelivery.text();
  expect(
    firstDelivery.status(),
    `Expected first webhook delivery to return 200, received ${firstDelivery.status()} with body "${firstBody}"`,
  ).toBe(200);

  const secondDelivery = await request.fetch('/webhooks/stripe', {
    data: Buffer.from(payload, 'utf8'),
    failOnStatusCode: false,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    method: 'POST',
  });
  const secondBody = await secondDelivery.text();
  expect(
    secondDelivery.status(),
    `Expected replayed webhook delivery to return 200, received ${secondDelivery.status()} with body "${secondBody}"`,
  ).toBe(200);

  await expect
    .poll(async () => {
      const updatedRegistration =
        await database.query.eventRegistrations.findFirst({
          where: { id: registrationId, tenantId: tenant.id },
        });
      return updatedRegistration?.status;
    })
    .toBe('CONFIRMED');

  await expect
    .poll(async () => {
      const updatedTransaction = await database.query.transactions.findFirst({
        where: { id: transactionId, tenantId: tenant.id },
      });
      return {
        paymentIntentId: updatedTransaction?.stripePaymentIntentId,
        status: updatedTransaction?.status,
      };
    })
    .toEqual({
      paymentIntentId,
      status: 'successful',
    });

  await expect
    .poll(async () => {
      const updatedOption =
        await database.query.eventRegistrationOptions.findFirst({
          columns: {
            confirmedSpots: true,
            reservedSpots: true,
          },
          where: { id: seeded.scenario.events.paidOpen.optionId },
        });

      return {
        confirmedSpots: updatedOption?.confirmedSpots,
        reservedSpots: updatedOption?.reservedSpots,
      };
    })
    .toEqual({
      confirmedSpots: (originalOption?.confirmedSpots ?? 0) + 1,
      reservedSpots: originalOption?.reservedSpots,
    });

  const dedupeRecords = await database.query.stripeWebhookEvents.findMany({
    where: { stripeEventId },
  });
  expect(dedupeRecords).toHaveLength(1);
  expect(dedupeRecords[0]?.status).toBe('processed');
  const confirmationEmail = await database.query.emailOutbox.findFirst({
    where: {
      idempotencyKey: `registration-confirmed/${tenant.id}/${registrationId}`,
      kind: 'registrationConfirmed',
      tenantId: tenant.id,
    },
  });
  const registrationUser = await database.query.users.findFirst({
    columns: {
      communicationEmail: true,
    },
    where: { id: regularUserId },
  });
  expect(confirmationEmail).toMatchObject({
    kind: 'registrationConfirmed',
    toEmail: registrationUser?.communicationEmail,
  });
  expect(confirmationEmail?.html).toContain(
    `/events/${seeded.scenario.events.paidOpen.eventId}`,
  );
});

for (const rejectedOwnership of [
  {
    eventType: 'checkout.session.completed',
    label:
      'completed checkout webhook cannot use a checkout session id that differs from the local transaction',
    registrationMatches: true,
    sessionMatches: false,
    transactionStatus: 'pending',
  },
  {
    eventType: 'checkout.session.completed',
    label:
      'completed checkout webhook cannot use registration metadata that differs from the local transaction',
    registrationMatches: false,
    sessionMatches: true,
    transactionStatus: 'pending',
  },
  {
    eventType: 'checkout.session.expired',
    label:
      'expired checkout webhook cannot release capacity after the local transaction was cancelled',
    registrationMatches: true,
    sessionMatches: true,
    transactionStatus: 'cancelled',
  },
] as const) {
  test(`${rejectedOwnership.label} @finance @stripe`, async ({
    database,
    request,
    seeded,
    tenant,
  }) => {
    await assertCheckoutOwnershipRejected({
      appEventId: seeded.scenario.events.paidOpen.eventId,
      database,
      optionId: seeded.scenario.events.paidOpen.optionId,
      request,
      scenario: rejectedOwnership,
      tenantId: tenant.id,
    });
  });
}

test('competing completion and expiry webhooks leave one coherent registration outcome @finance @stripe', async ({
  database,
  request,
  seeded,
  tenant,
}) => {
  const registrationId = getId();
  const transactionId = getId();
  const checkoutSessionId = `cs_test_${getId()}`;
  const paymentIntentId = `pi_test_${getId()}`;
  const originalOption =
    await database.query.eventRegistrationOptions.findFirst({
      columns: {
        confirmedSpots: true,
        reservedSpots: true,
      },
      where: { id: seeded.scenario.events.paidOpen.optionId },
    });
  expect(originalOption).toBeTruthy();

  await database
    .update(schema.eventRegistrationOptions)
    .set({
      reservedSpots: sql`${schema.eventRegistrationOptions.reservedSpots} + 1`,
    })
    .where(
      eq(
        schema.eventRegistrationOptions.id,
        seeded.scenario.events.paidOpen.optionId,
      ),
    );
  await database.insert(schema.eventRegistrations).values({
    eventId: seeded.scenario.events.paidOpen.eventId,
    id: registrationId,
    registrationOptionId: seeded.scenario.events.paidOpen.optionId,
    status: 'PENDING',
    tenantId: tenant.id,
    userId: regularUserId,
  });
  await database.insert(schema.transactions).values({
    amount: 2500,
    comment: 'Webhook completion-expiry race test',
    currency: 'EUR',
    eventId: seeded.scenario.events.paidOpen.eventId,
    eventRegistrationId: registrationId,
    executiveUserId: regularUserId,
    id: transactionId,
    method: 'stripe',
    status: 'pending',
    stripeAccountId,
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
    targetUserId: regularUserId,
    tenantId: tenant.id,
    type: 'registration',
  });

  const completedWebhook = buildSignedCheckoutWebhook({
    eventId: `evt_test_${getId()}`,
    eventType: 'checkout.session.completed',
    paymentIntentId,
    registrationId,
    sessionId: checkoutSessionId,
    tenantId: tenant.id,
    transactionId,
  });
  const expiredWebhook = buildSignedCheckoutWebhook({
    eventId: `evt_test_${getId()}`,
    eventType: 'checkout.session.expired',
    registrationId,
    sessionId: checkoutSessionId,
    tenantId: tenant.id,
    transactionId,
  });

  const [completedDelivery, expiredDelivery] = await Promise.all([
    request.fetch('/webhooks/stripe', {
      data: Buffer.from(completedWebhook.payload, 'utf8'),
      failOnStatusCode: false,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': completedWebhook.signature,
      },
      method: 'POST',
    }),
    request.fetch('/webhooks/stripe', {
      data: Buffer.from(expiredWebhook.payload, 'utf8'),
      failOnStatusCode: false,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': expiredWebhook.signature,
      },
      method: 'POST',
    }),
  ]);
  expect(completedDelivery.status()).toBe(200);
  expect(expiredDelivery.status()).toBe(200);

  const finalRegistration = await database.query.eventRegistrations.findFirst({
    where: { id: registrationId, tenantId: tenant.id },
  });
  const finalTransaction = await database.query.transactions.findFirst({
    where: { id: transactionId, tenantId: tenant.id },
  });
  const finalOption = await database.query.eventRegistrationOptions.findFirst({
    columns: {
      confirmedSpots: true,
      reservedSpots: true,
    },
    where: { id: seeded.scenario.events.paidOpen.optionId },
  });

  expect(finalOption?.reservedSpots).toBe(originalOption?.reservedSpots);
  if (finalRegistration?.status === 'CONFIRMED') {
    expect(finalTransaction?.status).toBe('successful');
    expect(finalTransaction?.stripePaymentIntentId).toBe(paymentIntentId);
    expect(finalOption?.confirmedSpots).toBe(
      (originalOption?.confirmedSpots ?? 0) + 1,
    );
  } else {
    expect(finalRegistration?.status).toBe('CANCELLED');
    expect(finalTransaction?.status).toBe('cancelled');
    expect(finalTransaction?.stripePaymentIntentId).toBeNull();
    expect(finalOption?.confirmedSpots).toBe(originalOption?.confirmedSpots);
  }
});

test('checkout completion rejects a mismatched connected account without mutating payment state @finance @stripe', async ({
  database,
  request,
  seeded,
  tenant,
}) => {
  const registrationId = getId();
  const transactionId = getId();
  const checkoutSessionId = 'cs_test_' + getId();
  const paymentIntentId = 'pi_test_' + getId();
  const stripeEventId = 'evt_test_' + getId();

  await database.insert(schema.eventRegistrations).values({
    eventId: seeded.scenario.events.paidOpen.eventId,
    id: registrationId,
    registrationOptionId: seeded.scenario.events.paidOpen.optionId,
    status: 'PENDING',
    tenantId: tenant.id,
    userId: regularUserId,
  });

  await database.insert(schema.transactions).values({
    amount: 2500,
    comment: 'Webhook connected-account binding test',
    currency: 'EUR',
    eventId: seeded.scenario.events.paidOpen.eventId,
    eventRegistrationId: registrationId,
    executiveUserId: regularUserId,
    id: transactionId,
    method: 'stripe',
    status: 'pending',
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCheckoutUrl: 'https://checkout.stripe.com/c/pay/' + checkoutSessionId,
    targetUserId: regularUserId,
    tenantId: tenant.id,
    type: 'registration',
  });

  const payload = JSON.stringify({
    account: 'acct_foreign',
    api_version: '2024-11-20.acacia',
    created: 1_706_784_000,
    data: {
      object: {
        id: checkoutSessionId,
        metadata: {
          registrationId,
          tenantId: tenant.id,
          transactionId,
        },
        object: 'checkout.session',
        payment_intent: {
          id: paymentIntentId,
          latest_charge: 'ch_test_' + getId(),
        },
        payment_status: 'paid',
        status: 'complete',
      },
    },
    id: stripeEventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: 'checkout.session.completed',
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  const delivery = await request.fetch('/webhooks/stripe', {
    data: Buffer.from(payload, 'utf8'),
    failOnStatusCode: false,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    method: 'POST',
  });

  expect(delivery.status()).toBe(400);
  expect(await delivery.text()).toContain('Invalid checkout session binding');

  const registration = await database.query.eventRegistrations.findFirst({
    where: { id: registrationId, tenantId: tenant.id },
  });
  const transaction = await database.query.transactions.findFirst({
    where: { id: transactionId, tenantId: tenant.id },
  });
  expect(registration?.status).toBe('PENDING');
  expect(transaction?.status).toBe('pending');
  expect(transaction?.stripePaymentIntentId).toBeNull();

  const releasedClaim = await database.query.stripeWebhookEvents.findFirst({
    where: { stripeEventId },
  });
  expect(releasedClaim).toBeUndefined();
});

test('invalid checkout bindings and stale state leave registrations, payments, and capacity unchanged @finance @stripe', async ({
  database,
  request,
  seeded,
  tenant,
}) => {
  const cases = [
    'missing-account',
    'foreign-metadata',
    'conflicting-payment-intent',
    'missing-target-payment-intent',
    'expired-foreign-account',
    'transaction-state-race',
    'registration-state-race',
  ] as const;

  for (const scenario of cases) {
    const registrationId = getId();
    const transactionId = getId();
    const checkoutSessionId = 'cs_test_' + getId();
    const paymentIntentId = 'pi_test_' + getId();
    const stripeEventId = 'evt_test_' + getId();
    const isExpired = scenario === 'expired-foreign-account';
    const isTransactionRace = scenario === 'transaction-state-race';
    const isRegistrationRace = scenario === 'registration-state-race';
    const persistedPaymentIntentId =
      scenario === 'conflicting-payment-intent'
        ? 'pi_persisted_' + getId()
        : undefined;
    const optionBefore =
      await database.query.eventRegistrationOptions.findFirst({
        columns: {
          confirmedSpots: true,
          reservedSpots: true,
        },
        where: { id: seeded.scenario.events.paidOpen.optionId },
      });
    expect(optionBefore).toBeTruthy();

    await database.insert(schema.eventRegistrations).values({
      eventId: seeded.scenario.events.paidOpen.eventId,
      id: registrationId,
      registrationOptionId: seeded.scenario.events.paidOpen.optionId,
      status: isRegistrationRace ? 'CONFIRMED' : 'PENDING',
      tenantId: tenant.id,
      userId: regularUserId,
    });
    await database.insert(schema.transactions).values({
      amount: 2500,
      comment: 'Webhook invalid binding matrix: ' + scenario,
      currency: 'EUR',
      eventId: seeded.scenario.events.paidOpen.eventId,
      eventRegistrationId: registrationId,
      executiveUserId: regularUserId,
      id: transactionId,
      method: 'stripe',
      status: isTransactionRace ? 'successful' : 'pending',
      stripeAccountId,
      stripeCheckoutSessionId: checkoutSessionId,
      stripeCheckoutUrl:
        'https://checkout.stripe.com/c/pay/' + checkoutSessionId,
      ...(persistedPaymentIntentId && {
        stripePaymentIntentId: persistedPaymentIntentId,
      }),
      targetUserId: regularUserId,
      tenantId: tenant.id,
      type: 'registration',
    });

    const metadata =
      scenario === 'foreign-metadata'
        ? {
            registrationId,
            tenantId: tenant.id,
            transactionId: 'transaction-foreign',
          }
        : { registrationId, tenantId: tenant.id, transactionId };
    const paymentIntent =
      scenario === 'missing-target-payment-intent'
        ? paymentIntentId
        : isExpired
          ? undefined
          : {
              id: paymentIntentId,
              latest_charge: 'ch_test_' + getId(),
            };
    const payload = JSON.stringify({
      ...(scenario !== 'missing-account' && {
        account: isExpired ? 'acct_foreign' : stripeAccountId,
      }),
      api_version: '2024-11-20.acacia',
      created: 1_706_784_000,
      data: {
        object: {
          id: checkoutSessionId,
          metadata,
          object: 'checkout.session',
          ...(paymentIntent && { payment_intent: paymentIntent }),
          payment_status: isExpired ? 'unpaid' : 'paid',
          status: isExpired ? 'expired' : 'complete',
        },
      },
      id: stripeEventId,
      livemode: false,
      object: 'event',
      pending_webhooks: 1,
      request: {
        id: null,
        idempotency_key: null,
      },
      type: isExpired
        ? 'checkout.session.expired'
        : 'checkout.session.completed',
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });

    const delivery = await request.fetch('/webhooks/stripe', {
      data: Buffer.from(payload, 'utf8'),
      failOnStatusCode: false,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
      method: 'POST',
    });

    expect(delivery.status(), scenario + ': ' + (await delivery.text())).toBe(
      isTransactionRace || isRegistrationRace ? 409 : 400,
    );

    const registration = await database.query.eventRegistrations.findFirst({
      where: { id: registrationId, tenantId: tenant.id },
    });
    const transaction = await database.query.transactions.findFirst({
      where: { id: transactionId, tenantId: tenant.id },
    });
    const optionAfter = await database.query.eventRegistrationOptions.findFirst(
      {
        columns: {
          confirmedSpots: true,
          reservedSpots: true,
        },
        where: { id: seeded.scenario.events.paidOpen.optionId },
      },
    );
    expect(registration?.status).toBe(
      isRegistrationRace ? 'CONFIRMED' : 'PENDING',
    );
    expect(transaction?.status).toBe(
      isTransactionRace ? 'successful' : 'pending',
    );
    expect(transaction?.stripePaymentIntentId).toBe(
      persistedPaymentIntentId ?? null,
    );
    expect(optionAfter).toEqual(optionBefore);

    const releasedClaim = await database.query.stripeWebhookEvents.findFirst({
      where: { stripeEventId },
    });
    expect(releasedClaim).toBeUndefined();

    await database
      .delete(schema.transactions)
      .where(eq(schema.transactions.id, transactionId));
    await database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.id, registrationId));
  }
});

test('expired checkout webhook resolves the persisted session and releases reserved capacity @finance @stripe', async ({
  database,
  request,
  seeded,
  tenant,
}) => {
  const registrationId = getId();
  const transactionId = getId();
  const checkoutSessionId = `cs_test_${getId()}`;
  const stripeEventId = `evt_test_${getId()}`;
  const originalOption =
    await database.query.eventRegistrationOptions.findFirst({
      columns: {
        confirmedSpots: true,
        reservedSpots: true,
      },
      where: { id: seeded.scenario.events.paidOpen.optionId },
    });
  expect(originalOption).toBeTruthy();

  await database
    .update(schema.eventRegistrationOptions)
    .set({
      reservedSpots: sql`${schema.eventRegistrationOptions.reservedSpots} + 1`,
    })
    .where(
      eq(
        schema.eventRegistrationOptions.id,
        seeded.scenario.events.paidOpen.optionId,
      ),
    );

  await database.insert(schema.eventRegistrations).values({
    eventId: seeded.scenario.events.paidOpen.eventId,
    id: registrationId,
    registrationOptionId: seeded.scenario.events.paidOpen.optionId,
    status: 'PENDING',
    tenantId: tenant.id,
    userId: regularUserId,
  });

  await database.insert(schema.transactions).values({
    amount: 2500,
    comment: 'Webhook expired checkout capacity test',
    currency: 'EUR',
    eventId: seeded.scenario.events.paidOpen.eventId,
    eventRegistrationId: registrationId,
    executiveUserId: regularUserId,
    id: transactionId,
    method: 'stripe',
    status: 'pending',
    stripeAccountId,
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
    targetUserId: regularUserId,
    tenantId: tenant.id,
    type: 'registration',
  });

  const payload = JSON.stringify({
    account: stripeAccountId,
    api_version: '2024-11-20.acacia',
    created: 1_706_784_000,
    data: {
      object: {
        amount_total: 2500,
        currency: 'eur',
        id: checkoutSessionId,
        metadata: {},
        object: 'checkout.session',
        payment_status: 'unpaid',
        status: 'expired',
      },
    },
    id: stripeEventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: 'checkout.session.expired',
  });

  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  const delivery = await request.fetch('/webhooks/stripe', {
    data: Buffer.from(payload, 'utf8'),
    failOnStatusCode: false,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    method: 'POST',
  });
  const body = await delivery.text();
  expect(
    delivery.status(),
    `Expected webhook delivery to return 200, received ${delivery.status()} with body "${body}"`,
  ).toBe(200);

  await expect
    .poll(async () => {
      const updatedRegistration =
        await database.query.eventRegistrations.findFirst({
          where: { id: registrationId, tenantId: tenant.id },
        });
      const updatedTransaction = await database.query.transactions.findFirst({
        where: { id: transactionId, tenantId: tenant.id },
      });
      const updatedOption =
        await database.query.eventRegistrationOptions.findFirst({
          columns: {
            confirmedSpots: true,
            reservedSpots: true,
          },
          where: { id: seeded.scenario.events.paidOpen.optionId },
        });

      return {
        confirmedSpots: updatedOption?.confirmedSpots,
        registrationStatus: updatedRegistration?.status,
        reservedSpots: updatedOption?.reservedSpots,
        transactionStatus: updatedTransaction?.status,
      };
    })
    .toEqual({
      confirmedSpots: originalOption?.confirmedSpots,
      registrationStatus: 'CANCELLED',
      reservedSpots: originalOption?.reservedSpots,
      transactionStatus: 'cancelled',
    });
});

test('duplicate webhook delivery is retryable while the original event claim is still processing @finance @stripe', async ({
  database,
  request,
  tenant,
}) => {
  const registrationId = getId();
  const transactionId = getId();
  const checkoutSessionId = `cs_test_${getId()}`;
  const stripeEventId = `evt_test_${getId()}`;

  await database.insert(schema.stripeWebhookEvents).values({
    eventType: 'checkout.session.completed',
    status: 'processing',
    stripeEventId,
    tenantId: tenant.id,
  });

  const payload = JSON.stringify({
    account: stripeAccountId,
    api_version: '2024-11-20.acacia',
    created: 1_706_784_000,
    data: {
      object: {
        amount_total: 2500,
        currency: 'eur',
        id: checkoutSessionId,
        metadata: {
          registrationId,
          tenantId: tenant.id,
          transactionId,
        },
        object: 'checkout.session',
        payment_intent: `pi_test_${getId()}`,
        payment_status: 'paid',
        status: 'complete',
      },
    },
    id: stripeEventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: 'checkout.session.completed',
  });

  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  const delivery = await request.fetch('/webhooks/stripe', {
    data: Buffer.from(payload, 'utf8'),
    failOnStatusCode: false,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    method: 'POST',
  });

  expect(delivery.status()).toBe(409);
  expect(await delivery.text()).toContain('Event already processing');

  const existingClaim = await database.query.stripeWebhookEvents.findFirst({
    where: { stripeEventId },
  });
  expect(existingClaim?.status).toBe('processing');
});

test('stale webhook claims are reclaimed so Stripe retries can finish processing @finance @stripe', async ({
  database,
  request,
  seeded,
  tenant,
}) => {
  const registrationId = getId();
  const transactionId = getId();
  const checkoutSessionId = `cs_test_${getId()}`;
  const paymentIntentId = `pi_test_${getId()}`;
  const stripeEventId = `evt_test_${getId()}`;

  await database.insert(schema.eventRegistrations).values({
    eventId: seeded.scenario.events.paidOpen.eventId,
    id: registrationId,
    registrationOptionId: seeded.scenario.events.paidOpen.optionId,
    status: 'PENDING',
    tenantId: tenant.id,
    userId: regularUserId,
  });

  await database.insert(schema.transactions).values({
    amount: 2500,
    comment: 'Webhook stale-claim reclaim test',
    currency: 'EUR',
    eventId: seeded.scenario.events.paidOpen.eventId,
    eventRegistrationId: registrationId,
    executiveUserId: regularUserId,
    id: transactionId,
    method: 'stripe',
    status: 'pending',
    stripeAccountId,
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
    targetUserId: regularUserId,
    tenantId: tenant.id,
    type: 'registration',
  });

  await database.insert(schema.stripeWebhookEvents).values({
    eventType: 'checkout.session.completed',
    processedAt: new Date(Date.now() - 10 * 60 * 1000),
    status: 'processing',
    stripeEventId,
    tenantId: tenant.id,
  });

  const payload = JSON.stringify({
    account: stripeAccountId,
    api_version: '2024-11-20.acacia',
    created: 1_706_784_000,
    data: {
      object: {
        amount_total: 2500,
        currency: 'eur',
        id: checkoutSessionId,
        metadata: {
          registrationId,
          tenantId: tenant.id,
          transactionId,
        },
        object: 'checkout.session',
        payment_intent: {
          id: paymentIntentId,
          latest_charge: 'ch_test_' + getId(),
        },
        payment_status: 'paid',
        status: 'complete',
      },
    },
    id: stripeEventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: 'checkout.session.completed',
  });

  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  const delivery = await request.fetch('/webhooks/stripe', {
    data: Buffer.from(payload, 'utf8'),
    failOnStatusCode: false,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    method: 'POST',
  });

  expect(delivery.status()).toBe(200);

  await expect
    .poll(async () => {
      const updatedClaim = await database.query.stripeWebhookEvents.findFirst({
        where: { stripeEventId },
      });
      return updatedClaim?.status;
    })
    .toBe('processed');
});

test('checkout webhook resolves registration by payment intent when metadata is missing @finance @stripe', async ({
  database,
  request,
  seeded,
  tenant,
}) => {
  const registrationId = getId();
  const transactionId = getId();
  const checkoutSessionId = `cs_test_${getId()}`;
  const paymentIntentId = `pi_test_${getId()}`;
  const stripeChargeId = `ch_test_${getId()}`;
  const stripeEventId = `evt_test_${getId()}`;

  await database.insert(schema.eventRegistrations).values({
    eventId: seeded.scenario.events.paidOpen.eventId,
    id: registrationId,
    registrationOptionId: seeded.scenario.events.paidOpen.optionId,
    status: 'PENDING',
    tenantId: tenant.id,
    userId: regularUserId,
  });

  await database.insert(schema.transactions).values({
    amount: 2500,
    comment: 'Webhook payment-intent mapping test',
    currency: 'EUR',
    eventId: seeded.scenario.events.paidOpen.eventId,
    eventRegistrationId: registrationId,
    executiveUserId: regularUserId,
    id: transactionId,
    method: 'stripe',
    status: 'pending',
    stripeAccountId,
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
    stripePaymentIntentId: paymentIntentId,
    targetUserId: regularUserId,
    tenantId: tenant.id,
    type: 'registration',
  });

  const payload = JSON.stringify({
    account: stripeAccountId,
    api_version: '2024-11-20.acacia',
    created: 1_706_784_000,
    data: {
      object: {
        amount_total: 2500,
        currency: 'eur',
        id: checkoutSessionId,
        metadata: {},
        object: 'checkout.session',
        payment_intent: {
          id: paymentIntentId,
          latest_charge: stripeChargeId,
        },
        payment_status: 'paid',
        status: 'complete',
      },
    },
    id: stripeEventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: 'checkout.session.completed',
  });

  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  const delivery = await request.fetch('/webhooks/stripe', {
    data: Buffer.from(payload, 'utf8'),
    failOnStatusCode: false,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    method: 'POST',
  });
  const body = await delivery.text();
  expect(
    delivery.status(),
    `Expected webhook delivery to return 200, received ${delivery.status()} with body "${body}"`,
  ).toBe(200);

  await expect
    .poll(async () => {
      const updatedRegistration =
        await database.query.eventRegistrations.findFirst({
          where: { id: registrationId, tenantId: tenant.id },
        });
      return updatedRegistration?.status;
    })
    .toBe('CONFIRMED');

  await expect
    .poll(async () => {
      const updatedTransaction = await database.query.transactions.findFirst({
        where: { id: transactionId, tenantId: tenant.id },
      });
      return {
        chargeId: updatedTransaction?.stripeChargeId,
        paymentIntentId: updatedTransaction?.stripePaymentIntentId,
        status: updatedTransaction?.status,
      };
    })
    .toEqual({
      chargeId: stripeChargeId,
      paymentIntentId,
      status: 'successful',
    });
});

test('checkout webhook does not confirm unpaid completed sessions @finance @stripe', async ({
  database,
  request,
  seeded,
  tenant,
}) => {
  const registrationId = getId();
  const transactionId = getId();
  const checkoutSessionId = `cs_test_${getId()}`;
  const paymentIntentId = `pi_test_${getId()}`;
  const stripeEventId = `evt_test_${getId()}`;

  await database.insert(schema.eventRegistrations).values({
    eventId: seeded.scenario.events.paidOpen.eventId,
    id: registrationId,
    registrationOptionId: seeded.scenario.events.paidOpen.optionId,
    status: 'PENDING',
    tenantId: tenant.id,
    userId: regularUserId,
  });

  await database.insert(schema.transactions).values({
    amount: 2500,
    comment: 'Webhook unpaid completed session test',
    currency: 'EUR',
    eventId: seeded.scenario.events.paidOpen.eventId,
    eventRegistrationId: registrationId,
    executiveUserId: regularUserId,
    id: transactionId,
    method: 'stripe',
    status: 'pending',
    stripeAccountId,
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
    stripePaymentIntentId: paymentIntentId,
    targetUserId: regularUserId,
    tenantId: tenant.id,
    type: 'registration',
  });

  const payload = JSON.stringify({
    account: stripeAccountId,
    api_version: '2024-11-20.acacia',
    created: 1_706_784_000,
    data: {
      object: {
        id: checkoutSessionId,
        metadata: {
          registrationId,
          tenantId: tenant.id,
          transactionId,
        },
        object: 'checkout.session',
        payment_intent: paymentIntentId,
        payment_status: 'unpaid',
        status: 'complete',
      },
    },
    id: stripeEventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: 'checkout.session.completed',
  });

  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  const delivery = await request.fetch('/webhooks/stripe', {
    data: Buffer.from(payload, 'utf8'),
    failOnStatusCode: false,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    method: 'POST',
  });
  expect(delivery.status()).toBe(200);

  const updatedRegistration = await database.query.eventRegistrations.findFirst(
    {
      where: { id: registrationId, tenantId: tenant.id },
    },
  );
  expect(updatedRegistration?.status).toBe('PENDING');

  const updatedTransaction = await database.query.transactions.findFirst({
    where: { id: transactionId, tenantId: tenant.id },
  });
  expect(updatedTransaction?.status).toBe('pending');
});
