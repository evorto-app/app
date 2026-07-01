import Stripe from 'stripe';
import { eq, sql } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: userStateFile });

const regularUserId =
  usersToAuthenticate.find((user) => user.roles === 'user')?.id ??
  usersToAuthenticate[0].id;
const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';

test.beforeAll(() => {
  expect(
    webhookSecret.length,
    'STRIPE_WEBHOOK_SECRET is required for webhook replay tests',
  ).toBeGreaterThan(0);
});

test('replaying the same Stripe webhook is idempotent @finance @stripe', async ({
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
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
    targetUserId: regularUserId,
    tenantId: tenant.id,
    type: 'registration',
  });

  const payload = JSON.stringify({
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
});

test('expired checkout webhook releases reserved capacity @finance @stripe', async ({
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
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
    targetUserId: regularUserId,
    tenantId: tenant.id,
    type: 'registration',
  });

  const payload = JSON.stringify({
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
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
    stripePaymentIntentId: paymentIntentId,
    targetUserId: regularUserId,
    tenantId: tenant.id,
    type: 'registration',
  });

  const payload = JSON.stringify({
    api_version: '2024-11-20.acacia',
    created: 1_706_784_000,
    data: {
      object: {
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
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
    stripePaymentIntentId: paymentIntentId,
    targetUserId: regularUserId,
    tenantId: tenant.id,
    type: 'registration',
  });

  const payload = JSON.stringify({
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
