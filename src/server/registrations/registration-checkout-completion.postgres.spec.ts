import type Stripe from 'stripe';

import { afterAll, beforeAll, describe, expect, it, vi } from '@effect/vitest';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Cause, ConfigProvider, Effect, Exit, Layer, Schema } from 'effect';
import { Pool } from 'pg';

import { databaseLayer } from '../../db';
import { createId } from '../../db/create-id';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import {
  addonToEventRegistrationOptions,
  emailOutbox,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrationQuestions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitions,
  tenants,
  tenantStripeTaxRates,
  transactions,
  users,
  usersToTenants,
} from '../../db/schema';
import { EventRegistrationService } from '../effect/rpc/handlers/events/event-registration.service';
import * as RegistrationRefund from '../payments/registration-refund';
import { StripeClient } from '../stripe-client';
import {
  createRejectingStripeClient,
  stripeBalanceTransactionResponse,
  stripeChargeResponse,
  stripeCheckoutSessionResponse,
  stripePaymentIntentResponse,
} from '../testing/stripe-test-fixtures';
import { completePaidRegistrationCheckout } from './registration-checkout-completion';
import { registrationEligibilityCompensationRefundOperationKey } from './registration-eligibility';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

type TestDatabase = NodePgDatabase<typeof relations>;

const fixtureIdentity = () => ({
  addonId: createId(),
  attendeeId: createId(),
  categoryId: createId(),
  eventId: createId(),
  optionId: createId(),
  organizerId: createId(),
  questionId: createId(),
  templateId: createId(),
  tenantId: createId(),
});

type OwnedFixture = ReturnType<typeof fixtureIdentity>;
const ownedFixtures: OwnedFixture[] = [];
const stripeAccountId = 'acct_completion_questions';

const requireValue = <A>(value: A | null | undefined, label: string): A => {
  if (value === null || value === undefined)
    throw new Error(`Missing ${label}`);
  return value;
};

const makeLayer = (url: string, stripe: Stripe) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        BASE_URL: 'https://completion-questions.example',
        DATABASE_TLS_REQUIRED: 'false',
        DATABASE_URL: url,
        NODE_ENV: 'test',
      },
    }),
  );
  return Layer.mergeAll(
    config,
    databaseLayer.pipe(Layer.provide(config)),
    Layer.succeed(StripeClient, stripe),
  );
};

const seedPendingCheckout = async (database: TestDatabase, answer?: string) => {
  const fixture = fixtureIdentity();
  // Record ownership before the first write, including setup that might fail.
  ownedFixtures.push(fixture);
  const now = Date.now();
  const taxRateId = `txr_${fixture.eventId}`;
  await database.transaction(async (tx) => {
    await tx.insert(tenants).values({
      domain: `${fixture.tenantId}.completion-questions.example`,
      id: fixture.tenantId,
      name: 'Checkout question test',
      stripeAccountId,
    });
    await tx.insert(users).values(
      [fixture.organizerId, fixture.attendeeId].map((id) => ({
        auth0Id: `auth0|${id}`,
        communicationEmail: `${id}.contact@example.com`,
        email: `${id}.login@example.com`,
        firstName: 'Checkout',
        id,
        lastName: 'Questions',
      })),
    );
    await tx
      .insert(usersToTenants)
      .values({ tenantId: fixture.tenantId, userId: fixture.attendeeId });
    await tx.insert(eventTemplateCategories).values({
      icon: { iconColor: 0, iconName: 'circle' },
      id: fixture.categoryId,
      tenantId: fixture.tenantId,
      title: 'Checkout questions',
    });
    await tx.insert(eventTemplates).values({
      categoryId: fixture.categoryId,
      description: 'Checkout questions',
      icon: { iconColor: 0, iconName: 'circle' },
      id: fixture.templateId,
      tenantId: fixture.tenantId,
      title: 'Checkout questions',
    });
    await tx.insert(eventInstances).values({
      creatorId: fixture.organizerId,
      description: 'Checkout questions',
      end: new Date(now + 4 * 60 * 60 * 1000),
      icon: { iconColor: 0, iconName: 'circle' },
      id: fixture.eventId,
      reviewedAt: new Date(now),
      reviewedBy: fixture.organizerId,
      start: new Date(now + 2 * 60 * 60 * 1000),
      status: 'APPROVED',
      templateId: fixture.templateId,
      tenantId: fixture.tenantId,
      title: 'Checkout questions',
    });
    await tx.insert(tenantStripeTaxRates).values({
      active: true,
      displayName: 'Zero tax',
      inclusive: true,
      percentage: '0',
      stripeAccountId,
      stripeTaxRateId: taxRateId,
      tenantId: fixture.tenantId,
    });
    await tx.insert(eventRegistrationOptions).values({
      closeRegistrationTime: new Date(now + 60 * 60 * 1000),
      eventId: fixture.eventId,
      id: fixture.optionId,
      isPaid: true,
      openRegistrationTime: new Date(now - 60 * 60 * 1000),
      organizingRegistration: false,
      price: 100,
      registrationMode: 'application',
      spots: 5,
      stripeTaxRateId: taxRateId,
      title: 'Participant',
    });
    await tx.insert(eventRegistrationQuestions).values({
      eventId: fixture.eventId,
      id: fixture.questionId,
      registrationOptionId: fixture.optionId,
      required: false,
      title: 'Meal preference',
    });
    await tx.insert(eventAddons).values({
      allowMultiple: false,
      allowPurchaseBeforeEvent: false,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      eventId: fixture.eventId,
      id: fixture.addonId,
      isPaid: false,
      maxQuantityPerUser: 1,
      price: 0,
      title: 'Included badge',
      totalAvailableQuantity: 3,
    });
    await tx.insert(addonToEventRegistrationOptions).values({
      addonId: fixture.addonId,
      eventId: fixture.eventId,
      includedQuantity: 1,
      optionalPurchaseQuantity: 0,
      registrationOptionId: fixture.optionId,
    });
  });

  const stripe = createRejectingStripeClient();
  let createdSession: Stripe.Checkout.Session | undefined;
  let applicationFee = 0;
  let grossAmount = 0;
  const sessionId = `cs_${fixture.eventId}`;
  const paymentIntentId = `pi_${fixture.eventId}`;
  const chargeId = `ch_${fixture.eventId}`;
  const create = vi
    .spyOn(stripe.checkout.sessions, 'create')
    .mockImplementation(async (parameters) => {
      const request = requireValue(parameters, 'Checkout create parameters');
      const lineItems = requireValue(request.line_items, 'Checkout line items');
      grossAmount = lineItems.reduce(
        (sum, line) =>
          sum +
          Schema.decodeUnknownSync(Schema.Number)(
            line.price_data?.unit_amount,
          ) *
            Schema.decodeUnknownSync(Schema.Number)(line.quantity),
        0,
      );
      applicationFee = Schema.decodeUnknownSync(Schema.Number)(
        request.payment_intent_data?.application_fee_amount ?? 0,
      );
      const session = stripeCheckoutSessionResponse({
        amount_total: grossAmount,
        cancel_url: Schema.decodeUnknownSync(Schema.String)(request.cancel_url),
        currency: Schema.decodeUnknownSync(Schema.String)(
          lineItems[0]?.price_data?.currency,
        ).toLowerCase(),
        customer_email: Schema.decodeUnknownSync(Schema.String)(
          request.customer_email,
        ),
        expires_at: Schema.decodeUnknownSync(Schema.Number)(request.expires_at),
        id: sessionId,
        metadata: Schema.decodeUnknownSync(
          Schema.Record(Schema.String, Schema.String),
        )(request.metadata),
        payment_intent: null,
        payment_status: 'unpaid',
        status: 'open',
        success_url: Schema.decodeUnknownSync(Schema.String)(
          request.success_url,
        ),
        url: `https://checkout.stripe.com/c/pay/${sessionId}`,
      });
      createdSession = session;
      return session;
    });
  vi.spyOn(stripe.charges, 'retrieve').mockImplementation(
    async (requestedChargeId) => {
      expect(requestedChargeId).toBe(chargeId);
      return stripeChargeResponse({
        amount: grossAmount,
        balance_transaction: stripeBalanceTransactionResponse({
          amount: grossAmount,
          currency: 'eur',
          fee: applicationFee + 3,
          fee_details: [
            {
              amount: applicationFee,
              application: null,
              currency: 'eur',
              description: null,
              type: 'application_fee',
            },
            {
              amount: 3,
              application: null,
              currency: 'eur',
              description: null,
              type: 'stripe_fee',
            },
          ],
          id: `txn_${fixture.eventId}`,
          net: grossAmount - applicationFee - 3,
          source: chargeId,
        }),
        captured: true,
        currency: 'eur',
        id: chargeId,
        paid: true,
        payment_intent: paymentIntentId,
      });
    },
  );
  const layer = makeLayer(databaseUrl, stripe);
  const tenant = requireValue(
    await database.query.tenants.findFirst({ where: { id: fixture.tenantId } }),
    'tenant',
  );
  const targetTenant = {
    ...tenant,
    emailSenderEmail: undefined,
    emailSenderName: undefined,
    stripeAccountId: tenant.stripeAccountId ?? undefined,
  };
  await Effect.runPromise(
    EventRegistrationService.registerForEvent({
      ...(answer !== undefined && {
        answers: [{ answer, questionId: fixture.questionId }],
      }),
      eventId: fixture.eventId,
      guestCount: 0,
      registrationOptionId: fixture.optionId,
      tenant: targetTenant,
      user: {
        email: `${fixture.attendeeId}.login@example.com`,
        id: fixture.attendeeId,
        roleIds: [],
      },
    }).pipe(
      Effect.provide(EventRegistrationService.Default),
      Effect.provide(layer),
    ),
  );
  const registration = requireValue(
    await database.query.eventRegistrations.findFirst({
      where: {
        eventId: fixture.eventId,
        tenantId: fixture.tenantId,
        userId: fixture.attendeeId,
      },
    }),
    'registration',
  );
  await Effect.runPromise(
    EventRegistrationService.approveManualRegistration({
      executiveUserId: fixture.organizerId,
      expectedEventId: fixture.eventId,
      registrationId: registration.id,
      targetTenant,
    }).pipe(
      Effect.provide(EventRegistrationService.Default),
      Effect.provide(layer),
    ),
  );
  const payment = requireValue(
    await database.query.transactions.findFirst({
      where: {
        eventRegistrationId: registration.id,
        tenantId: fixture.tenantId,
        type: 'registration',
      },
    }),
    'registration payment',
  );
  expect(payment.status).toBe('pending');
  expect(payment.stripeCheckoutSessionId).toBe(sessionId);
  expect(create).toHaveBeenCalledTimes(1);
  const paidSession: Stripe.Checkout.Session = {
    ...requireValue(createdSession, 'bound Checkout'),
    payment_intent: stripePaymentIntentResponse({
      amount: payment.amount,
      amount_received: payment.amount,
      currency: 'eur',
      id: paymentIntentId,
      latest_charge: chargeId,
    }),
    payment_status: 'paid',
    status: 'complete',
  };
  return {
    ...fixture,
    applicationFee: requireValue(payment.appFee, 'application fee'),
    create,
    layer,
    paidSession,
    paymentAmount: payment.amount,
    registrationId: registration.id,
    transactionId: payment.id,
  };
};

type PendingCheckout = Awaited<ReturnType<typeof seedPendingCheckout>>;

const complete = (fixture: PendingCheckout) =>
  completePaidRegistrationCheckout(
    {
      registrationId: fixture.registrationId,
      stripeAccountId,
      stripeCheckoutSessionId: fixture.paidSession.id,
      tenantId: fixture.tenantId,
      transactionId: fixture.transactionId,
    },
    fixture.paidSession,
  );

const runCompletionExit = (fixture: PendingCheckout) =>
  Effect.runPromiseExit(
    complete(fixture).pipe(
      Effect.timeout('10 seconds'),
      Effect.provide(fixture.layer),
    ),
  );

const readState = async (database: TestDatabase, fixture: PendingCheckout) => {
  const [registration, option, addon, payments, messages, acquisitions] =
    await Promise.all([
      database.query.eventRegistrations.findFirst({
        where: { id: fixture.registrationId, tenantId: fixture.tenantId },
      }),
      database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: fixture.optionId },
      }),
      database.query.eventAddons.findFirst({
        columns: { totalAvailableQuantity: true },
        where: { id: fixture.addonId },
      }),
      database
        .select({
          amount: transactions.amount,
          appFee: transactions.appFee,
          currency: transactions.currency,
          eventId: transactions.eventId,
          eventRegistrationId: transactions.eventRegistrationId,
          id: transactions.id,
          method: transactions.method,
          refundOperationKey: transactions.refundOperationKey,
          sourceTransactionId: transactions.sourceTransactionId,
          status: transactions.status,
          stripeAccountId: transactions.stripeAccountId,
          stripeChargeId: transactions.stripeChargeId,
          stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
          stripeFee: transactions.stripeFee,
          stripeNetAmount: transactions.stripeNetAmount,
          stripePaymentIntentId: transactions.stripePaymentIntentId,
          stripeRefundApplicationFee: transactions.stripeRefundApplicationFee,
          targetUserId: transactions.targetUserId,
          tenantId: transactions.tenantId,
          type: transactions.type,
        })
        .from(transactions)
        .where(eq(transactions.tenantId, fixture.tenantId))
        .orderBy(asc(transactions.id)),
      database
        .select({
          id: emailOutbox.id,
          idempotencyKey: emailOutbox.idempotencyKey,
          kind: emailOutbox.kind,
          status: emailOutbox.status,
          toEmail: emailOutbox.toEmail,
        })
        .from(emailOutbox)
        .where(eq(emailOutbox.tenantId, fixture.tenantId))
        .orderBy(asc(emailOutbox.id)),
      database
        .select()
        .from(registrationAcquisitions)
        .where(eq(registrationAcquisitions.tenantId, fixture.tenantId))
        .orderBy(asc(registrationAcquisitions.id)),
    ]);
  return { acquisitions, addon, messages, option, payments, registration };
};

const expectCompensated = async (
  database: TestDatabase,
  fixture: PendingCheckout,
) => {
  const state = await readState(database, fixture);
  expect(state.registration).toMatchObject({
    status: 'CANCELLED',
    userId: fixture.attendeeId,
  });
  expect(state.option).toEqual({ confirmedSpots: 0, reservedSpots: 0 });
  expect(state.addon).toEqual({ totalAvailableQuantity: 3 });
  expect(
    state.payments.find((payment) => payment.id === fixture.transactionId),
  ).toMatchObject({
    amount: fixture.paymentAmount,
    appFee: fixture.applicationFee,
    eventId: fixture.eventId,
    eventRegistrationId: fixture.registrationId,
    status: 'successful',
    stripeAccountId,
    stripeCheckoutSessionId: fixture.paidSession.id,
    stripePaymentIntentId: `pi_${fixture.eventId}`,
    targetUserId: fixture.attendeeId,
    tenantId: fixture.tenantId,
  });
  expect(
    state.payments.filter((payment) => payment.type === 'refund'),
  ).toMatchObject([
    {
      amount: -fixture.paymentAmount,
      currency: 'EUR',
      eventId: fixture.eventId,
      eventRegistrationId: fixture.registrationId,
      refundOperationKey: registrationEligibilityCompensationRefundOperationKey(
        fixture.transactionId,
      ),
      sourceTransactionId: fixture.transactionId,
      status: 'pending',
      stripeAccountId,
      stripeRefundApplicationFee: true,
      targetUserId: fixture.attendeeId,
      tenantId: fixture.tenantId,
    },
  ]);
  expect(
    state.messages.filter(
      (message) => message.kind === 'registrationCancelled',
    ),
  ).toMatchObject([
    {
      idempotencyKey: `registration-cancelled/${fixture.tenantId}/${fixture.registrationId}`,
      status: 'queued',
      toEmail: `${fixture.attendeeId}.contact@example.com`,
    },
  ]);
  expect(
    state.messages.filter(
      (message) => message.kind === 'registrationConfirmed',
    ),
  ).toEqual([]);
  expect(state.acquisitions).toEqual([]);
  expect(fixture.create).toHaveBeenCalledTimes(1);
  return state;
};

const cleanFixture = async (database: TestDatabase, fixture: OwnedFixture) => {
  await database
    .delete(emailOutbox)
    .where(eq(emailOutbox.tenantId, fixture.tenantId));
  await database
    .delete(registrationAcquisitionComponents)
    .where(eq(registrationAcquisitionComponents.tenantId, fixture.tenantId));
  await database
    .delete(registrationAcquisitionPayments)
    .where(eq(registrationAcquisitionPayments.tenantId, fixture.tenantId));
  await database
    .delete(registrationAcquisitions)
    .where(eq(registrationAcquisitions.tenantId, fixture.tenantId));
  await database
    .delete(eventRegistrationAddonPurchaseLots)
    .where(eq(eventRegistrationAddonPurchaseLots.tenantId, fixture.tenantId));
  await database
    .delete(eventRegistrationAddonPurchases)
    .where(eq(eventRegistrationAddonPurchases.tenantId, fixture.tenantId));
  await database
    .delete(transactions)
    .where(
      and(
        eq(transactions.tenantId, fixture.tenantId),
        eq(transactions.type, 'refund'),
      ),
    );
  await database
    .delete(transactions)
    .where(eq(transactions.tenantId, fixture.tenantId));
  await database
    .delete(eventRegistrationQuestionAnswers)
    .where(eq(eventRegistrationQuestionAnswers.tenantId, fixture.tenantId));
  await database
    .delete(eventRegistrations)
    .where(eq(eventRegistrations.tenantId, fixture.tenantId));
  await database
    .delete(addonToEventRegistrationOptions)
    .where(eq(addonToEventRegistrationOptions.eventId, fixture.eventId));
  await database
    .delete(eventAddons)
    .where(eq(eventAddons.eventId, fixture.eventId));
  await database
    .delete(eventRegistrationQuestions)
    .where(eq(eventRegistrationQuestions.eventId, fixture.eventId));
  await database
    .delete(eventRegistrationOptions)
    .where(eq(eventRegistrationOptions.eventId, fixture.eventId));
  await database
    .delete(eventInstances)
    .where(eq(eventInstances.id, fixture.eventId));
  await database
    .delete(eventTemplates)
    .where(eq(eventTemplates.id, fixture.templateId));
  await database
    .delete(eventTemplateCategories)
    .where(eq(eventTemplateCategories.id, fixture.categoryId));
  await database
    .delete(tenantStripeTaxRates)
    .where(eq(tenantStripeTaxRates.tenantId, fixture.tenantId));
  await database
    .delete(usersToTenants)
    .where(eq(usersToTenants.tenantId, fixture.tenantId));
  await database
    .delete(users)
    .where(inArray(users.id, [fixture.attendeeId, fixture.organizerId]));
  await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
};

const waitForQuestionWriter = async (pool: Pool, writerPid: number) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ blocked: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database()
          AND $1 = ANY(pg_blocking_pids(pid))
          AND (query ILIKE '%from "tenants"%' OR query ILIKE '%event_instances%')
      ) AS blocked`,
      [writerPid],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    'Completion did not wait for the question writer tenant/event lock',
  );
};

describe('paid registration completion question changes', () => {
  let pool: Pool;
  let database: TestDatabase;
  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const fixture of ownedFixtures.toReversed()) {
      try {
        await cleanFixture(database, fixture);
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await pool.end();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Checkout question fixture cleanup failed',
      );
  });

  it('compensates a newly required missing answer and replays without duplicate releases, refunds or mail', async () => {
    const fixture = await seedPendingCheckout(database);
    const before = await readState(database, fixture);
    expect(before.registration?.status).toBe('PENDING');
    expect(before.option).toEqual({ confirmedSpots: 0, reservedSpots: 1 });
    expect(before.addon).toEqual({ totalAvailableQuantity: 2 });
    await database
      .update(eventRegistrationQuestions)
      .set({ required: true })
      .where(eq(eventRegistrationQuestions.id, fixture.questionId));
    const decoyRegistrationId = createId();
    await database.insert(eventRegistrations).values({
      eventId: fixture.eventId,
      id: decoyRegistrationId,
      registrationOptionId: fixture.optionId,
      status: 'CANCELLED',
      tenantId: fixture.tenantId,
      userId: fixture.organizerId,
    });
    await database.insert(eventRegistrationQuestionAnswers).values({
      answer: 'Another person answered',
      eventId: fixture.eventId,
      questionId: fixture.questionId,
      registrationId: decoyRegistrationId,
      registrationOptionId: fixture.optionId,
      tenantId: fixture.tenantId,
    });
    expect(
      await Effect.runPromise(
        complete(fixture).pipe(Effect.provide(fixture.layer)),
      ),
    ).toBe('compensationQueued');
    const compensated = await expectCompensated(database, fixture);
    expect(
      await Effect.runPromise(
        complete(fixture).pipe(Effect.provide(fixture.layer)),
      ),
    ).toBe('alreadyFinalized');
    expect(await readState(database, fixture)).toEqual(compensated);
  });

  it('confirms valid saved answers while allowing unanswered optional questions', async () => {
    const fixture = await seedPendingCheckout(database, 'Vegetarian');
    await database
      .update(eventRegistrationQuestions)
      .set({ required: true })
      .where(eq(eventRegistrationQuestions.id, fixture.questionId));
    await database.insert(eventRegistrationQuestions).values({
      eventId: fixture.eventId,
      registrationOptionId: fixture.optionId,
      required: false,
      sortOrder: 1,
      title: 'Optional note',
    });
    expect(
      await Effect.runPromise(
        complete(fixture).pipe(Effect.provide(fixture.layer)),
      ),
    ).toBe('finalized');
    const state = await readState(database, fixture);
    expect(state.registration).toMatchObject({
      basePriceAtRegistration: 100,
      discountAmount: 0,
      status: 'CONFIRMED',
    });
    expect(state.option).toEqual({ confirmedSpots: 1, reservedSpots: 0 });
    expect(state.addon).toEqual({ totalAvailableQuantity: 2 });
    expect(state.payments).toMatchObject([
      { id: fixture.transactionId, status: 'successful' },
    ]);
    expect(state.acquisitions).toMatchObject([
      { kind: 'initial', ownerUserId: fixture.attendeeId },
    ]);
    expect(
      state.messages.filter(
        (message) => message.kind === 'registrationConfirmed',
      ),
    ).toHaveLength(1);
    expect(
      state.messages.filter(
        (message) => message.kind === 'registrationCancelled',
      ),
    ).toEqual([]);
  });

  it('does not retroactively invalidate an already confirmed replay after a new required question', async () => {
    const fixture = await seedPendingCheckout(database);
    expect(
      await Effect.runPromise(
        complete(fixture).pipe(Effect.provide(fixture.layer)),
      ),
    ).toBe('finalized');
    const confirmed = await readState(database, fixture);
    await database
      .update(eventRegistrationQuestions)
      .set({ required: true })
      .where(eq(eventRegistrationQuestions.id, fixture.questionId));
    expect(
      await Effect.runPromise(
        complete(fixture).pipe(Effect.provide(fixture.layer)),
      ),
    ).toBe('alreadyCompleted');
    const replayed = await readState(database, fixture);
    expect(replayed.registration).toEqual(confirmed.registration);
    expect(replayed.option).toEqual(confirmed.option);
    expect(replayed.addon).toEqual(confirmed.addon);
    expect(replayed.acquisitions).toEqual(confirmed.acquisitions);
    expect(replayed.messages).toEqual(confirmed.messages);
    expect(replayed.payments).toEqual(confirmed.payments);
    expect(
      replayed.payments.filter((payment) => payment.type === 'refund'),
    ).toEqual([]);
  });

  it('rolls back a compensation write defect and safely compensates on replay', async () => {
    const fixture = await seedPendingCheckout(database);
    await database
      .update(eventRegistrationQuestions)
      .set({ required: true })
      .where(eq(eventRegistrationQuestions.id, fixture.questionId));
    const before = await readState(database, fixture);
    const fault = new Error('Injected failure after refund claim insertion');
    const originalCreateRefundClaim =
      RegistrationRefund.createRegistrationRefundClaim;
    const write = vi
      .spyOn(RegistrationRefund, 'createRegistrationRefundClaim')
      .mockImplementation((...arguments_) =>
        originalCreateRefundClaim(...arguments_).pipe(
          Effect.andThen(Effect.die(fault)),
        ),
      );
    try {
      const exit = await Effect.runPromiseExit(
        complete(fixture).pipe(Effect.provide(fixture.layer)),
      );
      expect(write).toHaveBeenCalledTimes(1);
      if (Exit.isSuccess(exit))
        throw new Error('Compensation must fail when its refund write fails');
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.pretty(exit.cause)).toContain(fault.message);
      expect(await readState(database, fixture)).toEqual(before);
    } finally {
      write.mockRestore();
    }
    expect(
      await Effect.runPromise(
        complete(fixture).pipe(Effect.provide(fixture.layer)),
      ),
    ).toBe('compensationQueued');
    await expectCompensated(database, fixture);
  });

  it('validates the committed question set after waiting for a concurrent question writer', async () => {
    const fixture = await seedPendingCheckout(database);
    const writer = await pool.connect();
    const failures: unknown[] = [];
    let committed = false;
    let discardWriter = false;
    let completionInspected = false;
    let completion: ReturnType<typeof runCompletionExit> | undefined;
    try {
      await writer.query('BEGIN');
      const writerIdentity = await writer.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const pid = requireValue(writerIdentity.rows[0]?.pid, 'writer backend');
      await writer.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [
        fixture.tenantId,
      ]);
      await writer.query(
        'SELECT id FROM event_instances WHERE id = $1 AND "tenantId" = $2 FOR UPDATE',
        [fixture.eventId, fixture.tenantId],
      );
      await writer.query(
        `INSERT INTO event_registration_questions
          (id, "eventId", "registrationOptionId", required, title, "sortOrder")
          VALUES ($1, $2, $3, true, $4, 1)`,
        [createId(), fixture.eventId, fixture.optionId, 'New required answer'],
      );
      completion = runCompletionExit(fixture);
      await waitForQuestionWriter(pool, pid);
      await writer.query('COMMIT');
      committed = true;
      const result = await completion;
      completionInspected = true;
      expect(result).toMatchObject({
        _tag: 'Success',
        value: 'compensationQueued',
      });
      await expectCompensated(database, fixture);
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        if (!committed) await writer.query('ROLLBACK');
      } catch (error) {
        discardWriter = true;
        failures.push(error);
      }
      try {
        writer.release(discardWriter);
      } catch (error) {
        failures.push(error);
      }
      try {
        if (completion) {
          const settled = await completion;
          if (!completionInspected && Exit.isFailure(settled)) {
            failures.push(Cause.squash(settled.cause));
          }
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'Question writer test and cleanup failures',
      );
    }
  }, 15_000);
});
