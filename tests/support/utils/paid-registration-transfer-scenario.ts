import type Stripe from 'stripe';

import { createId } from '@db/create-id';
import { Database, databaseLayer } from '@db/index';
import { relations } from '@db/relations';
import * as schema from '@db/schema';
import { completePaidRegistrationCheckout } from '@server/registrations/registration-checkout-completion';
import {
  markRegistrationTransferRefundRequeued,
  reconcileRegistrationTransferRefund,
} from '@server/registrations/registration-transfer-refund-reconciliation';
import { createRegistrationTransferCredentials } from '@server/registrations/registration-transfer-credentials';
import {
  type RegistrationRefundRequeueState,
  requeueRegistrationRefundClaim,
} from '@server/payments/registration-refund';
import { deriveTenantPublicOrigin } from '@shared/tenant-origin';
import { and, eq, like } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';

import {
  futureServerEventWindow,
  latestServerOrWallNow,
} from './server-test-clock';

const sourcePrice = 1800;
const recipientPrice = 2100;
const recipientApplicationFee = 150;

type TestDatabase = NodePgDatabase<typeof relations>;

interface PaidRegistrationTransferScenarioInput {
  readonly database: TestDatabase;
  readonly recipient: {
    readonly communicationEmail?: null | string;
    readonly email: string;
    readonly id: string;
  };
  readonly source: {
    readonly id: string;
  };
  readonly templateId: string;
  readonly tenant: {
    readonly domain: string;
    readonly id: string;
  };
  readonly title: string;
}

export interface PaidRegistrationTransferScenario {
  readonly claimPath: string;
  readonly eventId: string;
  readonly optionId: string;
  readonly recipientRegistrationId: string;
  readonly recipientTransactionId: string;
  readonly sourceRegistrationId: string;
  readonly sourceTransactionId: string;
  readonly stripeAccountId: string;
  readonly transferId: string;
  completeCheckout: () => Promise<
    'alreadyCompleted' | 'alreadyFinalized' | 'compensationQueued' | 'finalized'
  >;
  failSourceRefund: () => Promise<string>;
  requeueSourceRefund: () => Promise<{
    readonly refundAfter: RegistrationRefundRequeueState;
    readonly recoveryMode: 'newGeneration' | 'resumeGeneration';
    readonly transferStatus: 'alreadyPending' | 'notTransfer' | 'requeued';
  }>;
  cleanup: () => Promise<void>;
}

const effectDatabaseLayer = databaseLayer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
);

const runDatabaseEffect = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromise(effect.pipe(Effect.provide(effectDatabaseLayer)));

export const seedPaidRegistrationTransferScenario = async (
  input: PaidRegistrationTransferScenarioInput,
): Promise<PaidRegistrationTransferScenario> => {
  const eventId = createId();
  const optionId = createId();
  const recipientRegistrationId = createId();
  const recipientTransactionId = createId();
  const sourceRegistrationId = createId();
  const sourceTransactionId = createId();
  const transferId = createId();
  const credentials = createRegistrationTransferCredentials();
  const stripeAccountId = `acct_transfer_${transferId}`;
  const checkoutSessionId = `cs_test_transfer_${recipientTransactionId}`;
  const paymentIntentId = `pi_transfer_${recipientTransactionId}`;
  const chargeId = `ch_transfer_${recipientTransactionId}`;
  const sourceChargeId = `ch_transfer_source_${sourceTransactionId}`;
  const terminalRefundId = `re_transfer_${sourceTransactionId}`;
  const eventWindow = futureServerEventWindow();
  const startsAt = eventWindow.start;
  const checkoutExpiresAt = new Date(
    latestServerOrWallNow().getTime() + 60 * 60 * 1000,
  );
  const originalTenant = await input.database.query.tenants.findFirst({
    columns: { stripeAccountId: true },
    where: { id: input.tenant.id },
  });
  if (!originalTenant) {
    throw new Error('Expected paid transfer scenario tenant');
  }

  await input.database
    .update(schema.tenants)
    .set({ stripeAccountId })
    .where(eq(schema.tenants.id, input.tenant.id));
  await input.database.insert(schema.eventInstances).values({
    creatorId: input.source.id,
    description: 'Deterministic paid transfer lifecycle scenario',
    end: eventWindow.end,
    icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
    id: eventId,
    start: startsAt,
    status: 'APPROVED',
    templateId: input.templateId,
    tenantId: input.tenant.id,
    title: input.title,
    unlisted: true,
  });
  await input.database.insert(schema.eventRegistrationOptions).values({
    closeRegistrationTime: eventWindow.closeRegistrationTime,
    confirmedSpots: 1,
    eventId,
    id: optionId,
    isPaid: true,
    openRegistrationTime: eventWindow.openRegistrationTime,
    organizingRegistration: false,
    price: recipientPrice,
    refundFeesOnCancellation: true,
    registeredDescription: 'Your transferred registration is confirmed.',
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 10,
    title: 'Paid participant',
    transferDeadlineHoursBeforeStart: 0,
  });
  await input.database.insert(schema.eventRegistrations).values([
    {
      basePriceAtRegistration: sourcePrice,
      eventId,
      id: sourceRegistrationId,
      registrationOptionId: optionId,
      status: 'CONFIRMED',
      tenantId: input.tenant.id,
      userId: input.source.id,
    },
    {
      basePriceAtRegistration: recipientPrice,
      eventId,
      id: recipientRegistrationId,
      registrationOptionId: optionId,
      status: 'PENDING',
      tenantId: input.tenant.id,
      userId: input.recipient.id,
    },
  ]);
  await input.database.insert(schema.transactions).values([
    {
      amount: sourcePrice,
      appFee: 100,
      currency: 'EUR',
      eventId,
      eventRegistrationId: sourceRegistrationId,
      id: sourceTransactionId,
      method: 'stripe',
      status: 'successful',
      stripeAccountId,
      stripeChargeId: sourceChargeId,
      targetUserId: input.source.id,
      tenantId: input.tenant.id,
      type: 'registration',
    },
    {
      amount: recipientPrice,
      appFee: recipientApplicationFee,
      currency: 'EUR',
      eventId,
      eventRegistrationId: recipientRegistrationId,
      id: recipientTransactionId,
      method: 'stripe',
      status: 'pending',
      stripeAccountId,
      stripeCheckoutReconcileNextAt: checkoutExpiresAt,
      stripeCheckoutRequest: {
        customerEmail: input.recipient.email,
        eventTitle: input.title,
        eventUrl: new URL(
          `/events/${encodeURIComponent(eventId)}`,
          deriveTenantPublicOrigin(input.tenant.domain),
        ).toString(),
        expiresAt: Math.floor(checkoutExpiresAt.getTime() / 1000),
        lineItems: [
          {
            name: 'Paid participant',
            quantity: 1,
            unitAmount: recipientPrice,
          },
        ],
        notificationEmail:
          input.recipient.communicationEmail?.trim() || input.recipient.email,
      },
      stripeCheckoutSessionId: checkoutSessionId,
      stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
      targetUserId: input.recipient.id,
      tenantId: input.tenant.id,
      type: 'registration',
    },
  ]);
  await input.database.insert(schema.registrationTransfers).values({
    claimCodeHash: credentials.claimCodeHash,
    claimTokenHash: credentials.claimTokenHash,
    eventId,
    expiresAt: checkoutExpiresAt,
    id: transferId,
    recipientCheckoutTransactionId: recipientTransactionId,
    recipientRegistrationId,
    recipientSpotCount: 1,
    recipientUserId: input.recipient.id,
    registrationOptionId: optionId,
    reservedAdditionalSpots: 0,
    sourcePaymentTransactionId: sourceTransactionId,
    sourceRefundAmount: sourcePrice,
    sourceRefundApplicationFee: true,
    sourceRegistrationId,
    sourceSpotCount: 1,
    sourceUserId: input.source.id,
    status: 'checkout_pending',
    tenantId: input.tenant.id,
  });
  await input.database.insert(schema.registrationTransferEvents).values([
    {
      actorUserId: input.source.id,
      eventType: 'created',
      tenantId: input.tenant.id,
      toStatus: 'open',
      transferId,
    },
    {
      actorUserId: input.recipient.id,
      eventType: 'claimed',
      fromStatus: 'open',
      tenantId: input.tenant.id,
      toStatus: 'checkout_pending',
      transferId,
    },
    {
      actorUserId: input.recipient.id,
      eventType: 'checkout_started',
      fromStatus: 'open',
      tenantId: input.tenant.id,
      toStatus: 'checkout_pending',
      transferId,
    },
  ]);

  const completeCheckout = () => {
    const session = {
      amount_total: recipientPrice,
      currency: 'eur',
      id: checkoutSessionId,
      metadata: {
        registrationId: recipientRegistrationId,
        tenantId: input.tenant.id,
        transactionId: recipientTransactionId,
        transferId,
      },
      payment_intent: {
        id: paymentIntentId,
        latest_charge: chargeId,
      },
      payment_status: 'paid',
      status: 'complete',
    } as Stripe.Checkout.Session;
    return runDatabaseEffect(
      completePaidRegistrationCheckout(
        {
          registrationId: recipientRegistrationId,
          stripeAccountId,
          stripeCheckoutSessionId: checkoutSessionId,
          tenantId: input.tenant.id,
          transactionId: recipientTransactionId,
        },
        session,
      ),
    );
  };

  const failSourceRefund = async () => {
    const transfer = await input.database.query.registrationTransfers.findFirst(
      {
        columns: { refundTransactionId: true },
        where: { id: transferId, tenantId: input.tenant.id },
      },
    );
    if (!transfer?.refundTransactionId) {
      throw new Error('Expected a persisted source refund claim');
    }
    await input.database
      .update(schema.transactions)
      .set({
        stripeRefundAttempts: 8,
        stripeRefundId: terminalRefundId,
        stripeRefundLastError: 'Deterministic terminal Stripe refund failure',
        stripeRefundNextAttemptAt: null,
        stripeRefundStatus: 'failed',
      })
      .where(
        and(
          eq(schema.transactions.id, transfer.refundTransactionId),
          eq(schema.transactions.tenantId, input.tenant.id),
          eq(schema.transactions.type, 'refund'),
        ),
      );
    await runDatabaseEffect(
      Database.use((database) =>
        database.transaction((tx) =>
          reconcileRegistrationTransferRefund(tx, {
            refundTransactionId: transfer.refundTransactionId!,
            stripeRefundStatus: 'failed',
          }),
        ),
      ),
    );
    return transfer.refundTransactionId;
  };

  const requeueSourceRefund = async () => {
    const transfer = await input.database.query.registrationTransfers.findFirst(
      {
        columns: { refundTransactionId: true },
        where: { id: transferId, tenantId: input.tenant.id },
      },
    );
    if (!transfer?.refundTransactionId) {
      throw new Error('Expected a source refund claim for operator requeue');
    }
    return runDatabaseEffect(
      Database.use((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            const recovery = yield* requeueRegistrationRefundClaim(tx, {
              reason: 'Playwright verifies deterministic refund recovery',
              refundClaimId: transfer.refundTransactionId!,
              tenantId: input.tenant.id,
            });
            const transferStatus =
              yield* markRegistrationTransferRefundRequeued(tx, {
                reason: recovery.reason,
                refundTransactionId: transfer.refundTransactionId!,
                tenantId: input.tenant.id,
              });
            return {
              refundAfter: recovery.after,
              recoveryMode: recovery.mode,
              transferStatus,
            };
          }),
        ),
      ),
    );
  };

  const cleanup = async () => {
    await input.database
      .delete(schema.emailOutbox)
      .where(
        like(
          schema.emailOutbox.idempotencyKey,
          `registration-transferred/${input.tenant.id}/${recipientRegistrationId}/%`,
        ),
      );
    await input.database
      .delete(schema.registrationTransfers)
      .where(eq(schema.registrationTransfers.id, transferId));
    await input.database
      .delete(schema.transactions)
      .where(eq(schema.transactions.eventId, eventId));
    await input.database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.eventId, eventId));
    await input.database
      .delete(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.id, optionId));
    await input.database
      .delete(schema.eventInstances)
      .where(eq(schema.eventInstances.id, eventId));
    await input.database
      .update(schema.tenants)
      .set({ stripeAccountId: originalTenant.stripeAccountId })
      .where(eq(schema.tenants.id, input.tenant.id));
  };

  return {
    claimPath: `/registration-transfers/${credentials.claimToken}`,
    cleanup,
    completeCheckout,
    eventId,
    failSourceRefund,
    optionId,
    recipientRegistrationId,
    recipientTransactionId,
    requeueSourceRefund,
    sourceRegistrationId,
    sourceTransactionId,
    stripeAccountId,
    transferId,
  };
};
