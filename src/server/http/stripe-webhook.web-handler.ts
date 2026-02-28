import type Stripe from 'stripe';

import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';

import { Database, type DatabaseClient } from '../../db';
import * as schema from '../../db/schema';
import { getStripeWebhookEnvironment } from '../config/environment';
import { stripe } from '../stripe-client';

const { STRIPE_WEBHOOK_SECRET: endpointSecret } = getStripeWebhookEnvironment();
const MAX_WEBHOOK_SIZE_BYTES = 200 * 1024;

const databaseEffect = <A, E>(
  operation: (database: DatabaseClient) => Effect.Effect<A, E, never>,
) => Database.pipe(Effect.flatMap((database) => operation(database)));

const responseText = (body: string, status = 200): Response =>
  new Response(body, { status });

type SupportedStripeWebhookEventType =
  | 'charge.updated'
  | 'checkout.session.completed'
  | 'checkout.session.expired';

const isSupportedStripeWebhookEventType = (
  eventType: string,
): eventType is SupportedStripeWebhookEventType =>
  eventType === 'charge.updated' ||
  eventType === 'checkout.session.completed' ||
  eventType === 'checkout.session.expired';

const getTenantIdFromWebhookEvent = (
  event: Stripe.Event,
): string | undefined => {
  if (!event.type.startsWith('checkout.session.')) {
    return undefined;
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const tenantId = session.metadata?.['tenantId'];
  return tenantId && tenantId.length > 0 ? tenantId : undefined;
};

const getStripeAccountIdForTenant = (tenantId: string) =>
  databaseEffect((database) =>
    database.query.tenants
      .findFirst({
        columns: { stripeAccountId: true },
        where: { id: tenantId },
      })
      .pipe(Effect.map((tenant) => tenant?.stripeAccountId)),
  );

const claimWebhookEvent = (input: {
  eventId: string;
  eventType: string;
  tenantId?: string;
}) =>
  databaseEffect((database) =>
    Effect.gen(function* () {
      const inserted = yield* database
        .insert(schema.stripeWebhookEvents)
        .values({
          eventType: input.eventType,
          stripeEventId: input.eventId,
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        })
        .onConflictDoNothing()
        .returning({
          stripeEventId: schema.stripeWebhookEvents.stripeEventId,
        });
      return inserted.length > 0;
    }),
  );

const releaseWebhookEventClaim = (eventId: string) =>
  databaseEffect((database) =>
    database
      .delete(schema.stripeWebhookEvents)
      .where(eq(schema.stripeWebhookEvents.stripeEventId, eventId)),
  ).pipe(
    Effect.catchAll((error) =>
      Effect.logWarning('Failed to release webhook claim').pipe(
        Effect.annotateLogs({
          error: error instanceof Error ? error.message : String(error),
          eventId,
        }),
      ),
    ),
    Effect.asVoid,
  );

export const handleStripeWebhookWebRequest = (
  request: Request,
) =>
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

    if (!isSupportedStripeWebhookEventType(event.type)) {
      return responseText('Ignored');
    }

    const tenantId = getTenantIdFromWebhookEvent(event);
    const response = yield* Effect.gen(function* () {
      const claimedEvent = yield* claimWebhookEvent({
        eventId: event.id,
        eventType: event.type,
        ...(tenantId ? { tenantId } : {}),
      });
      if (!claimedEvent) {
        yield* Effect.logInfo('Stripe webhook duplicate event ignored').pipe(
          Effect.annotateLogs({
            eventId: event.id,
            eventType: event.type,
          }),
        );
        return responseText('Duplicate event ignored');
      }

      switch (event.type) {
      case 'charge.updated': {
        const eventCharge = event.data.object;

        const appTransaction = yield* databaseEffect((database) =>
          database.query.transactions.findFirst({
            where: { stripeChargeId: eventCharge.id },
          }),
        );
        if (!appTransaction) {
          return responseText('Transaction not found', 400);
        }

        const stripeAccount = yield* databaseEffect((database) =>
          database.query.tenants
            .findFirst({
              columns: { stripeAccountId: true },
              where: { id: appTransaction.tenantId },
            })
            .pipe(Effect.map((tenant) => tenant?.stripeAccountId)),
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

        yield* databaseEffect((database) =>
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
        if (
          eventSession.status !== 'complete' &&
          eventSession.payment_status !== 'paid'
        ) {
          yield* Effect.logInfo('Skipping checkout.session.completed event').pipe(
            Effect.annotateLogs({
              paymentStatus: eventSession.payment_status ?? 'unknown',
              sessionId: eventSession.id,
              status: eventSession.status ?? 'unknown',
            }),
          );
          return responseText('Session not completed, skipping');
        }

        const stripePaymentIntentId =
          typeof eventSession.payment_intent === 'string'
            ? eventSession.payment_intent
            : eventSession.payment_intent?.id;
        const stripeAccount = yield* getStripeAccountIdForTenant(tenantId);
        if (!stripeAccount) {
          return responseText('Stripe account not found', 400);
        }
        const stripeChargeId = yield* Effect.gen(function* () {
          if (
            typeof eventSession.payment_intent === 'object' &&
            typeof eventSession.payment_intent?.latest_charge === 'string'
          ) {
            return eventSession.payment_intent.latest_charge;
          }
          if (typeof eventSession.payment_intent !== 'string') {
            return undefined;
          }

          const paymentIntent = yield* Effect.tryPromise({
            catch: () => undefined,
            try: () =>
              stripe.paymentIntents.retrieve(
                eventSession.payment_intent,
                {
                  expand: ['latest_charge'],
                },
                {
                  stripeAccount,
                },
              ),
          });
          if (!paymentIntent) {
            return undefined;
          }

          return typeof paymentIntent.latest_charge === 'string'
            ? paymentIntent.latest_charge
            : undefined;
        });

        yield* databaseEffect((database) =>
          database.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(schema.transactions)
                .set({
                  status: 'successful',
                  stripeChargeId,
                  stripePaymentIntentId,
                })
                .where(
                  and(
                    eq(schema.transactions.id, transactionId),
                    eq(schema.transactions.status, 'pending'),
                    eq(schema.transactions.tenantId, tenantId),
                  ),
                );
              yield* tx
                .update(schema.eventRegistrations)
                .set({ status: 'CONFIRMED' })
                .where(
                  and(
                    eq(schema.eventRegistrations.id, registrationId),
                    eq(schema.eventRegistrations.status, 'PENDING'),
                    eq(schema.eventRegistrations.tenantId, tenantId),
                  ),
                );
            }),
          ),
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
        if (eventSession.status !== 'expired') {
          yield* Effect.logInfo('Skipping checkout.session.expired event').pipe(
            Effect.annotateLogs({
              sessionId: eventSession.id,
              status: eventSession.status ?? 'unknown',
            }),
          );
          return responseText('Session not expired, skipping');
        }

        yield* databaseEffect((database) =>
          database.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(schema.transactions)
                .set({ status: 'cancelled' })
                .where(
                  and(
                    eq(schema.transactions.id, transactionId),
                    eq(schema.transactions.status, 'pending'),
                    eq(schema.transactions.tenantId, tenantId),
                  ),
                );
              yield* tx
                .update(schema.eventRegistrations)
                .set({ status: 'CANCELLED' })
                .where(
                  and(
                    eq(schema.eventRegistrations.id, registrationId),
                    eq(schema.eventRegistrations.status, 'PENDING'),
                    eq(schema.eventRegistrations.tenantId, tenantId),
                  ),
                );
            }),
          ),
        );

        return responseText('Success');
      }

      default: {
        return responseText('Ignored');
      }
      }
    }).pipe(
      Effect.catchAllCause((cause) =>
        releaseWebhookEventClaim(event.id).pipe(
          Effect.zipRight(Effect.failCause(cause)),
        ),
      ),
    );

    if (response.status >= 400) {
      yield* releaseWebhookEventClaim(event.id);
    }

    return response;
  });
