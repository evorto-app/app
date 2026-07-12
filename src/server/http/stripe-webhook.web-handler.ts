import type Stripe from 'stripe';

import { registrationSpotCount } from '@shared/registration-spots';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { Database, type DatabaseClient } from '../../db';
import * as schema from '../../db/schema';
import { stripeWebhookConfig } from '../config/stripe-config';
import { retrieveHostedCheckoutSession } from '../integrations/stripe-checkout';
import { enqueueWaitlistSpotAvailableEmail } from '../notifications/email-delivery';
import { deriveRegistrationPaymentFeeSnapshot } from '../payments/registration-payment-fee-snapshot';
import { reconcileRegistrationRefundWebhook } from '../payments/registration-refund';
import {
  completePaidAddonPurchaseCheckout,
  expirePaidAddonPurchaseCheckout,
} from '../registrations/addon-purchase-checkout';
import { cancelTerminalBoundRegistrationCheckout } from '../registrations/expired-checkout-cleanup';
import { completePaidRegistrationCheckout } from '../registrations/registration-checkout-completion';
import { expireRegistrationTransferCheckout } from '../registrations/registration-transfer-finalization';
import { StripeClient } from '../stripe-client';
import { tenantOutboundUrl } from '../tenant-outbound-url';
import { readRequestBody } from './request-body';

export const MAX_STRIPE_WEBHOOK_SIZE_BYTES = 200 * 1024;
export const MAX_STRIPE_WEBHOOK_BODY_SIZE_BYTES = MAX_STRIPE_WEBHOOK_SIZE_BYTES;
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

export const stripeEventOwnsPersistedAccount = (
  eventAccount: null | string | undefined,
  persistedAccount: null | string | undefined,
): persistedAccount is string =>
  Boolean(
    eventAccount && persistedAccount && eventAccount === persistedAccount,
  );

export const prepareStripeWebhookRequest = Effect.fn(
  'prepareStripeWebhookRequest',
)(function* (request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return responseText('No signature', 400);
  }

  const rawBody = yield* readRequestBody(
    request,
    MAX_STRIPE_WEBHOOK_BODY_SIZE_BYTES,
  ).pipe(
    Effect.catchTags({
      RequestBodyInvalidContentLengthError: (error) =>
        Effect.logWarning('Stripe webhook has invalid Content-Length').pipe(
          Effect.annotateLogs({ contentLength: error.contentLength }),
          Effect.as(responseText('Invalid Content-Length', 400)),
        ),
      RequestBodyReadError: (error) =>
        Effect.logWarning('Failed to read Stripe webhook body').pipe(
          Effect.annotateLogs({
            error:
              error.cause instanceof Error
                ? error.cause.message
                : String(error.cause),
          }),
          Effect.as(responseText('Unable to read payload', 400)),
        ),
      RequestBodyTooLargeError: (error) =>
        Effect.logWarning('Stripe webhook body exceeded route limit').pipe(
          Effect.annotateLogs({ maxBytes: error.maxBytes }),
          Effect.as(responseText('Payload too large', 413)),
        ),
    }),
  );
  if (rawBody instanceof Response) {
    return rawBody;
  }

  return { rawBody, signature };
});

type StripeRefundWebhookEvent =
  | Stripe.RefundCreatedEvent
  | Stripe.RefundFailedEvent
  | Stripe.RefundUpdatedEvent;

type SupportedStripeWebhookEventType =
  | 'charge.updated'
  | 'checkout.session.async_payment_failed'
  | 'checkout.session.async_payment_succeeded'
  | 'checkout.session.completed'
  | 'checkout.session.expired'
  | 'refund.created'
  | 'refund.failed'
  | 'refund.updated';

const StripeExpandableId = Schema.NullOr(
  Schema.Union([
    Schema.NonEmptyString,
    Schema.Struct({ id: Schema.NonEmptyString }),
  ]),
);

const StripeRefundWebhookObject = Schema.Struct({
  amount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  charge: StripeExpandableId,
  currency: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  metadata: Schema.Record(Schema.String, Schema.String),
  object: Schema.Literal('refund'),
  payment_intent: StripeExpandableId,
  status: Schema.NullOr(
    Schema.Literals([
      'canceled',
      'failed',
      'pending',
      'requires_action',
      'succeeded',
    ]),
  ),
});

export const decodeStripeRefundWebhookObject = Schema.decodeUnknownEffect(
  StripeRefundWebhookObject,
);

const isStripeRefundWebhookEvent = (
  event: Stripe.Event,
): event is StripeRefundWebhookEvent =>
  event.type === 'refund.created' ||
  event.type === 'refund.failed' ||
  event.type === 'refund.updated';

const validateStripeRefundWebhookEvent = Effect.fn(
  'validateStripeRefundWebhookEvent',
)(function* (event: StripeRefundWebhookEvent) {
  return yield* decodeStripeRefundWebhookObject(event.data.object).pipe(
    Effect.as(true),
    Effect.catchTag('SchemaError', (error) =>
      Effect.logWarning('Stripe refund webhook payload is invalid').pipe(
        Effect.annotateLogs({
          eventId: event.id,
          eventType: event.type,
          issue: error.message,
        }),
        Effect.as(false),
      ),
    ),
  );
});

export const isSupportedStripeWebhookEventType = (
  eventType: string,
): eventType is SupportedStripeWebhookEventType =>
  eventType === 'charge.updated' ||
  eventType === 'checkout.session.async_payment_failed' ||
  eventType === 'checkout.session.async_payment_succeeded' ||
  eventType === 'checkout.session.completed' ||
  eventType === 'checkout.session.expired' ||
  eventType === 'refund.created' ||
  eventType === 'refund.failed' ||
  eventType === 'refund.updated';

export const asyncCheckoutFailureAction = (session: {
  readonly payment_status?: null | string;
  readonly status?: null | string;
}): 'cancel' | 'complete' | 'keepOpen' => {
  if (session.status === 'complete' && session.payment_status === 'paid') {
    return 'complete';
  }
  return session.status === 'open' ? 'keepOpen' : 'cancel';
};

const getTenantIdFromWebhookEvent = (
  event: Stripe.Event,
): string | undefined => {
  if (
    event.type === 'checkout.session.async_payment_failed' ||
    event.type === 'checkout.session.async_payment_succeeded' ||
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.expired' ||
    event.type === 'refund.created' ||
    event.type === 'refund.failed' ||
    event.type === 'refund.updated'
  ) {
    const tenantId = event.data.object.metadata?.['tenantId'];
    return tenantId && tenantId.length > 0 ? tenantId : undefined;
  }

  return;
};

const getCheckoutTenant = (tenantId: string) =>
  databaseEffect((database) =>
    database.query.tenants.findFirst({
      columns: {
        domain: true,
        emailSenderEmail: true,
        emailSenderName: true,
        id: true,
        name: true,
      },
      where: { id: tenantId },
    }),
  );

const getCheckoutNotificationContext = (
  registrationId: string,
  tenantId: string,
) =>
  databaseEffect((database) =>
    database.query.eventRegistrations.findFirst({
      columns: {
        eventId: true,
        id: true,
        registrationOptionId: true,
      },
      where: { id: registrationId, tenantId },
      with: {
        event: {
          columns: { title: true },
        },
        registrationOption: {
          columns: { id: true },
          with: {
            eventRegistrations: {
              columns: { id: true },
              where: { status: 'WAITLIST', tenantId },
              with: {
                user: {
                  columns: {
                    communicationEmail: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  );

const checkoutNotificationEmail = (user: {
  communicationEmail: string;
  email: string;
}): string => user.communicationEmail.trim() || user.email;

const getCheckoutSessionPaymentIntentId = (
  session: Stripe.Checkout.Session,
): string | undefined =>
  typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;

export interface PersistedCheckoutSessionBinding {
  readonly eventRegistrationId: null | string;
  readonly id: string;
  readonly method: 'cash' | 'paypal' | 'stripe' | 'transfer';
  readonly status: 'cancelled' | 'pending' | 'successful';
  readonly stripeAccountId: null | string;
  readonly stripeCheckoutSessionId: null | string;
  readonly stripePaymentIntentId: null | string;
  readonly tenantId: string;
  readonly type: 'addon' | 'other' | 'refund' | 'registration';
}

interface CheckoutSessionBindingInput {
  readonly allowFinalizedExpiry?: boolean | undefined;
  readonly eventAccount: null | string | undefined;
  readonly metadata: null | Readonly<Record<string, string | undefined>>;
  readonly paymentIntentId: string | undefined;
  readonly persisted: PersistedCheckoutSessionBinding;
  readonly registrationStatus?:
    'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST' | undefined;
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
      readonly transactionType: 'addon' | 'registration';
      readonly type: 'resolved';
    }
  | { readonly reason: string; readonly type: 'invalid-binding' }
  | { readonly type: 'already-finalized-expiry' }
  | { readonly type: 'state-conflict' };

type ResolvedCheckoutSessionBinding = Extract<
  CheckoutSessionBindingResult,
  { readonly type: 'resolved' }
>;

export const checkoutSessionBindingsMatch = (
  expected: ResolvedCheckoutSessionBinding,
  candidate: CheckoutSessionBindingResult | { readonly type: 'unresolved' },
): candidate is ResolvedCheckoutSessionBinding =>
  candidate.type === 'resolved' &&
  candidate.paymentIntentId === expected.paymentIntentId &&
  candidate.registrationId === expected.registrationId &&
  candidate.stripeAccountId === expected.stripeAccountId &&
  candidate.tenantId === expected.tenantId &&
  candidate.transactionId === expected.transactionId &&
  candidate.transactionType === expected.transactionType;

export const validateCheckoutSessionBinding = ({
  allowFinalizedExpiry = false,
  eventAccount,
  metadata,
  paymentIntentId,
  persisted,
  registrationStatus,
  requirePaymentIntent,
  sessionId,
  stripeAccountId,
}: CheckoutSessionBindingInput): CheckoutSessionBindingResult => {
  if (
    !persisted.eventRegistrationId ||
    persisted.method !== 'stripe' ||
    (persisted.type !== 'addon' && persisted.type !== 'registration') ||
    persisted.stripeCheckoutSessionId !== sessionId
  ) {
    return {
      reason:
        'Persisted checkout transaction is not a registration or add-on payment',
      type: 'invalid-binding',
    };
  }
  const persistedAccount = persisted.stripeAccountId;
  if (
    !persistedAccount ||
    !stripeAccountId ||
    persistedAccount !== stripeAccountId ||
    !eventAccount ||
    eventAccount !== persistedAccount
  ) {
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
  if (
    allowFinalizedExpiry &&
    persisted.status === 'cancelled' &&
    registrationStatus === 'CANCELLED'
  ) {
    return { type: 'already-finalized-expiry' };
  }
  if (persisted.status !== 'pending') {
    return { type: 'state-conflict' };
  }

  return {
    paymentIntentId,
    registrationId: persisted.eventRegistrationId,
    stripeAccountId: persistedAccount,
    tenantId: persisted.tenantId,
    transactionId: persisted.id,
    transactionType: persisted.type,
    type: 'resolved',
  };
};

const resolveCheckoutSession = (
  event: Stripe.Event,
  eventSession: Stripe.Checkout.Session,
  options: {
    readonly allowFinalizedExpiry?: boolean | undefined;
    readonly requirePaymentIntent: boolean;
  },
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
          stripeAccountId: true,
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

      const finalizedRegistration =
        options.allowFinalizedExpiry &&
        persisted.status === 'cancelled' &&
        persisted.eventRegistrationId
          ? yield* database.query.eventRegistrations.findFirst({
              columns: { status: true },
              where: {
                id: persisted.eventRegistrationId,
                tenantId: persisted.tenantId,
              },
            })
          : undefined;

      const tenant = yield* database.query.tenants.findFirst({
        columns: { stripeAccountId: true },
        where: { id: persisted.tenantId },
      });
      const binding = validateCheckoutSessionBinding({
        allowFinalizedExpiry: options.allowFinalizedExpiry,
        eventAccount: event.account,
        metadata: eventSession.metadata,
        paymentIntentId,
        persisted,
        registrationStatus: finalizedRegistration?.status,
        requirePaymentIntent: options.requirePaymentIntent,
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

const resolvePersistedAddonPurchaseOrder = (input: {
  readonly metadata: null | Readonly<Record<string, string | undefined>>;
  readonly registrationId: string;
  readonly tenantId: string;
  readonly transactionId: string;
}) =>
  databaseEffect((database) =>
    Effect.gen(function* () {
      const order =
        yield* database.query.eventRegistrationAddonPurchaseOrders.findFirst({
          columns: { id: true },
          where: {
            registrationId: input.registrationId,
            tenantId: input.tenantId,
            transactionId: input.transactionId,
          },
        });
      if (!order) return { type: 'missing' } as const;

      const metadataOrderId = input.metadata?.['addonPurchaseOrderId'];
      if (metadataOrderId !== undefined && metadataOrderId !== order.id) {
        return { type: 'metadata-conflict' } as const;
      }
      return { orderId: order.id, type: 'resolved' } as const;
    }),
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

    if (
      isStripeRefundWebhookEvent(event) &&
      !(yield* validateStripeRefundWebhookEvent(event))
    ) {
      return responseText('Invalid refund payload', 400);
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

          const stripeAccount = appTransaction.stripeAccountId;
          if (!stripeEventOwnsPersistedAccount(event.account, stripeAccount)) {
            return responseText('Stripe account ownership mismatch', 400);
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

          const snapshot = deriveRegistrationPaymentFeeSnapshot({
            charge,
            expectedCurrency: appTransaction.currency,
            expectedGrossAmount: appTransaction.amount,
            expectedPaymentIntentId: appTransaction.stripePaymentIntentId,
          });
          if (!snapshot || snapshot.stripeChargeId !== eventCharge.id) {
            return responseText('Charge payment ownership mismatch', 409);
          }

          yield* databaseEffect((database) =>
            database
              .update(schema.transactions)
              .set({
                appFee: snapshot.appFee,
                stripeFee: snapshot.stripeFee,
                stripeNetAmount: snapshot.stripeNetAmount,
              })
              .where(
                and(
                  eq(schema.transactions.id, appTransaction.id),
                  eq(schema.transactions.amount, appTransaction.amount),
                  eq(schema.transactions.currency, appTransaction.currency),
                  eq(schema.transactions.stripeAccountId, stripeAccount),
                  eq(schema.transactions.stripeChargeId, eventCharge.id),
                ),
              ),
          );

          return responseText('Success');
        }

        case 'checkout.session.async_payment_succeeded':
        // Delayed and immediate payment success share one exact transition.
        // falls through
        case 'checkout.session.completed': {
          const eventSession = event.data.object;
          if (
            eventSession.status !== 'complete' ||
            eventSession.payment_status !== 'paid'
          ) {
            yield* Effect.logInfo(
              'Skipping paid Checkout completion event',
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
            { requirePaymentIntent: true },
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
          if (checkoutSession.type === 'already-finalized-expiry') {
            return responseText('Checkout transaction state conflict', 409);
          }

          const {
            paymentIntentId: stripePaymentIntentId,
            registrationId,
            stripeAccountId: stripeAccount,
            tenantId,
            transactionId,
            transactionType,
          } = checkoutSession;
          if (!stripePaymentIntentId) {
            return responseText('Payment intent missing', 400);
          }

          if (transactionType === 'addon') {
            const addonOrder = yield* resolvePersistedAddonPurchaseOrder({
              metadata: eventSession.metadata,
              registrationId,
              tenantId,
              transactionId,
            });
            if (addonOrder.type !== 'resolved') {
              return responseText(
                addonOrder.type === 'metadata-conflict'
                  ? 'Add-on order metadata conflicts with persisted state'
                  : 'Persisted add-on order not found',
                400,
              );
            }
            yield* completePaidAddonPurchaseCheckout(
              {
                orderId: addonOrder.orderId,
                registrationId,
                stripeAccountId: stripeAccount,
                stripeCheckoutSessionId: eventSession.id,
                tenantId,
                transactionId,
              },
              eventSession,
            );
            return responseText('Success');
          }

          return yield* completePaidRegistrationCheckout(
            {
              registrationId,
              stripeAccountId: stripeAccount,
              stripeCheckoutSessionId: eventSession.id,
              tenantId,
              transactionId,
            },
            eventSession,
          ).pipe(
            Effect.as(responseText('Success')),
            Effect.catchTag('RegistrationCheckoutCompletionError', (error) => {
              if (error.kind === 'stateConflict') {
                return Effect.succeed(
                  responseText('Checkout transaction state conflict', 409),
                );
              }
              if (error.kind === 'invalidBinding') {
                return Effect.logWarning(
                  'Invalid Stripe registration Checkout completion',
                ).pipe(
                  Effect.annotateLogs({
                    eventId: event.id,
                    reason: error.message,
                    sessionId: eventSession.id,
                  }),
                  Effect.as(
                    responseText('Invalid checkout session binding', 400),
                  ),
                );
              }
              return Effect.fail(error);
            }),
          );
        }

        // Kept beside the shared success transition for one ownership audit surface.
        // eslint-disable-next-line perfectionist/sort-switch-case
        case 'checkout.session.async_payment_failed': {
          const eventSession = event.data.object;
          const checkoutSession = yield* resolveCheckoutSession(
            event,
            eventSession,
            { requirePaymentIntent: true },
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
          if (
            checkoutSession.type === 'state-conflict' ||
            checkoutSession.type === 'already-finalized-expiry'
          ) {
            return responseText('Checkout transaction state conflict', 409);
          }

          const {
            paymentIntentId: stripePaymentIntentId,
            registrationId,
            stripeAccountId: stripeAccount,
            tenantId,
            transactionId,
            transactionType,
          } = checkoutSession;
          if (!stripePaymentIntentId) {
            return responseText('Payment intent missing', 400);
          }

          const currentSession = yield* retrieveHostedCheckoutSession(
            eventSession.id,
            stripeAccount,
          );
          const failureAction = asyncCheckoutFailureAction(currentSession);
          if (failureAction === 'complete') {
            const currentBinding = yield* resolveCheckoutSession(
              event,
              currentSession,
              { requirePaymentIntent: true },
            );
            if (currentBinding.type === 'state-conflict') {
              return responseText('Checkout transaction state conflict', 409);
            }
            if (
              !checkoutSessionBindingsMatch(checkoutSession, currentBinding)
            ) {
              return responseText('Invalid checkout session binding', 400);
            }
            if (transactionType === 'addon') {
              const addonOrder = yield* resolvePersistedAddonPurchaseOrder({
                metadata: currentSession.metadata,
                registrationId,
                tenantId,
                transactionId,
              });
              if (addonOrder.type !== 'resolved') {
                return responseText(
                  addonOrder.type === 'metadata-conflict'
                    ? 'Add-on order metadata conflicts with persisted state'
                    : 'Persisted add-on order not found',
                  400,
                );
              }
              yield* completePaidAddonPurchaseCheckout(
                {
                  orderId: addonOrder.orderId,
                  registrationId,
                  stripeAccountId: stripeAccount,
                  stripeCheckoutSessionId: eventSession.id,
                  tenantId,
                  transactionId,
                },
                currentSession,
              );
            } else {
              yield* completePaidRegistrationCheckout(
                {
                  registrationId,
                  stripeAccountId: stripeAccount,
                  stripeCheckoutSessionId: eventSession.id,
                  tenantId,
                  transactionId,
                },
                currentSession,
              );
            }
            return responseText('Success');
          }
          if (failureAction === 'keepOpen') {
            const updated = yield* databaseEffect((database) =>
              database
                .update(schema.transactions)
                .set({
                  stripeCheckoutReconcileLastError:
                    'Stripe reported an asynchronous payment failure while Checkout remained retryable',
                  stripeCheckoutReconcileLeaseExpiresAt: null,
                  stripeCheckoutReconcileLeaseId: null,
                  stripeCheckoutReconcileNextAt: new Date(),
                  stripePaymentIntentId,
                })
                .where(
                  and(
                    eq(schema.transactions.id, transactionId),
                    eq(schema.transactions.eventRegistrationId, registrationId),
                    eq(schema.transactions.method, 'stripe'),
                    eq(schema.transactions.stripeAccountId, stripeAccount),
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
                    eq(schema.transactions.type, transactionType),
                  ),
                )
                .returning({ id: schema.transactions.id }),
            );
            return updated.length === 1
              ? responseText('Payment failed; Checkout remains retryable')
              : responseText('Checkout transaction state conflict', 409);
          }

          if (transactionType === 'addon') {
            const addonOrder = yield* resolvePersistedAddonPurchaseOrder({
              metadata: currentSession.metadata,
              registrationId,
              tenantId,
              transactionId,
            });
            if (addonOrder.type !== 'resolved') {
              return responseText(
                addonOrder.type === 'metadata-conflict'
                  ? 'Add-on order metadata conflicts with persisted state'
                  : 'Persisted add-on order not found',
                400,
              );
            }
            yield* expirePaidAddonPurchaseCheckout({
              now: new Date(),
              orderId: addonOrder.orderId,
              registrationId,
              requireDeadline: false,
              stripeAccountId: stripeAccount,
              stripeCheckoutSessionId: eventSession.id,
              tenantId,
              transactionId,
            });
            return responseText('Payment failed; add-on stock released');
          }
          const cancellation = yield* cancelTerminalBoundRegistrationCheckout({
            registrationId,
            stripeAccountId: stripeAccount,
            stripeCheckoutSessionId: eventSession.id,
            tenantId,
            transactionId,
          });
          return cancellation === 'cancelled'
            ? responseText('Payment failed; registration cancelled')
            : responseText('Checkout transaction state conflict', 409);
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
            {
              allowFinalizedExpiry: true,
              requirePaymentIntent: false,
            },
          );
          if (checkoutSession.type === 'already-finalized-expiry') {
            return responseText('Success');
          }
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
            transactionType,
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

          if (transactionType === 'addon') {
            const addonOrder = yield* resolvePersistedAddonPurchaseOrder({
              metadata: eventSession.metadata,
              registrationId,
              tenantId,
              transactionId,
            });
            if (addonOrder.type !== 'resolved') {
              return responseText(
                addonOrder.type === 'metadata-conflict'
                  ? 'Add-on order metadata conflicts with persisted state'
                  : 'Persisted add-on order not found',
                400,
              );
            }
            yield* expirePaidAddonPurchaseCheckout({
              now: new Date(),
              orderId: addonOrder.orderId,
              registrationId,
              stripeAccountId: stripeAccount,
              stripeCheckoutSessionId: eventSession.id,
              tenantId,
              transactionId,
            });
            return responseText('Success');
          }

          const checkoutTenant = yield* getCheckoutTenant(tenantId);
          const notificationContext = yield* getCheckoutNotificationContext(
            registrationId,
            tenantId,
          );
          const waitlistRecipients =
            notificationContext?.registrationOption?.eventRegistrations.flatMap(
              (waitlistRegistration) =>
                waitlistRegistration.user
                  ? [
                      {
                        registrationId: waitlistRegistration.id,
                        to: checkoutNotificationEmail(
                          waitlistRegistration.user,
                        ),
                      },
                    ]
                  : [],
            ) ?? [];
          const notificationEventUrl =
            checkoutTenant &&
            notificationContext &&
            waitlistRecipients.length > 0
              ? yield* tenantOutboundUrl(
                  checkoutTenant,
                  `/events/${encodeURIComponent(notificationContext.eventId)}`,
                )
              : null;

          const updated = yield* databaseEffect((database) =>
            database
              .transaction((tx) =>
                Effect.gen(function* () {
                  const transferExpiry =
                    yield* expireRegistrationTransferCheckout(tx, {
                      registrationId,
                      tenantId,
                      transactionId,
                    });
                  if (transferExpiry === 'expired') {
                    return true;
                  }
                  if (transferExpiry === 'alreadyExpired') {
                    return false;
                  }

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

                        if (waitlistRecipients.length > 0) {
                          if (
                            !checkoutTenant ||
                            !notificationContext?.event ||
                            !notificationEventUrl ||
                            notificationContext.eventId !==
                              lockedRegistration.eventId ||
                            notificationContext.registrationOptionId !==
                              lockedRegistration.registrationOptionId
                          ) {
                            return yield* Effect.die(
                              new Error(
                                'Waitlist availability notification context is missing or stale',
                              ),
                            );
                          }
                          for (const waitlistRecipient of waitlistRecipients) {
                            yield* enqueueWaitlistSpotAvailableEmail(tx, {
                              availabilityKey: `checkout-expired-${registrationId}`,
                              eventTitle: notificationContext.event.title,
                              eventUrl: notificationEventUrl,
                              tenant: checkoutTenant,
                              to: waitlistRecipient.to,
                              waitlistRegistrationId:
                                waitlistRecipient.registrationId,
                            });
                          }
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
                            eq(
                              schema.transactions.stripeAccountId,
                              stripeAccount,
                            ),
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

        case 'refund.created':
        case 'refund.failed':
        case 'refund.updated': {
          const refund = event.data.object;
          if (!refund.metadata?.['refundClaimId']) {
            return responseText('Non-registration refund ignored');
          }
          const result = yield* reconcileRegistrationRefundWebhook(
            refund,
            event.account,
          );
          return result.status === 'reconciled'
            ? responseText('Success')
            : responseText('Refund claim ownership mismatch', 400);
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
