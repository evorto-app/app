import type Stripe from 'stripe';

import { registrationSpotCount } from '@shared/registration-spots';
import { and, eq, lte, sql } from 'drizzle-orm';
import { Effect } from 'effect';

import { Database, type DatabaseClient } from '../../db';
import * as schema from '../../db/schema';
import { stripeWebhookConfig } from '../config/stripe-config';
import {
  buildRegistrationConfirmedEmailNotification,
  notificationEmailForUser,
} from '../effect/rpc/handlers/events/registration-email-notifications';
import { StripeClient } from '../stripe-client';
const MAX_WEBHOOK_SIZE_BYTES = 200 * 1024;
const STALE_WEBHOOK_CLAIM_AGE_MS = 5 * 60 * 1000;

const databaseEffect = <A, E>(
  operation: (database: DatabaseClient) => Effect.Effect<A, E, never>,
) => Database.use((database) => operation(database));

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

const getCheckoutSessionPaymentIntentId = (
  session: Stripe.Checkout.Session,
): string | undefined =>
  typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;

const getLatestChargeId = (
  paymentIntent:
    | null
    | string
    | {
        latest_charge?: null | string | { id?: string | undefined };
      },
): string | undefined => {
  if (!paymentIntent || typeof paymentIntent === 'string') {
    return undefined;
  }

  const latestCharge = paymentIntent.latest_charge;
  if (typeof latestCharge === 'string') {
    return latestCharge;
  }

  return latestCharge?.id;
};

const resolveCheckoutSession = (eventSession: Stripe.Checkout.Session) =>
  databaseEffect((database) =>
    Effect.gen(function* () {
      const metadata = eventSession.metadata ?? {};
      const metadataRegistrationId = metadata['registrationId'];
      const metadataTenantId = metadata['tenantId'];
      const metadataTransactionId = metadata['transactionId'];
      const hasCompleteMetadata =
        Boolean(metadataRegistrationId) &&
        Boolean(metadataTenantId) &&
        Boolean(metadataTransactionId);

      const paymentIntentId = getCheckoutSessionPaymentIntentId(eventSession);
      const paymentIntentTransaction = paymentIntentId
        ? yield* database.query.transactions.findFirst({
            columns: {
              eventRegistrationId: true,
              id: true,
              tenantId: true,
            },
            where: { stripePaymentIntentId: paymentIntentId },
          })
        : undefined;
      const checkoutSessionTransaction =
        !paymentIntentTransaction && eventSession.id
          ? yield* database.query.transactions.findFirst({
              columns: {
                eventRegistrationId: true,
                id: true,
                tenantId: true,
              },
              where: { stripeCheckoutSessionId: eventSession.id },
            })
          : undefined;
      const existingTransaction =
        paymentIntentTransaction ?? checkoutSessionTransaction;

      if (hasCompleteMetadata) {
        if (
          existingTransaction &&
          (existingTransaction.id !== metadataTransactionId ||
            existingTransaction.tenantId !== metadataTenantId ||
            existingTransaction.eventRegistrationId !== metadataRegistrationId)
        ) {
          return { type: 'mapping-conflict' } as const;
        }

        return {
          registrationId: metadataRegistrationId,
          tenantId: metadataTenantId,
          transactionId: metadataTransactionId,
          type: 'resolved',
        } as const;
      }

      if (
        checkoutSessionTransaction?.eventRegistrationId &&
        checkoutSessionTransaction.id &&
        checkoutSessionTransaction.tenantId
      ) {
        return {
          registrationId: checkoutSessionTransaction.eventRegistrationId,
          tenantId: checkoutSessionTransaction.tenantId,
          transactionId: checkoutSessionTransaction.id,
          type: 'resolved',
        } as const;
      }

      if (
        paymentIntentTransaction?.eventRegistrationId &&
        paymentIntentTransaction.id &&
        paymentIntentTransaction.tenantId
      ) {
        return {
          registrationId: paymentIntentTransaction.eventRegistrationId,
          tenantId: paymentIntentTransaction.tenantId,
          transactionId: paymentIntentTransaction.id,
          type: 'resolved',
        } as const;
      }

      return { type: 'unresolved' } as const;
    }),
  );

const isStripeMissingResourceError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    raw?: { code?: unknown };
    type?: unknown;
  };
  return (
    candidate.type === 'StripeInvalidRequestError' &&
    (candidate.code === 'resource_missing' ||
      candidate.raw?.code === 'resource_missing')
  );
};

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
          status: schema.stripeWebhookEvents.status,
          stripeEventId: schema.stripeWebhookEvents.stripeEventId,
        });
      if (inserted.length > 0) {
        return { type: 'claimed' } as const;
      }

      const existingEvent = yield* database.query.stripeWebhookEvents.findFirst(
        {
          columns: { processedAt: true, status: true },
          where: { stripeEventId: input.eventId },
        },
      );
      if (!existingEvent) {
        return { type: 'missing' } as const;
      }

      const reclaimedAt = new Date();
      const staleBefore = new Date(
        reclaimedAt.getTime() - STALE_WEBHOOK_CLAIM_AGE_MS,
      );
      if (
        existingEvent.status === 'processing' &&
        existingEvent.processedAt <= staleBefore
      ) {
        const reclaimed = yield* database
          .update(schema.stripeWebhookEvents)
          .set({
            eventType: input.eventType,
            processedAt: reclaimedAt,
            ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          })
          .where(
            and(
              eq(schema.stripeWebhookEvents.stripeEventId, input.eventId),
              eq(schema.stripeWebhookEvents.status, 'processing'),
              lte(schema.stripeWebhookEvents.processedAt, staleBefore),
            ),
          )
          .returning({
            stripeEventId: schema.stripeWebhookEvents.stripeEventId,
          });
        if (reclaimed.length > 0) {
          return { type: 'claimed' } as const;
        }
      }

      return existingEvent.status === 'processed'
        ? ({ type: 'duplicate-processed' } as const)
        : ({ type: 'duplicate-processing' } as const);
    }),
  );

const releaseWebhookEventClaim = (eventId: string) =>
  databaseEffect((database) =>
    database
      .delete(schema.stripeWebhookEvents)
      .where(eq(schema.stripeWebhookEvents.stripeEventId, eventId)),
  ).pipe(
    Effect.tapError((error) =>
      Effect.logWarning('Failed to release webhook claim').pipe(
        Effect.annotateLogs({
          error: error instanceof Error ? error.message : String(error),
          eventId,
        }),
      ),
    ),
    Effect.asVoid,
  );

const markWebhookEventProcessed = (eventId: string) =>
  databaseEffect((database) =>
    database
      .update(schema.stripeWebhookEvents)
      .set({ processedAt: new Date(), status: 'processed' })
      .where(eq(schema.stripeWebhookEvents.stripeEventId, eventId)),
  ).pipe(Effect.asVoid);

export const handleStripeWebhookWebRequest = (request: Request) =>
  Effect.gen(function* () {
    const stripe = yield* StripeClient;
    const { STRIPE_WEBHOOK_SECRET: endpointSecret } =
      yield* stripeWebhookConfig;
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return responseText('No signature', 400);
    }

    const rawBody = yield* Effect.promise(() => request.arrayBuffer());
    if (rawBody.byteLength > MAX_WEBHOOK_SIZE_BYTES) {
      return responseText('Payload too large', 413);
    }

    const event = yield* Effect.sync(() =>
      stripe.webhooks.constructEvent(
        Buffer.from(rawBody),
        signature,
        endpointSecret,
      ),
    ).pipe(
      Effect.catchDefect((error) =>
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
    let ownsClaim = false;
    const response = yield* Effect.gen(function* () {
      const claimedEvent = yield* claimWebhookEvent({
        eventId: event.id,
        eventType: event.type,
        ...(tenantId ? { tenantId } : {}),
      });
      if (claimedEvent.type === 'duplicate-processing') {
        yield* Effect.logWarning(
          'Stripe webhook event is already processing',
        ).pipe(
          Effect.annotateLogs({
            eventId: event.id,
            eventType: event.type,
          }),
        );
        return responseText('Event already processing', 409);
      }
      if (claimedEvent.type === 'duplicate-processed') {
        yield* Effect.logInfo('Stripe webhook duplicate event ignored').pipe(
          Effect.annotateLogs({
            eventId: event.id,
            eventType: event.type,
          }),
        );
        return responseText('Duplicate event ignored');
      }
      if (claimedEvent.type === 'missing') {
        return responseText('Webhook claim missing', 409);
      }
      ownsClaim = true;

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
          if (
            eventSession.status !== 'complete' ||
            eventSession.payment_status !== 'paid'
          ) {
            yield* Effect.logInfo(
              'Skipping checkout.session.completed event',
            ).pipe(
              Effect.annotateLogs({
                paymentStatus: eventSession.payment_status ?? 'unknown',
                sessionId: eventSession.id,
                status: eventSession.status ?? 'unknown',
              }),
            );
            return responseText('Session not paid and completed, skipping');
          }

          const checkoutSession = yield* resolveCheckoutSession(eventSession);
          if (checkoutSession.type === 'mapping-conflict') {
            return responseText('Conflicting checkout session mapping', 400);
          }
          if (checkoutSession.type === 'unresolved') {
            return responseText('Missing checkout session mapping', 400);
          }

          const { registrationId, tenantId, transactionId } = checkoutSession;
          const stripePaymentIntentId =
            getCheckoutSessionPaymentIntentId(eventSession);
          const stripeAccount = yield* getStripeAccountIdForTenant(tenantId);
          if (!stripeAccount) {
            return responseText('Stripe account not found', 400);
          }
          const stripeChargeId = yield* Effect.gen(function* () {
            const paymentIntentField = eventSession.payment_intent;
            const inlineChargeId = getLatestChargeId(paymentIntentField);
            if (inlineChargeId) {
              return inlineChargeId;
            }
            if (typeof paymentIntentField !== 'string') {
              return;
            }

            const paymentIntent = yield* Effect.promise(() =>
              stripe.paymentIntents.retrieve(
                paymentIntentField,
                {
                  expand: ['latest_charge'],
                },
                {
                  stripeAccount,
                },
              ),
            ).pipe(
              Effect.catchDefect((error) => {
                if (isStripeMissingResourceError(error)) {
                  return Effect.logWarning(
                    'Stripe payment intent missing during checkout completion',
                  ).pipe(
                    Effect.annotateLogs({
                      paymentIntentId: paymentIntentField,
                      sessionId: eventSession.id,
                      tenantId,
                    }),
                    Effect.andThen(
                      Effect.succeed<null | Stripe.Response<Stripe.PaymentIntent>>(
                        null,
                      ),
                    ),
                  );
                }
                return Effect.fail(error);
              }),
            );

            if (!paymentIntent) return;

            return getLatestChargeId(paymentIntent);
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
                const updatedRegistrations = yield* tx
                  .update(schema.eventRegistrations)
                  .set({ status: 'CONFIRMED' })
                  .where(
                    and(
                      eq(schema.eventRegistrations.id, registrationId),
                      eq(schema.eventRegistrations.status, 'PENDING'),
                      eq(schema.eventRegistrations.tenantId, tenantId),
                    ),
                  )
                  .returning({
                    eventId: schema.eventRegistrations.eventId,
                    guestCount: schema.eventRegistrations.guestCount,
                    registrationOptionId:
                      schema.eventRegistrations.registrationOptionId,
                    userId: schema.eventRegistrations.userId,
                  });
                const updatedRegistration = updatedRegistrations[0];
                if (!updatedRegistration) {
                  return;
                }
                const registeredSpotCount = registrationSpotCount(
                  updatedRegistration.guestCount,
                );

                const transferIntent =
                  yield* tx.query.registrationTransferIntents.findFirst({
                    columns: {
                      id: true,
                      sourceRegistrationId: true,
                    },
                    where: {
                      replacementRegistrationId: registrationId,
                      status: 'pending',
                      tenantId,
                    },
                  });

                if (transferIntent) {
                  yield* tx
                    .update(schema.eventRegistrations)
                    .set({ status: 'CANCELLED' })
                    .where(
                      and(
                        eq(
                          schema.eventRegistrations.id,
                          transferIntent.sourceRegistrationId,
                        ),
                        eq(schema.eventRegistrations.status, 'CONFIRMED'),
                        eq(schema.eventRegistrations.tenantId, tenantId),
                      ),
                    );
                  yield* tx
                    .update(schema.registrationTransferIntents)
                    .set({ status: 'completed' })
                    .where(
                      and(
                        eq(
                          schema.registrationTransferIntents.id,
                          transferIntent.id,
                        ),
                        eq(
                          schema.registrationTransferIntents.status,
                          'pending',
                        ),
                        eq(
                          schema.registrationTransferIntents.tenantId,
                          tenantId,
                        ),
                      ),
                    );
                } else {
                  yield* tx
                    .update(schema.eventRegistrationOptions)
                    .set({
                      confirmedSpots: sql`${schema.eventRegistrationOptions.confirmedSpots} + ${registeredSpotCount}`,
                      reservedSpots: sql`GREATEST(${schema.eventRegistrationOptions.reservedSpots} - ${registeredSpotCount}, 0)`,
                    })
                    .where(
                      and(
                        eq(
                          schema.eventRegistrationOptions.id,
                          updatedRegistration.registrationOptionId,
                        ),
                        eq(
                          schema.eventRegistrationOptions.eventId,
                          updatedRegistration.eventId,
                        ),
                      ),
                    );
                }

                const [event, tenant, user] = yield* Effect.all([
                  tx.query.eventInstances.findFirst({
                    columns: {
                      title: true,
                    },
                    where: {
                      id: updatedRegistration.eventId,
                      tenantId,
                    },
                  }),
                  tx.query.tenants.findFirst({
                    columns: {
                      name: true,
                    },
                    where: {
                      id: tenantId,
                    },
                  }),
                  tx.query.users.findFirst({
                    columns: {
                      communicationEmail: true,
                      email: true,
                      firstName: true,
                      id: true,
                    },
                    where: {
                      id: updatedRegistration.userId,
                    },
                  }),
                ]);

                if (event && tenant && user) {
                  const notification =
                    buildRegistrationConfirmedEmailNotification({
                      eventTitle: event.title,
                      recipientFirstName: user.firstName,
                      registrationId,
                      tenantName: tenant.name,
                    });

                  yield* tx.insert(schema.emailNotificationOutbox).values({
                    kind: 'registrationConfirmed',
                    payload: {
                      ...notification.payload,
                      eventId: updatedRegistration.eventId,
                    },
                    recipientEmail: notificationEmailForUser(user),
                    recipientUserId: user.id,
                    subject: notification.subject,
                    tenantId,
                    textBody: notification.textBody,
                  });
                }
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
            yield* Effect.logInfo(
              'Skipping checkout.session.expired event',
            ).pipe(
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
                const updatedRegistrations = yield* tx
                  .update(schema.eventRegistrations)
                  .set({ status: 'CANCELLED' })
                  .where(
                    and(
                      eq(schema.eventRegistrations.id, registrationId),
                      eq(schema.eventRegistrations.status, 'PENDING'),
                      eq(schema.eventRegistrations.tenantId, tenantId),
                    ),
                  )
                  .returning({
                    eventId: schema.eventRegistrations.eventId,
                    guestCount: schema.eventRegistrations.guestCount,
                    registrationOptionId:
                      schema.eventRegistrations.registrationOptionId,
                  });
                const updatedRegistration = updatedRegistrations[0];
                if (!updatedRegistration) {
                  return;
                }
                const registeredSpotCount = registrationSpotCount(
                  updatedRegistration.guestCount,
                );

                yield* tx
                  .update(schema.eventRegistrationOptions)
                  .set({
                    reservedSpots: sql`GREATEST(${schema.eventRegistrationOptions.reservedSpots} - ${registeredSpotCount}, 0)`,
                  })
                  .where(
                    and(
                      eq(
                        schema.eventRegistrationOptions.id,
                        updatedRegistration.registrationOptionId,
                      ),
                      eq(
                        schema.eventRegistrationOptions.eventId,
                        updatedRegistration.eventId,
                      ),
                    ),
                  );

                const addOnPurchases = yield* tx
                  .select({
                    addonId: schema.eventRegistrationAddonPurchases.addonId,
                    quantity: schema.eventRegistrationAddonPurchases.quantity,
                  })
                  .from(schema.eventRegistrationAddonPurchases)
                  .where(
                    eq(
                      schema.eventRegistrationAddonPurchases.registrationId,
                      registrationId,
                    ),
                  );
                for (const addOnPurchase of addOnPurchases) {
                  yield* tx
                    .update(schema.eventAddons)
                    .set({
                      totalAvailableQuantity: sql`${schema.eventAddons.totalAvailableQuantity} + ${addOnPurchase.quantity}`,
                    })
                    .where(eq(schema.eventAddons.id, addOnPurchase.addonId));
                }
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
      Effect.catchCause((cause) =>
        (ownsClaim ? releaseWebhookEventClaim(event.id) : Effect.void).pipe(
          Effect.andThen(Effect.failCause(cause)),
        ),
      ),
    );

    const finalizeClaim = ownsClaim
      ? response.status >= 400
        ? releaseWebhookEventClaim(event.id)
        : markWebhookEventProcessed(event.id)
      : Effect.void;
    yield* finalizeClaim;

    return response;
  });
