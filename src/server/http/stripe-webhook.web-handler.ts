import { eq } from 'drizzle-orm';
import { Effect } from 'effect';

import { database } from '../../db';
import * as schema from '../../db/schema';
import { getStripeWebhookEnvironment } from '../config/environment';
import { stripe } from '../stripe-client';

const { STRIPE_WEBHOOK_SECRET: endpointSecret } = getStripeWebhookEnvironment();
const MAX_WEBHOOK_SIZE_BYTES = 200 * 1024;

const responseText = (body: string, status = 200): Response =>
  new Response(body, { status });

export const handleStripeWebhookWebRequest = (
  request: Request,
): Effect.Effect<Response, unknown> =>
  Effect.gen(function* () {
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return responseText('No signature', 400);
    }

    const rawBody = yield* Effect.promise(() => request.arrayBuffer());
    if (rawBody.byteLength > MAX_WEBHOOK_SIZE_BYTES) {
      return responseText('Payload too large', 413);
    }

    const event = yield* Effect.try({
      catch: (error) => error,
      try: () =>
        stripe.webhooks.constructEvent(
          Buffer.from(rawBody),
          signature,
          endpointSecret,
        ),
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.logError(
            'Stripe webhook signature verification failed',
          ).pipe(
            Effect.annotateLogs({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          return responseText('Webhook signature verification failed', 400);
        }),
      ),
    );
    if (event instanceof Response) {
      return event;
    }

    yield* Effect.logDebug('Stripe webhook event').pipe(
      Effect.annotateLogs({
        eventType: event.type,
      }),
    );

    switch (event.type) {
      case 'charge.updated': {
        const eventCharge = event.data.object;

        const appTransaction = yield* Effect.promise(() =>
          database.query.transactions.findFirst({
            where: { stripeChargeId: eventCharge.id },
          }),
        );
        if (!appTransaction) {
          return responseText('Transaction not found', 400);
        }

        const stripeAccount = yield* Effect.promise(() =>
          database.query.tenants
            .findFirst({
              columns: { stripeAccountId: true },
              where: { id: appTransaction.tenantId },
            })
            .then((tenant) => tenant?.stripeAccountId),
        );

        if (!stripeAccount) {
          return responseText('Stripe account not found', 400);
        }

        const charge = yield* Effect.promise(() =>
          stripe.charges.retrieve(
            eventCharge.id,
            {
              expand: ['balance_transaction'],
            },
            { stripeAccount },
          ),
        );

        const balanceTransaction = charge.balance_transaction;
        if (typeof balanceTransaction !== 'object' || !balanceTransaction) {
          return responseText('Balance transaction not found', 400);
        }

        const appFee =
          balanceTransaction.fee_details.find(
            (fee) => fee.type === 'application_fee',
          )?.amount ?? 0;
        const stripeFee =
          balanceTransaction.fee_details.find(
            (fee) => fee.type === 'stripe_fee',
          )?.amount ?? 0;
        const netValue = balanceTransaction.net;

        yield* Effect.promise(() =>
          database
            .update(schema.transactions)
            .set({
              amount: netValue,
              appFee,
              stripeFee,
            })
            .where(eq(schema.transactions.stripeChargeId, eventCharge.id)),
        );

        return responseText('Success');
      }

      case 'checkout.session.completed': {
        const eventSession = event.data.object;
        const { registrationId, tenantId, transactionId } =
          eventSession.metadata ?? {};
        if (!registrationId || !transactionId || !tenantId) {
          return responseText('Missing metadata', 400);
        }

        const stripeAccount = yield* Effect.promise(() =>
          database.query.tenants
            .findFirst({
              columns: { stripeAccountId: true },
              where: { id: tenantId },
            })
            .then((tenant) => tenant?.stripeAccountId),
        );

        if (!stripeAccount) {
          return responseText('Stripe account not found', 400);
        }

        const session = yield* Effect.promise(() =>
          stripe.checkout.sessions.retrieve(
            eventSession.id,
            { expand: ['payment_intent'] },
            { stripeAccount },
          ),
        );

        if (session.status !== 'complete') {
          yield* Effect.logInfo('Skipping checkout.session.completed event').pipe(
            Effect.annotateLogs({
              sessionId: session.id,
              status: session.status,
            }),
          );
          return responseText('Session not completed, skipping');
        }

        const stripePaymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id;
        const stripeChargeId =
          typeof session.payment_intent === 'object' &&
          typeof session.payment_intent?.latest_charge === 'string'
            ? session.payment_intent.latest_charge
            : undefined;

        yield* Effect.promise(() =>
          database.transaction(async (tx) => {
            await tx
              .update(schema.transactions)
              .set({
                status: 'successful',
                stripeChargeId,
                stripePaymentIntentId,
              })
              .where(eq(schema.transactions.id, transactionId));
            await tx
              .update(schema.eventRegistrations)
              .set({ status: 'CONFIRMED' })
              .where(eq(schema.eventRegistrations.id, registrationId));
          }),
        );

        return responseText('Success');
      }

      case 'checkout.session.expired': {
        const eventSession = event.data.object;
        const { registrationId, tenantId, transactionId } =
          eventSession.metadata ?? {};
        if (!registrationId || !transactionId || !tenantId) {
          return responseText('Missing metadata', 400);
        }

        const stripeAccount = yield* Effect.promise(() =>
          database.query.tenants
            .findFirst({
              columns: { stripeAccountId: true },
              where: { id: tenantId },
            })
            .then((tenant) => tenant?.stripeAccountId),
        );

        if (!stripeAccount) {
          return responseText('Stripe account not found', 400);
        }

        const session = yield* Effect.promise(() =>
          stripe.checkout.sessions.retrieve(eventSession.id, undefined, {
            stripeAccount,
          }),
        );

        if (session.status !== 'expired') {
          yield* Effect.logInfo('Skipping checkout.session.expired event').pipe(
            Effect.annotateLogs({
              sessionId: session.id,
              status: session.status,
            }),
          );
          return responseText('Session not expired, skipping');
        }

        yield* Effect.promise(() =>
          database.transaction(async (tx) => {
            await tx
              .update(schema.transactions)
              .set({ status: 'cancelled' })
              .where(eq(schema.transactions.id, transactionId));
            await tx
              .update(schema.eventRegistrations)
              .set({ status: 'CANCELLED' })
              .where(eq(schema.eventRegistrations.id, registrationId));
          }),
        );

        return responseText('Success');
      }

      default: {
        return responseText('Ignored');
      }
    }
  });
