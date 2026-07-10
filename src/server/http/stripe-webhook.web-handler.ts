import type Stripe from 'stripe';

import { registrationSpotCount } from '@shared/registration-spots';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { Database, type DatabaseClient } from '../../db';
import * as schema from '../../db/schema';
import { stripeWebhookConfig } from '../config/stripe-config';
import { StripeClient } from '../stripe-client';

export const MAX_STRIPE_WEBHOOK_SIZE_BYTES = 200 * 1024;
const STALE_WEBHOOK_CLAIM_AGE_MS = 5 * 60 * 1000;

interface CheckoutWebhookTransitionSteps<LockedRegistration, E, R> {
  readonly lockRegistration: () => Effect.Effect<
    LockedRegistration | undefined,
    E,
    R
  >;
  readonly updateDependents: (
    registration: LockedRegistration,
  ) => Effect.Effect<void, E, R>;
  readonly updateRegistration: (
    registration: LockedRegistration,
  ) => Effect.Effect<number, E, R>;
  readonly updateTransaction: (
    registration: LockedRegistration,
  ) => Effect.Effect<number, E, R>;
}

interface StripeWebhookBodyRequest {
  readonly body: null | ReadableStream<Uint8Array>;
  readonly headers: Pick<Headers, 'get'>;
}

class StripePaymentIntentReadError extends Schema.TaggedErrorClass<StripePaymentIntentReadError>()(
  'StripePaymentIntentReadError',
  { cause: Schema.Defect() },
) {}

class StripeWebhookBodyReadError extends Schema.TaggedErrorClass<StripeWebhookBodyReadError>()(
  'StripeWebhookBodyReadError',
  { cause: Schema.Defect() },
) {}

class StripeWebhookBodyTooLargeError extends Schema.TaggedErrorClass<StripeWebhookBodyTooLargeError>()(
  'StripeWebhookBodyTooLargeError',
  {},
) {}

class StripeWebhookStateConflictError extends Schema.TaggedErrorClass<StripeWebhookStateConflictError>()(
  'StripeWebhookStateConflictError',
  {},
) {}

export const runCheckoutWebhookTransition = Effect.fn(
  'runCheckoutWebhookTransition',
)(function* <LockedRegistration, E, R>(
  steps: CheckoutWebhookTransitionSteps<LockedRegistration, E, R>,
) {
  const lockedRegistration = yield* steps.lockRegistration();
  if (!lockedRegistration) {
    return yield* new StripeWebhookStateConflictError();
  }

  const updatedTransactionCount =
    yield* steps.updateTransaction(lockedRegistration);
  if (updatedTransactionCount !== 1) {
    return yield* new StripeWebhookStateConflictError();
  }

  const updatedRegistrationCount =
    yield* steps.updateRegistration(lockedRegistration);
  if (updatedRegistrationCount !== 1) {
    return yield* new StripeWebhookStateConflictError();
  }

  yield* steps.updateDependents(lockedRegistration);
});

const parseContentLength = (value: null | string): number | undefined => {
  if (!value || !/^(0|[1-9]\d*)$/.test(value.trim())) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

export const readStripeWebhookBody = Effect.fn('readStripeWebhookBody')(
  function* (
    request: StripeWebhookBodyRequest,
    maxBytes = MAX_STRIPE_WEBHOOK_SIZE_BYTES,
  ) {
    const contentLength = parseContentLength(
      request.headers.get('content-length'),
    );
    if (contentLength !== undefined && contentLength > maxBytes) {
      const body = request.body;
      if (body) {
        yield* Effect.tryPromise({
          catch: (cause) => new StripeWebhookBodyReadError({ cause }),
          try: () =>
            body.cancel('Stripe webhook Content-Length exceeded limit'),
        }).pipe(Effect.catch(() => Effect.void));
      }
      return yield* new StripeWebhookBodyTooLargeError();
    }

    const readResult = yield* Effect.tryPromise({
      catch: (cause) => new StripeWebhookBodyReadError({ cause }),
      try: async () => {
        if (!request.body) {
          return { bytes: new Uint8Array(), type: 'success' } as const;
        }

        const reader = request.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
              break;
            }

            totalBytes += chunk.value.byteLength;
            if (totalBytes > maxBytes) {
              try {
                await reader.cancel('Stripe webhook body exceeded limit');
              } catch {
                // The size result remains authoritative when cancellation races
                // with a stream that has already errored or closed.
              }
              return { type: 'too-large' } as const;
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }

        const bytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return { bytes, type: 'success' } as const;
      },
    });

    if (readResult.type === 'too-large') {
      return yield* new StripeWebhookBodyTooLargeError();
    }
    return readResult.bytes;
  },
);

const databaseEffect = <A, E>(
  operation: (database: DatabaseClient) => Effect.Effect<A, E, never>,
) => Database.use((database) => operation(database));

const responseText = (body: string, status = 200): Response =>
  new Response(body, { status });

type SupportedStripeWebhookEventType =
  'charge.updated' | 'checkout.session.completed' | 'checkout.session.expired';

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

export interface PersistedCheckoutSessionBinding {
  readonly eventRegistrationId: null | string;
  readonly id: string;
  readonly method: 'cash' | 'paypal' | 'stripe' | 'transfer';
  readonly status: 'cancelled' | 'pending' | 'successful';
  readonly stripeCheckoutSessionId: null | string;
  readonly stripePaymentIntentId: null | string;
  readonly tenantId: string;
  readonly type: 'other' | 'refund' | 'registration';
}

interface CheckoutSessionBindingInput {
  readonly eventAccount: null | string | undefined;
  readonly metadata: null | Readonly<Record<string, string | undefined>>;
  readonly paymentIntentId: string | undefined;
  readonly persisted: PersistedCheckoutSessionBinding;
  readonly requirePaymentIntent: boolean;
  readonly sessionId: string;
  readonly stripeAccountId: null | string | undefined;
}

type CheckoutSessionBindingResult =
  | {
      readonly paymentIntentId: string | undefined;
      readonly registrationId: string;
      readonly stripeAccountId: string;
      readonly tenantId: string;
      readonly transactionId: string;
      readonly type: 'resolved';
    }
  | { readonly reason: string; readonly type: 'invalid-binding' }
  | { readonly type: 'state-conflict' };

export const validateCheckoutSessionBinding = ({
  eventAccount,
  metadata,
  paymentIntentId,
  persisted,
  requirePaymentIntent,
  sessionId,
  stripeAccountId,
}: CheckoutSessionBindingInput): CheckoutSessionBindingResult => {
  if (
    !persisted.eventRegistrationId ||
    persisted.method !== 'stripe' ||
    persisted.type !== 'registration' ||
    persisted.stripeCheckoutSessionId !== sessionId
  ) {
    return {
      reason: 'Persisted checkout transaction is not a registration payment',
      type: 'invalid-binding',
    };
  }
  if (!stripeAccountId || !eventAccount || eventAccount !== stripeAccountId) {
    return {
      reason: 'Stripe connected account does not match the tenant',
      type: 'invalid-binding',
    };
  }

  const metadataRegistrationId = metadata?.['registrationId'];
  const metadataTenantId = metadata?.['tenantId'];
  const metadataTransactionId = metadata?.['transactionId'];
  const hasAnyMappingMetadata =
    metadataRegistrationId !== undefined ||
    metadataTenantId !== undefined ||
    metadataTransactionId !== undefined;
  if (
    hasAnyMappingMetadata &&
    (metadataRegistrationId !== persisted.eventRegistrationId ||
      metadataTenantId !== persisted.tenantId ||
      metadataTransactionId !== persisted.id)
  ) {
    return {
      reason: 'Checkout metadata conflicts with the persisted transaction',
      type: 'invalid-binding',
    };
  }

  if (
    (requirePaymentIntent && !paymentIntentId) ||
    (persisted.stripePaymentIntentId !== null &&
      persisted.stripePaymentIntentId !== paymentIntentId)
  ) {
    return {
      reason: 'Payment intent conflicts with the persisted transaction',
      type: 'invalid-binding',
    };
  }
  if (persisted.status !== 'pending') {
    return { type: 'state-conflict' };
  }

  return {
    paymentIntentId,
    registrationId: persisted.eventRegistrationId,
    stripeAccountId,
    tenantId: persisted.tenantId,
    transactionId: persisted.id,
    type: 'resolved',
  };
};

const resolveCheckoutSession = (
  event: Stripe.Event,
  eventSession: Stripe.Checkout.Session,
  requirePaymentIntent: boolean,
) =>
  databaseEffect((database) =>
    Effect.gen(function* () {
      const paymentIntentId = getCheckoutSessionPaymentIntentId(eventSession);
      const persisted = yield* database.query.transactions.findFirst({
        columns: {
          eventRegistrationId: true,
          id: true,
          method: true,
          status: true,
          stripeCheckoutSessionId: true,
          stripePaymentIntentId: true,
          tenantId: true,
          type: true,
        },
        where: { stripeCheckoutSessionId: eventSession.id },
      });
      if (!persisted) {
        return { type: 'unresolved' } as const;
      }

      const tenant = yield* database.query.tenants.findFirst({
        columns: { stripeAccountId: true },
        where: { id: persisted.tenantId },
      });
      const binding = validateCheckoutSessionBinding({
        eventAccount: event.account,
        metadata: eventSession.metadata,
        paymentIntentId,
        persisted,
        requirePaymentIntent,
        sessionId: eventSession.id,
        stripeAccountId: tenant?.stripeAccountId,
      });
      if (binding.type !== 'resolved' || !paymentIntentId) {
        return binding;
      }

      const paymentIntentTransaction =
        yield* database.query.transactions.findFirst({
          columns: { id: true },
          where: { stripePaymentIntentId: paymentIntentId },
        });
      if (
        paymentIntentTransaction &&
        paymentIntentTransaction.id !== persisted.id
      ) {
        return {
          reason: 'Payment intent belongs to another transaction',
          type: 'invalid-binding',
        } as const;
      }

      return binding;
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
          ...(input.tenantId && { tenantId: input.tenantId }),
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
            ...(input.tenantId && { tenantId: input.tenantId }),
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
    const rawBody = yield* readStripeWebhookBody(request).pipe(
      Effect.tapErrorTag('StripeWebhookBodyReadError', (error) =>
        Effect.logError('Failed to read Stripe webhook body').pipe(
          Effect.annotateLogs({ error: String(error.cause) }),
        ),
      ),
      Effect.catchTag('StripeWebhookBodyTooLargeError', () =>
        Effect.succeed(responseText('Payload too large', 413)),
      ),
    );
    if (rawBody instanceof Response) {
      return rawBody;
    }

    const stripe = yield* StripeClient;
    const { STRIPE_WEBHOOK_SECRET: endpointSecret } =
      yield* stripeWebhookConfig;
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return responseText('No signature', 400);
    }

    const event = yield* Effect.sync(() =>
      stripe.webhooks.constructEvent(
        Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength),
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
    let isOwnsClaim = false;
    const response = yield* Effect.gen(function* () {
      const claimedEvent = yield* claimWebhookEvent({
        eventId: event.id,
        eventType: event.type,
        ...(tenantId && { tenantId }),
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
      isOwnsClaim = true;

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

          const checkoutSession = yield* resolveCheckoutSession(
            event,
            eventSession,
            true,
          );
          if (checkoutSession.type === 'unresolved') {
            return responseText('Missing checkout session mapping', 400);
          }
          if (checkoutSession.type === 'invalid-binding') {
            yield* Effect.logWarning('Invalid Stripe checkout binding').pipe(
              Effect.annotateLogs({
                eventId: event.id,
                reason: checkoutSession.reason,
                sessionId: eventSession.id,
              }),
            );
            return responseText('Invalid checkout session binding', 400);
          }
          if (checkoutSession.type === 'state-conflict') {
            return responseText('Checkout transaction state conflict', 409);
          }

          const {
            paymentIntentId: stripePaymentIntentId,
            registrationId,
            stripeAccountId: stripeAccount,
            tenantId,
            transactionId,
          } = checkoutSession;
          if (!stripePaymentIntentId) {
            return responseText('Payment intent missing', 400);
          }
          const stripeChargeResult = yield* Effect.gen(function* () {
            const paymentIntentField = eventSession.payment_intent;
            const inlineChargeId = getLatestChargeId(paymentIntentField);
            if (inlineChargeId) {
              return {
                stripeChargeId: inlineChargeId,
                type: 'resolved',
              } as const;
            }
            if (typeof paymentIntentField !== 'string') {
              return {
                stripeChargeId: undefined,
                type: 'resolved',
              } as const;
            }

            const paymentIntentResult = yield* Effect.tryPromise({
              catch: (cause) => new StripePaymentIntentReadError({ cause }),
              try: () =>
                stripe.paymentIntents.retrieve(
                  paymentIntentField,
                  {
                    expand: ['latest_charge'],
                  },
                  {
                    stripeAccount,
                  },
                ),
            }).pipe(
              Effect.map(
                (paymentIntent) => ({ paymentIntent, type: 'found' }) as const,
              ),
              Effect.catchTag('StripePaymentIntentReadError', (error) =>
                isStripeMissingResourceError(error.cause)
                  ? Effect.succeed({ type: 'missing' } as const)
                  : Effect.fail(error),
              ),
            );

            if (paymentIntentResult.type === 'missing') {
              return paymentIntentResult;
            }
            const { paymentIntent } = paymentIntentResult;
            if (paymentIntent.id !== stripePaymentIntentId) {
              return { type: 'mismatch' } as const;
            }

            return {
              stripeChargeId: getLatestChargeId(paymentIntent),
              type: 'resolved',
            } as const;
          });
          if (stripeChargeResult.type !== 'resolved') {
            return responseText('Payment intent not found for tenant', 400);
          }
          const { stripeChargeId } = stripeChargeResult;

          const updated = yield* databaseEffect((database) =>
            database
              .transaction((tx) =>
                Effect.gen(function* () {
                  yield* runCheckoutWebhookTransition({
                    lockRegistration: () =>
                      tx
                        .select({
                          eventId: schema.eventRegistrations.eventId,
                          guestCount: schema.eventRegistrations.guestCount,
                          id: schema.eventRegistrations.id,
                          registrationOptionId:
                            schema.eventRegistrations.registrationOptionId,
                        })
                        .from(schema.eventRegistrations)
                        .where(
                          and(
                            eq(schema.eventRegistrations.id, registrationId),
                            eq(schema.eventRegistrations.status, 'PENDING'),
                            eq(schema.eventRegistrations.tenantId, tenantId),
                          ),
                        )
                        .for('update')
                        .pipe(Effect.map((rows) => rows[0])),
                    updateDependents: (lockedRegistration) =>
                      Effect.gen(function* () {
                        const registeredSpotCount = registrationSpotCount(
                          lockedRegistration.guestCount,
                        );
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
                                lockedRegistration.registrationOptionId,
                              ),
                              eq(
                                schema.eventRegistrationOptions.eventId,
                                lockedRegistration.eventId,
                              ),
                            ),
                          );
                      }),
                    updateRegistration: (lockedRegistration) =>
                      tx
                        .update(schema.eventRegistrations)
                        .set({ status: 'CONFIRMED' })
                        .where(
                          and(
                            eq(
                              schema.eventRegistrations.id,
                              lockedRegistration.id,
                            ),
                            eq(schema.eventRegistrations.status, 'PENDING'),
                            eq(schema.eventRegistrations.tenantId, tenantId),
                          ),
                        )
                        .returning({ id: schema.eventRegistrations.id })
                        .pipe(Effect.map((rows) => rows.length)),
                    updateTransaction: (lockedRegistration) =>
                      tx
                        .update(schema.transactions)
                        .set({
                          status: 'successful',
                          stripeChargeId,
                          stripePaymentIntentId,
                        })
                        .where(
                          and(
                            eq(schema.transactions.id, transactionId),
                            eq(
                              schema.transactions.eventRegistrationId,
                              lockedRegistration.id,
                            ),
                            eq(schema.transactions.method, 'stripe'),
                            eq(schema.transactions.status, 'pending'),
                            eq(
                              schema.transactions.stripeCheckoutSessionId,
                              eventSession.id,
                            ),
                            or(
                              isNull(schema.transactions.stripePaymentIntentId),
                              eq(
                                schema.transactions.stripePaymentIntentId,
                                stripePaymentIntentId,
                              ),
                            ),
                            eq(schema.transactions.tenantId, tenantId),
                            eq(schema.transactions.type, 'registration'),
                          ),
                        )
                        .returning({ id: schema.transactions.id })
                        .pipe(Effect.map((rows) => rows.length)),
                  });
                  return true;
                }),
              )
              .pipe(
                Effect.catchTag('StripeWebhookStateConflictError', () =>
                  Effect.succeed(false),
                ),
              ),
          );
          if (!updated) {
            return responseText('Checkout transaction state conflict', 409);
          }

          return responseText('Success');
        }

        case 'checkout.session.expired': {
          const eventSession = event.data.object;
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

          const checkoutSession = yield* resolveCheckoutSession(
            event,
            eventSession,
            false,
          );
          if (checkoutSession.type === 'unresolved') {
            return responseText('Missing checkout session mapping', 400);
          }
          if (checkoutSession.type === 'invalid-binding') {
            yield* Effect.logWarning('Invalid Stripe checkout binding').pipe(
              Effect.annotateLogs({
                eventId: event.id,
                reason: checkoutSession.reason,
                sessionId: eventSession.id,
              }),
            );
            return responseText('Invalid checkout session binding', 400);
          }
          if (checkoutSession.type === 'state-conflict') {
            return responseText('Checkout transaction state conflict', 409);
          }

          const {
            paymentIntentId: stripePaymentIntentId,
            registrationId,
            tenantId,
            transactionId,
          } = checkoutSession;
          const paymentIntentPredicate = stripePaymentIntentId
            ? or(
                isNull(schema.transactions.stripePaymentIntentId),
                eq(
                  schema.transactions.stripePaymentIntentId,
                  stripePaymentIntentId,
                ),
              )
            : isNull(schema.transactions.stripePaymentIntentId);

          const updated = yield* databaseEffect((database) =>
            database
              .transaction((tx) =>
                Effect.gen(function* () {
                  yield* runCheckoutWebhookTransition({
                    lockRegistration: () =>
                      tx
                        .select({
                          eventId: schema.eventRegistrations.eventId,
                          guestCount: schema.eventRegistrations.guestCount,
                          id: schema.eventRegistrations.id,
                          registrationOptionId:
                            schema.eventRegistrations.registrationOptionId,
                        })
                        .from(schema.eventRegistrations)
                        .where(
                          and(
                            eq(schema.eventRegistrations.id, registrationId),
                            eq(schema.eventRegistrations.status, 'PENDING'),
                            eq(schema.eventRegistrations.tenantId, tenantId),
                          ),
                        )
                        .for('update')
                        .pipe(Effect.map((rows) => rows[0])),
                    updateDependents: (lockedRegistration) =>
                      Effect.gen(function* () {
                        const registeredSpotCount = registrationSpotCount(
                          lockedRegistration.guestCount,
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
                                lockedRegistration.registrationOptionId,
                              ),
                              eq(
                                schema.eventRegistrationOptions.eventId,
                                lockedRegistration.eventId,
                              ),
                            ),
                          );

                        const addOnPurchases = yield* tx
                          .select({
                            addonId:
                              schema.eventRegistrationAddonPurchases.addonId,
                            quantity:
                              schema.eventRegistrationAddonPurchases.quantity,
                          })
                          .from(schema.eventRegistrationAddonPurchases)
                          .where(
                            eq(
                              schema.eventRegistrationAddonPurchases
                                .registrationId,
                              lockedRegistration.id,
                            ),
                          )
                          .orderBy(
                            schema.eventRegistrationAddonPurchases.addonId,
                          );
                        for (const addOnPurchase of addOnPurchases) {
                          yield* tx
                            .update(schema.eventAddons)
                            .set({
                              totalAvailableQuantity: sql`${schema.eventAddons.totalAvailableQuantity} + ${addOnPurchase.quantity}`,
                            })
                            .where(
                              eq(schema.eventAddons.id, addOnPurchase.addonId),
                            );
                        }
                      }),
                    updateRegistration: (lockedRegistration) =>
                      tx
                        .update(schema.eventRegistrations)
                        .set({ status: 'CANCELLED' })
                        .where(
                          and(
                            eq(
                              schema.eventRegistrations.id,
                              lockedRegistration.id,
                            ),
                            eq(schema.eventRegistrations.status, 'PENDING'),
                            eq(schema.eventRegistrations.tenantId, tenantId),
                          ),
                        )
                        .returning({ id: schema.eventRegistrations.id })
                        .pipe(Effect.map((rows) => rows.length)),
                    updateTransaction: (lockedRegistration) =>
                      tx
                        .update(schema.transactions)
                        .set({
                          status: 'cancelled',
                          ...(stripePaymentIntentId && {
                            stripePaymentIntentId,
                          }),
                        })
                        .where(
                          and(
                            eq(schema.transactions.id, transactionId),
                            eq(
                              schema.transactions.eventRegistrationId,
                              lockedRegistration.id,
                            ),
                            eq(schema.transactions.method, 'stripe'),
                            eq(schema.transactions.status, 'pending'),
                            eq(
                              schema.transactions.stripeCheckoutSessionId,
                              eventSession.id,
                            ),
                            paymentIntentPredicate,
                            eq(schema.transactions.tenantId, tenantId),
                            eq(schema.transactions.type, 'registration'),
                          ),
                        )
                        .returning({ id: schema.transactions.id })
                        .pipe(Effect.map((rows) => rows.length)),
                  });
                  return true;
                }),
              )
              .pipe(
                Effect.catchTag('StripeWebhookStateConflictError', () =>
                  Effect.succeed(false),
                ),
              ),
          );
          if (!updated) {
            return responseText('Checkout transaction state conflict', 409);
          }

          return responseText('Success');
        }

        default: {
          return responseText('Ignored');
        }
      }
    }).pipe(
      Effect.catchCause((cause) =>
        (isOwnsClaim ? releaseWebhookEventClaim(event.id) : Effect.void).pipe(
          Effect.andThen(Effect.failCause(cause)),
        ),
      ),
    );

    const finalizeClaim = isOwnsClaim
      ? response.status >= 400
        ? releaseWebhookEventClaim(event.id)
        : markWebhookEventProcessed(event.id)
      : Effect.void;
    yield* finalizeClaim;

    return response;
  });
