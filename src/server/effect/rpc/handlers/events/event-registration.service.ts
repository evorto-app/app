import { registrationSpotCount } from '@shared/registration-spots';
import {
  resolveTenantDiscountProviders,
  type TenantDiscountProviders,
} from '@shared/tenant-config';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ConfigProvider, Context, Effect, Layer, Option, Schema } from 'effect';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../../../../db';
import { createId } from '../../../../../db/create-id';
import {
  addonToEventRegistrationOptions,
  emailOutbox,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrations,
  type RegistrationCheckoutLineItemSnapshot,
  type RegistrationCheckoutSnapshot,
  RegistrationCheckoutSnapshotSchema,
  tenantStripeTaxRates,
  transactions,
  userDiscountCards,
  usersToTenants,
} from '../../../../../db/schema';
import { type Tenant } from '../../../../../types/custom/tenant';
import { type User } from '../../../../../types/custom/user';
import { getServerNow } from '../../../../clock';
import { formatConfigError } from '../../../../config/config-error';
import { serverConfig } from '../../../../config/server-config';
import {
  buildCheckoutSessionExpiresAt,
  buildCheckoutSessionIdempotencyKey,
  createHostedCheckoutSession,
  StripeCheckoutError,
} from '../../../../integrations/stripe-checkout';
import {
  enqueueManualApprovalEmail,
  enqueueRegistrationConfirmedEmail,
} from '../../../../notifications/email-delivery';
import { lockTenantStripeAccount } from '../../../../payments/pending-stripe-obligations';
import {
  establishRegistrationAcquisition,
  settleAcquisitionComponentTerms,
} from '../../../../registrations/registration-acquisition-write';
import { registrationCheckoutInitialReconcileAt } from '../../../../registrations/registration-checkout-completion';
import { StripeClient } from '../../../../stripe-client';
import {
  tenantOutboundRootUrl,
  tenantOutboundUrl,
} from '../../../../tenant-outbound-url';
import {
  ACTIVE_REGISTRATION_UNIQUE_CONSTRAINT,
  isUniqueConstraintViolation,
} from './database-constraint-errors';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from './events.errors';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  // Registration write flows should fail fast on unexpected DB errors so
  // callers get deterministic domain errors instead of partial success.
  Database.use((database) => operation(database).pipe(Effect.orDie));

export const isDefinitiveCheckoutSessionCreateFailure = (
  error: unknown,
): boolean => {
  const stripeError =
    error instanceof StripeCheckoutError ? error.cause : error;
  return (
    stripeError instanceof Stripe.errors.StripeInvalidRequestError &&
    stripeError.statusCode === 400 &&
    stripeError.rawType === 'invalid_request_error' &&
    typeof stripeError.requestId === 'string' &&
    stripeError.requestId.length > 0 &&
    stripeError.code !== 'idempotency_key_in_use' &&
    stripeError.headers?.['stripe-should-retry'] !== 'true'
  );
};

const expireCheckoutSession = (sessionId: string, stripeAccount: string) =>
  Effect.gen(function* () {
    const stripe = yield* StripeClient;
    const expiredSession = yield* Effect.tryPromise({
      catch: (cause) =>
        new EventRegistrationInternalError({
          cause,
          message: 'Failed to expire unbound stripe checkout session',
        }),
      try: () =>
        Promise.race([
          stripe.checkout.sessions.expire(sessionId, undefined, {
            stripeAccount,
          }),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error('Stripe checkout expiry timed out')),
              5000,
            );
          }),
        ]),
    });
    if (expiredSession.status !== 'expired') {
      return yield* Effect.fail(
        new EventRegistrationInternalError({
          message: 'Failed to expire unbound stripe checkout session',
        }),
      );
    }
  });

type DiscountCardRecord = Pick<
  typeof userDiscountCards.$inferSelect,
  'type' | 'validTo'
>;

interface DiscountResolution {
  appliedDiscountedPrice: null | number;
  appliedDiscountType:
    null | typeof eventRegistrationOptionDiscounts.$inferSelect.discountType;
  discountAmount: null | number;
  effectivePrice: number;
}

type RegistrationOptionDiscountRecord = Pick<
  typeof eventRegistrationOptionDiscounts.$inferSelect,
  'discountedPrice' | 'discountType'
>;

const noDiscountResolution = (basePrice: number): DiscountResolution => ({
  appliedDiscountedPrice: null,
  appliedDiscountType: null,
  discountAmount: null,
  effectivePrice: basePrice,
});

export const isUserEligibleForRegistrationOption = ({
  optionRoleIds,
  userRoleIds,
}: {
  optionRoleIds: readonly string[];
  userRoleIds: readonly string[];
}): boolean =>
  optionRoleIds.length === 0 ||
  optionRoleIds.some((roleId) => userRoleIds.includes(roleId));

const resolveDiscount = ({
  basePrice,
  cards,
  discounts,
  enabledTypes,
  eventStart,
}: {
  basePrice: number;
  cards: readonly DiscountCardRecord[];
  discounts: readonly RegistrationOptionDiscountRecord[];
  enabledTypes: ReadonlySet<string>;
  eventStart: Date;
}): DiscountResolution => {
  if (cards.length === 0 || discounts.length === 0) {
    return {
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      discountAmount: null,
      effectivePrice: basePrice,
    };
  }

  const eligibleDiscounts = discounts.filter((discount) =>
    cards.some(
      (card) =>
        card.type === discount.discountType &&
        enabledTypes.has(card.type) &&
        (!card.validTo || card.validTo > eventStart),
    ),
  );

  if (eligibleDiscounts.length === 0) {
    return {
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      discountAmount: null,
      effectivePrice: basePrice,
    };
  }

  let bestDiscount = eligibleDiscounts[0];
  for (const candidate of eligibleDiscounts.slice(1)) {
    if (candidate.discountedPrice < bestDiscount.discountedPrice) {
      bestDiscount = candidate;
    }
  }

  const appliedDiscountedPrice = bestDiscount.discountedPrice;
  return {
    appliedDiscountedPrice,
    appliedDiscountType: bestDiscount.discountType,
    discountAmount: Math.max(0, basePrice - appliedDiscountedPrice),
    effectivePrice: appliedDiscountedPrice,
  };
};

export interface ApproveManualRegistrationArguments {
  executiveUserId: null | string;
  expectedEventId?: string;
  onApproved?: (
    tx: Pick<DatabaseClient, 'insert' | 'select' | 'update'>,
    transition: ManualRegistrationApprovalTransition,
  ) => Effect.Effect<void, unknown, never>;
  registrationId: string;
  targetTenant: Pick<
    Tenant,
    | 'currency'
    | 'domain'
    | 'emailSenderEmail'
    | 'emailSenderName'
    | 'id'
    | 'name'
    | 'stripeAccountId'
  >;
}

export interface ManualRegistrationApprovalTransition {
  readonly eventId: string;
  readonly guestCount: number;
  readonly registrationId: string;
  readonly registrationOptionId: string;
  readonly statusAfter: 'CONFIRMED' | 'PENDING';
  readonly statusBefore: 'PENDING';
  readonly transactionId: null | string;
  readonly transactionStatus: 'pending' | null;
  readonly userId: string;
}

const buildRegistrationCheckoutParameters = ({
  appFee,
  currency,
  registrationId,
  snapshot,
  tenantId,
  transactionId,
}: {
  appFee: number;
  currency: typeof transactions.$inferSelect.currency;
  registrationId: string;
  snapshot: RegistrationCheckoutSnapshot;
  tenantId: string;
  transactionId: string;
}): Stripe.Checkout.SessionCreateParams => ({
  cancel_url: `${snapshot.eventUrl}?registrationStatus=cancel`,
  customer_email: snapshot.customerEmail,
  expires_at: snapshot.expiresAt,
  line_items: snapshot.lineItems.map((lineItem) => ({
    price_data: {
      currency,
      product_data: {
        name: lineItem.name,
      },
      unit_amount: lineItem.unitAmount,
    },
    ...(lineItem.taxRateId && { tax_rates: [lineItem.taxRateId] }),
    quantity: lineItem.quantity,
  })),
  metadata: {
    registrationId,
    tenantId,
    transactionId,
  },
  mode: 'payment',
  payment_intent_data: {
    application_fee_amount: appFee,
  },
  success_url: `${snapshot.eventUrl}?registrationStatus=success`,
});

export const decodeRegistrationCheckoutSnapshot = Effect.fn(
  'EventRegistrationService.decodeRegistrationCheckoutSnapshot',
)((snapshot: unknown, message: string) =>
  Schema.decodeUnknownEffect(RegistrationCheckoutSnapshotSchema)(snapshot).pipe(
    Effect.mapError(
      (cause) => new EventRegistrationInternalError({ cause, message }),
    ),
  ),
);

type RegistrationPaymentClaim = Pick<
  typeof transactions.$inferSelect,
  | 'appFee'
  | 'currency'
  | 'id'
  | 'stripeAccountId'
  | 'stripeCheckoutRequest'
  | 'stripeCheckoutSessionId'
  | 'stripeCheckoutUrl'
>;

const registrationPaymentClaimSelection = {
  appFee: transactions.appFee,
  currency: transactions.currency,
  id: transactions.id,
  stripeAccountId: transactions.stripeAccountId,
  stripeCheckoutRequest: transactions.stripeCheckoutRequest,
  stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
  stripeCheckoutUrl: transactions.stripeCheckoutUrl,
};

const resumeDirectRegistrationCheckout = Effect.fn(
  'EventRegistrationService.resumeDirectRegistrationCheckout',
)(function* ({
  eventId,
  paymentClaim,
  registrationId,
  tenantId,
}: {
  eventId: string;
  paymentClaim: RegistrationPaymentClaim;
  registrationId: string;
  tenantId: string;
}) {
  yield* Effect.annotateCurrentSpan({
    eventId,
    paymentClaim:
      paymentClaim.stripeCheckoutSessionId && paymentClaim.stripeCheckoutUrl
        ? 'ready'
        : 'resuming',
    registrationId,
    tenantId,
    transactionId: paymentClaim.id,
  });
  if (paymentClaim.stripeCheckoutSessionId && paymentClaim.stripeCheckoutUrl) {
    const claimStillActive = yield* Database.use((database) =>
      database.transaction((tx) =>
        Effect.gen(function* () {
          const lockedRegistrations = yield* tx
            .select({ status: eventRegistrations.status })
            .from(eventRegistrations)
            .where(
              and(
                eq(eventRegistrations.id, registrationId),
                eq(eventRegistrations.eventId, eventId),
                eq(eventRegistrations.tenantId, tenantId),
              ),
            )
            .for('update');
          const lockedClaims = yield* tx
            .select({
              stripeCheckoutCancellationRequestedAt:
                transactions.stripeCheckoutCancellationRequestedAt,
              stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
              stripeCheckoutUrl: transactions.stripeCheckoutUrl,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.id, paymentClaim.id),
                eq(transactions.eventRegistrationId, registrationId),
                eq(transactions.method, 'stripe'),
                eq(transactions.status, 'pending'),
                eq(transactions.tenantId, tenantId),
                eq(transactions.type, 'registration'),
              ),
            )
            .for('update');
          const lockedClaim = lockedClaims[0];
          return (
            lockedRegistrations[0]?.status === 'PENDING' &&
            lockedClaim?.stripeCheckoutCancellationRequestedAt === null &&
            lockedClaim.stripeCheckoutSessionId ===
              paymentClaim.stripeCheckoutSessionId &&
            lockedClaim.stripeCheckoutUrl === paymentClaim.stripeCheckoutUrl
          );
        }),
      ),
    );
    if (!claimStillActive) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message: 'Registration is no longer awaiting payment',
        }),
      );
    }
    return;
  }
  if (paymentClaim.appFee === null || !paymentClaim.stripeCheckoutRequest) {
    return yield* Effect.fail(
      new EventRegistrationInternalError({
        message:
          'Registration payment setup cannot be resumed; cancel the registration and register again',
      }),
    );
  }
  const checkoutRequestSnapshot = yield* decodeRegistrationCheckoutSnapshot(
    paymentClaim.stripeCheckoutRequest,
    'Registration payment setup cannot be resumed; cancel the registration and register again',
  );
  const stripeAccount = paymentClaim.stripeAccountId;
  if (!stripeAccount) {
    return yield* Effect.fail(
      new EventRegistrationInternalError({
        message: 'Stripe account not found',
      }),
    );
  }

  const releaseDirectCheckoutClaim = Effect.fn(
    'EventRegistrationService.resumeDirectRegistrationCheckout.releaseClaim',
  )((expectedStripeCheckoutSessionId: null | string) =>
    Database.use((database) =>
      database
        .transaction((tx) =>
          Effect.gen(function* () {
            const lockedRegistrations = yield* tx
              .select({
                guestCount: eventRegistrations.guestCount,
                registrationOptionId: eventRegistrations.registrationOptionId,
                status: eventRegistrations.status,
              })
              .from(eventRegistrations)
              .where(
                and(
                  eq(eventRegistrations.id, registrationId),
                  eq(eventRegistrations.tenantId, tenantId),
                  eq(eventRegistrations.eventId, eventId),
                ),
              )
              .for('update');
            const lockedRegistration = lockedRegistrations[0];
            const lockedClaims = yield* tx
              .select({
                method: transactions.method,
                status: transactions.status,
                stripeCheckoutCancellationRequestedAt:
                  transactions.stripeCheckoutCancellationRequestedAt,
                stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
                type: transactions.type,
              })
              .from(transactions)
              .where(
                and(
                  eq(transactions.id, paymentClaim.id),
                  eq(transactions.tenantId, tenantId),
                  eq(transactions.eventRegistrationId, registrationId),
                ),
              )
              .for('update');
            const lockedClaim = lockedClaims[0];
            if (
              lockedRegistration?.status === 'CANCELLED' &&
              lockedClaim?.status === 'cancelled'
            ) {
              return;
            }
            if (
              lockedRegistration?.status !== 'PENDING' ||
              lockedClaim?.method !== 'stripe' ||
              lockedClaim.status !== 'pending' ||
              lockedClaim.stripeCheckoutCancellationRequestedAt !== null ||
              (lockedClaim.stripeCheckoutSessionId !== null &&
                lockedClaim.stripeCheckoutSessionId !==
                  expectedStripeCheckoutSessionId) ||
              lockedClaim.type !== 'registration'
            ) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message: 'Failed to release direct checkout claim',
                }),
              );
            }

            const lockedAddonPurchases = yield* tx
              .select({
                addonId: eventRegistrationAddonPurchases.addonId,
                quantity: eventRegistrationAddonPurchases.quantity,
              })
              .from(eventRegistrationAddonPurchases)
              .where(
                eq(
                  eventRegistrationAddonPurchases.registrationId,
                  registrationId,
                ),
              )
              .for('update');
            const orderedAddonPurchases =
              orderRegistrationAddonPurchases(lockedAddonPurchases);

            const cancelledClaims = yield* tx
              .update(transactions)
              .set({ status: 'cancelled' })
              .where(
                and(
                  eq(transactions.id, paymentClaim.id),
                  eq(transactions.tenantId, tenantId),
                  eq(transactions.eventRegistrationId, registrationId),
                  eq(transactions.method, 'stripe'),
                  eq(transactions.status, 'pending'),
                  eq(transactions.type, 'registration'),
                  isNull(transactions.stripeCheckoutCancellationRequestedAt),
                  expectedStripeCheckoutSessionId === null
                    ? isNull(transactions.stripeCheckoutSessionId)
                    : or(
                        isNull(transactions.stripeCheckoutSessionId),
                        eq(
                          transactions.stripeCheckoutSessionId,
                          expectedStripeCheckoutSessionId,
                        ),
                      ),
                ),
              )
              .returning({ id: transactions.id });
            const cancelledRegistrations = yield* tx
              .update(eventRegistrations)
              .set({ status: 'CANCELLED' })
              .where(
                and(
                  eq(eventRegistrations.id, registrationId),
                  eq(eventRegistrations.tenantId, tenantId),
                  eq(eventRegistrations.status, 'PENDING'),
                ),
              )
              .returning({ id: eventRegistrations.id });
            if (
              cancelledClaims.length !== 1 ||
              cancelledRegistrations.length !== 1
            ) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message: 'Failed to release direct checkout claim',
                }),
              );
            }

            const requestedSpotCount = registrationSpotCount(
              lockedRegistration.guestCount,
            );
            const releasedOptions = yield* tx
              .update(eventRegistrationOptions)
              .set({
                reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${requestedSpotCount}`,
              })
              .where(
                and(
                  eq(
                    eventRegistrationOptions.id,
                    lockedRegistration.registrationOptionId,
                  ),
                  eq(eventRegistrationOptions.eventId, eventId),
                  sql`${eventRegistrationOptions.reservedSpots} >= ${requestedSpotCount}`,
                ),
              )
              .returning({ id: eventRegistrationOptions.id });
            if (releasedOptions.length !== 1) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message: 'Failed to release registration capacity',
                }),
              );
            }

            for (const addOnPurchase of orderedAddonPurchases) {
              const releasedAddOns = yield* tx
                .update(eventAddons)
                .set({
                  totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${addOnPurchase.quantity}`,
                })
                .where(
                  and(
                    eq(eventAddons.id, addOnPurchase.addonId),
                    eq(eventAddons.eventId, eventId),
                  ),
                )
                .returning({ id: eventAddons.id });
              if (releasedAddOns.length !== 1) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message: 'Failed to release registration add-on stock',
                  }),
                );
              }
            }
          }),
        )
        .pipe(
          Effect.catch((error) =>
            error instanceof EventRegistrationInternalError
              ? Effect.fail(error)
              : Effect.die(error),
          ),
        ),
    ),
  );

  const createSessionEffect = createHostedCheckoutSession(
    buildRegistrationCheckoutParameters({
      appFee: paymentClaim.appFee,
      currency: paymentClaim.currency,
      registrationId,
      snapshot: checkoutRequestSnapshot,
      tenantId,
      transactionId: paymentClaim.id,
    }),
    {
      idempotencyKey: buildCheckoutSessionIdempotencyKey({
        registrationId,
        transactionId: paymentClaim.id,
      }),
      stripeAccount,
    },
  ).pipe(
    Effect.mapError(
      (cause) =>
        new EventRegistrationInternalError({
          cause,
          message:
            'Payment setup is still pending. Retry registration or cancel it.',
        }),
    ),
  );
  const session = yield* createSessionEffect.pipe(
    Effect.catch((error) =>
      isDefinitiveCheckoutSessionCreateFailure(error.cause)
        ? releaseDirectCheckoutClaim(null).pipe(
            Effect.andThen(Effect.fail(error)),
          )
        : Effect.fail(error),
    ),
  );
  if (!session.url) {
    const missingUrlError = new EventRegistrationInternalError({
      message: 'Stripe checkout session did not provide a payment URL',
    });
    return yield* expireCheckoutSession(session.id, stripeAccount).pipe(
      Effect.andThen(releaseDirectCheckoutClaim(session.id)),
      Effect.andThen(Effect.fail(missingUrlError)),
    );
  }

  const reconcileDirectBinding = Effect.fn(
    'EventRegistrationService.resumeDirectRegistrationCheckout.reconcileBinding',
  )(() =>
    Database.use((database) =>
      database
        .transaction((tx) =>
          Effect.gen(function* () {
            const lockedRegistrations = yield* tx
              .select({ status: eventRegistrations.status })
              .from(eventRegistrations)
              .where(
                and(
                  eq(eventRegistrations.id, registrationId),
                  eq(eventRegistrations.eventId, eventId),
                  eq(eventRegistrations.tenantId, tenantId),
                ),
              )
              .for('update');
            const lockedClaims = yield* tx
              .select({
                method: transactions.method,
                status: transactions.status,
                stripeCheckoutCancellationRequestedAt:
                  transactions.stripeCheckoutCancellationRequestedAt,
                stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
                type: transactions.type,
              })
              .from(transactions)
              .where(
                and(
                  eq(transactions.id, paymentClaim.id),
                  eq(transactions.eventRegistrationId, registrationId),
                  eq(transactions.tenantId, tenantId),
                ),
              )
              .for('update');
            const lockedClaim = lockedClaims[0];
            if (
              lockedRegistrations[0]?.status !== 'PENDING' ||
              lockedClaim?.method !== 'stripe' ||
              lockedClaim.status !== 'pending' ||
              lockedClaim.stripeCheckoutCancellationRequestedAt !== null ||
              lockedClaim.type !== 'registration'
            ) {
              return { _tag: 'Conflict' } as const;
            }
            if (lockedClaim.stripeCheckoutSessionId === session.id) {
              return { _tag: 'Bound' } as const;
            }
            return lockedClaim.stripeCheckoutSessionId === null
              ? ({ _tag: 'Unbound' } as const)
              : ({ _tag: 'Conflict' } as const);
          }),
        )
        .pipe(
          Effect.catch((error) =>
            error instanceof EventRegistrationInternalError
              ? Effect.fail(error)
              : Effect.die(error),
          ),
        ),
    ),
  );

  const bindingResult = yield* Database.use((database) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          const lockedRegistrations = yield* tx
            .select({ status: eventRegistrations.status })
            .from(eventRegistrations)
            .where(
              and(
                eq(eventRegistrations.id, registrationId),
                eq(eventRegistrations.eventId, eventId),
                eq(eventRegistrations.tenantId, tenantId),
              ),
            )
            .for('update');
          if (lockedRegistrations[0]?.status !== 'PENDING') {
            return { _tag: 'RegistrationUnavailable' as const };
          }

          const lockedClaims = yield* tx
            .select({
              stripeCheckoutCancellationRequestedAt:
                transactions.stripeCheckoutCancellationRequestedAt,
              stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.id, paymentClaim.id),
                eq(transactions.eventRegistrationId, registrationId),
                eq(transactions.method, 'stripe'),
                eq(transactions.status, 'pending'),
                eq(transactions.tenantId, tenantId),
                eq(transactions.type, 'registration'),
              ),
            )
            .for('update');
          const lockedClaim = lockedClaims[0];
          if (
            !lockedClaim ||
            lockedClaim.stripeCheckoutCancellationRequestedAt !== null
          ) {
            return { _tag: 'RegistrationUnavailable' as const };
          }
          if (
            lockedClaim.stripeCheckoutSessionId &&
            lockedClaim.stripeCheckoutSessionId !== session.id
          ) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message:
                  'Registration payment claim is bound to another checkout session',
              }),
            );
          }
          if (lockedClaim.stripeCheckoutSessionId === session.id) {
            return { _tag: 'Bound' } as const;
          }

          const boundClaims = yield* tx
            .update(transactions)
            .set({
              stripeCheckoutReconcileAttempts: 0,
              stripeCheckoutReconcileLastError: null,
              stripeCheckoutReconcileLeaseExpiresAt: null,
              stripeCheckoutReconcileLeaseId: null,
              stripeCheckoutReconcileNextAt:
                registrationCheckoutInitialReconcileAt(),
              stripeCheckoutSessionId: session.id,
              stripeCheckoutUrl: session.url,
              stripePaymentIntentId:
                typeof session.payment_intent === 'string'
                  ? session.payment_intent
                  : session.payment_intent?.id,
            })
            .where(
              and(
                eq(transactions.id, paymentClaim.id),
                eq(transactions.eventRegistrationId, registrationId),
                eq(transactions.method, 'stripe'),
                eq(transactions.status, 'pending'),
                eq(transactions.tenantId, tenantId),
                eq(transactions.type, 'registration'),
                isNull(transactions.stripeCheckoutCancellationRequestedAt),
                isNull(transactions.stripeCheckoutSessionId),
              ),
            )
            .returning({ id: transactions.id });
          if (boundClaims.length !== 1) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message: 'Failed to bind stripe checkout session',
              }),
            );
          }
          return { _tag: 'Bound' } as const;
        }),
      )
      .pipe(
        Effect.catch((error) =>
          error instanceof EventRegistrationInternalError
            ? Effect.fail(error)
            : Effect.fail(
                new EventRegistrationInternalError({
                  cause: error,
                  message: 'Failed to persist registration checkout',
                }),
              ),
        ),
      ),
  ).pipe(
    Effect.catchCause((bindingCause) =>
      reconcileDirectBinding().pipe(
        Effect.catchCause((reconciliationCause) =>
          Effect.logError(
            'Failed to reconcile direct checkout binding; retaining payment claim',
          ).pipe(
            Effect.annotateLogs({
              reconciliationCause,
              registrationId,
              stripeCheckoutSessionId: session.id,
              transactionId: paymentClaim.id,
            }),
            Effect.andThen(Effect.failCause(bindingCause)),
          ),
        ),
        Effect.flatMap((reconciliation) => {
          if (reconciliation._tag === 'Bound') {
            return Effect.succeed({ _tag: 'Bound' } as const);
          }
          if (reconciliation._tag === 'Conflict') {
            return Effect.failCause(bindingCause);
          }
          return expireCheckoutSession(session.id, stripeAccount).pipe(
            Effect.catchCause((expiryCause) =>
              Effect.logError(
                'Failed to expire unbound direct checkout session; retaining payment claim',
              ).pipe(
                Effect.annotateLogs({
                  expiryCause,
                  registrationId,
                  stripeCheckoutSessionId: session.id,
                  transactionId: paymentClaim.id,
                }),
                Effect.andThen(Effect.failCause(bindingCause)),
              ),
            ),
            Effect.andThen(releaseDirectCheckoutClaim(session.id)),
            Effect.andThen(Effect.failCause(bindingCause)),
          );
        }),
      ),
    ),
  );

  if (bindingResult._tag === 'RegistrationUnavailable') {
    yield* expireCheckoutSession(session.id, stripeAccount).pipe(
      Effect.mapError(
        (cause) =>
          new EventRegistrationInternalError({
            cause,
            message:
              'Registration was cancelled, but its checkout session could not be expired',
          }),
      ),
    );
    return yield* Effect.fail(
      new EventRegistrationConflictError({
        message: 'Registration is no longer awaiting payment',
      }),
    );
  }
});

interface JoinWaitlistArguments {
  answers?: readonly RegistrationQuestionAnswerInput[] | undefined;
  eventId: string;
  registrationOptionId: string;
  tenant: Partial<Pick<Tenant, 'maxActiveRegistrationsPerUser'>> &
    Pick<Tenant, 'id'>;
  user: Pick<User, 'id' | 'roleIds'>;
}

interface RegisterForEventArguments {
  addOns?: readonly RegistrationAddonInput[] | undefined;
  answers?: readonly RegistrationQuestionAnswerInput[] | undefined;
  eventId: string;
  guestCount: number;
  registrationOptionId: string;
  tenant: Partial<
    Pick<
      Tenant,
      | 'emailSenderEmail'
      | 'emailSenderName'
      | 'maxActiveRegistrationsPerUser'
      | 'name'
    >
  > &
    Pick<Tenant, 'currency' | 'domain' | 'id' | 'stripeAccountId'>;
  user: Partial<Pick<User, 'communicationEmail'>> &
    Pick<User, 'email' | 'id' | 'roleIds'>;
}

interface RegistrationAddonInput {
  addOnId: string;
  quantity: number;
}

interface RegistrationAddonRecord {
  addOnId: string;
  allowMultiple: boolean;
  allowPurchaseDuringRegistration: boolean;
  includedQuantity: number;
  maxQuantityPerUser: number;
  optionalPurchaseQuantity: number;
  price: number;
  stripeTaxRateId: null | string;
  taxRateDisplayName: null | string;
  taxRateInclusive: boolean | null;
  taxRatePercentage: null | string;
  title: string;
  totalAvailableQuantity: number;
}

interface RegistrationTaxConfigurationAddonExpectation {
  readonly addOnId: string;
  readonly requiresTaxRate: boolean;
  readonly stripeTaxRateId: null | string;
}

interface RegistrationTaxRateSnapshot {
  readonly displayName: null | string;
  readonly inclusive: boolean;
  readonly percentage: string;
  readonly stripeTaxRateId: string;
}

const registrationTaxConfigurationChanged = () =>
  new EventRegistrationConflictError({
    message:
      'Registration tax configuration changed before the payment terms could be reserved',
  });

/**
 * Locks the priced option, every selected/included add-on, and the exact tax
 * rows owned by the tenant's already-locked Stripe account. Callers must lock
 * the tenant row first so account replacement and monetary reservation share
 * one serialization boundary.
 */
export const lockCurrentRegistrationTaxConfiguration = Effect.fn(
  'EventRegistration.lockCurrentRegistrationTaxConfiguration',
)(function* (
  database: Pick<DatabaseClient, 'select'>,
  input: {
    readonly addOns: readonly RegistrationTaxConfigurationAddonExpectation[];
    readonly eventId: string;
    readonly optionRequiresTaxRate: boolean;
    readonly optionStripeTaxRateId: null | string;
    readonly registrationOptionId: string;
    readonly stripeAccountId: string;
    readonly tenantId: string;
  },
) {
  const lockedOptions = yield* database
    .select({
      stripeTaxRateId: eventRegistrationOptions.stripeTaxRateId,
    })
    .from(eventRegistrationOptions)
    .where(
      and(
        eq(eventRegistrationOptions.id, input.registrationOptionId),
        eq(eventRegistrationOptions.eventId, input.eventId),
      ),
    )
    .for('update')
    .pipe(Effect.orDie);
  const lockedOption = lockedOptions[0];
  if (
    !lockedOption ||
    lockedOption.stripeTaxRateId !== input.optionStripeTaxRateId ||
    (input.optionRequiresTaxRate && !lockedOption.stripeTaxRateId)
  ) {
    return yield* Effect.fail(registrationTaxConfigurationChanged());
  }

  const expectedAddOnById = new Map(
    input.addOns.map((addOn) => [addOn.addOnId, addOn]),
  );
  if (expectedAddOnById.size !== input.addOns.length) {
    return yield* Effect.fail(registrationTaxConfigurationChanged());
  }
  const lockedAddOns =
    input.addOns.length === 0
      ? []
      : yield* database
          .select({
            addOnId: eventAddons.id,
            stripeTaxRateId: eventAddons.stripeTaxRateId,
          })
          .from(eventAddons)
          .where(
            and(
              eq(eventAddons.eventId, input.eventId),
              inArray(
                eventAddons.id,
                input.addOns.map((addOn) => addOn.addOnId),
              ),
            ),
          )
          .orderBy(eventAddons.id)
          .for('update')
          .pipe(Effect.orDie);
  if (
    lockedAddOns.length !== input.addOns.length ||
    lockedAddOns.some((addOn) => {
      const expected = expectedAddOnById.get(addOn.addOnId);
      return (
        !expected ||
        addOn.stripeTaxRateId !== expected.stripeTaxRateId ||
        (expected.requiresTaxRate && !addOn.stripeTaxRateId)
      );
    })
  ) {
    return yield* Effect.fail(registrationTaxConfigurationChanged());
  }

  const taxRateIds = [
    ...new Set(
      [
        lockedOption.stripeTaxRateId,
        ...lockedAddOns.map((addOn) => addOn.stripeTaxRateId),
      ].filter((taxRateId): taxRateId is string => taxRateId !== null),
    ),
  ];
  if (taxRateIds.length === 0)
    return new Map<string, RegistrationTaxRateSnapshot>();

  const lockedTaxRates = yield* database
    .select({
      displayName: tenantStripeTaxRates.displayName,
      inclusive: tenantStripeTaxRates.inclusive,
      percentage: tenantStripeTaxRates.percentage,
      stripeTaxRateId: tenantStripeTaxRates.stripeTaxRateId,
    })
    .from(tenantStripeTaxRates)
    .where(
      and(
        eq(tenantStripeTaxRates.tenantId, input.tenantId),
        eq(tenantStripeTaxRates.stripeAccountId, input.stripeAccountId),
        eq(tenantStripeTaxRates.active, true),
        eq(tenantStripeTaxRates.inclusive, true),
        inArray(tenantStripeTaxRates.stripeTaxRateId, taxRateIds),
      ),
    )
    .orderBy(tenantStripeTaxRates.stripeTaxRateId)
    .for('update')
    .pipe(Effect.orDie);
  if (lockedTaxRates.length !== taxRateIds.length) {
    return yield* Effect.fail(registrationTaxConfigurationChanged());
  }

  const taxRateById = new Map<string, RegistrationTaxRateSnapshot>();
  for (const taxRate of lockedTaxRates) {
    if (taxRate.percentage === null) {
      return yield* Effect.fail(registrationTaxConfigurationChanged());
    }
    taxRateById.set(taxRate.stripeTaxRateId, {
      displayName: taxRate.displayName,
      inclusive: taxRate.inclusive,
      percentage: taxRate.percentage,
      stripeTaxRateId: taxRate.stripeTaxRateId,
    });
  }
  return taxRateById;
});

interface RegistrationQuestionAnswerInput {
  answer: string;
  questionId: string;
}

interface RegistrationQuestionRecord {
  id: string;
  required: boolean;
}

const compareCodeUnitStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const orderRegistrationAddonPurchases = <
  Purchase extends { readonly addonId: string },
>(
  purchases: readonly Purchase[],
): Purchase[] =>
  purchases.toSorted((left, right) =>
    compareCodeUnitStrings(left.addonId, right.addonId),
  );

export const validateRegistrationQuestionAnswers = ({
  answers,
  questions,
}: {
  answers: readonly RegistrationQuestionAnswerInput[] | undefined;
  questions: readonly RegistrationQuestionRecord[];
}): readonly { answer: string; questionId: string }[] => {
  const normalizedAnswers = new Map<string, string>();
  for (const answer of answers ?? []) {
    normalizedAnswers.set(answer.questionId, answer.answer.trim());
  }

  const questionIds = new Set(questions.map((question) => question.id));
  for (const questionId of normalizedAnswers.keys()) {
    if (!questionIds.has(questionId)) {
      throw new EventRegistrationConflictError({
        message: 'Registration question does not belong to this option',
      });
    }
  }

  for (const question of questions) {
    if (question.required && !normalizedAnswers.get(question.id)) {
      throw new EventRegistrationConflictError({
        message: 'Required registration question is missing',
      });
    }
  }

  return [...normalizedAnswers]
    .filter(([, answer]) => answer.length > 0)
    .map(([questionId, answer]) => ({
      answer,
      questionId,
    }));
};

export const validateRegistrationAddons = ({
  addOns,
  availableAddOns,
}: {
  addOns: readonly RegistrationAddonInput[] | undefined;
  availableAddOns: readonly RegistrationAddonRecord[];
}): readonly (RegistrationAddonRecord & {
  fulfilledQuantity: number;
  selectedQuantity: number;
})[] => {
  const availableAddOnById = new Map(
    availableAddOns.map((addOn) => [addOn.addOnId, addOn]),
  );
  const selectedAddOns = new Map<string, number>();

  for (const addOn of addOns ?? []) {
    if (!Number.isInteger(addOn.quantity) || addOn.quantity < 0) {
      throw new EventRegistrationConflictError({
        message: 'Add-on quantity must be a non-negative integer',
      });
    }
    if (addOn.quantity === 0) {
      continue;
    }
    selectedAddOns.set(
      addOn.addOnId,
      (selectedAddOns.get(addOn.addOnId) ?? 0) + addOn.quantity,
    );
  }

  for (const selectedAddOnId of selectedAddOns.keys()) {
    if (!availableAddOnById.has(selectedAddOnId)) {
      throw new EventRegistrationConflictError({
        message: 'Add-on is not available for this registration option',
      });
    }
  }

  return availableAddOns
    .toSorted((left, right) =>
      compareCodeUnitStrings(left.addOnId, right.addOnId),
    )
    .flatMap((availableAddOn) => {
      const selectedQuantity = selectedAddOns.get(availableAddOn.addOnId) ?? 0;
      if (availableAddOn.includedQuantity === 0 && selectedQuantity === 0) {
        return [];
      }
      if (
        selectedQuantity > 0 &&
        !availableAddOn.allowPurchaseDuringRegistration
      ) {
        throw new EventRegistrationConflictError({
          message: 'Add-on is not available during registration',
        });
      }
      if (!availableAddOn.allowMultiple && selectedQuantity > 1) {
        throw new EventRegistrationConflictError({
          message: 'Add-on can only be selected once',
        });
      }
      if (selectedQuantity > availableAddOn.maxQuantityPerUser) {
        throw new EventRegistrationConflictError({
          message: 'Add-on quantity exceeds the per-user limit',
        });
      }
      if (selectedQuantity > availableAddOn.optionalPurchaseQuantity) {
        throw new EventRegistrationConflictError({
          message: 'Add-on quantity exceeds this registration option limit',
        });
      }
      const fulfilledQuantity =
        availableAddOn.includedQuantity + selectedQuantity;
      if (fulfilledQuantity > availableAddOn.totalAvailableQuantity) {
        throw new EventRegistrationConflictError({
          message: 'Add-on quantity is no longer available',
        });
      }

      return [
        {
          ...availableAddOn,
          fulfilledQuantity,
          selectedQuantity,
        },
      ];
    });
};

export class EventRegistrationService extends Context.Service<EventRegistrationService>()(
  '@server/effect/rpc/handlers/events/EventRegistrationService',
  {
    make: Effect.sync(() => {
      const approveManualRegistration = Effect.fn(
        'EventRegistrationService.approveManualRegistration',
      )(function* ({
        executiveUserId,
        expectedEventId,
        onApproved = () => Effect.void,
        registrationId,
        targetTenant: tenant,
      }: ApproveManualRegistrationArguments) {
        yield* Effect.annotateCurrentSpan({
          ...(expectedEventId && { eventId: expectedEventId }),
          registrationId,
          tenantId: tenant.id,
        });
        const configProvider = yield* ConfigProvider.ConfigProvider;
        const serverEnvironment = yield* serverConfig
          .parse(configProvider)
          .pipe(
            Effect.mapError(
              (error) =>
                new EventRegistrationInternalError({
                  message: `Invalid server configuration:\n${formatConfigError(error)}`,
                }),
            ),
          );
        const pinnedNowIso = Option.getOrUndefined(
          serverEnvironment.E2E_NOW_ISO,
        );
        const now = getServerNow(pinnedNowIso).toJSDate();
        yield* tenantOutboundRootUrl(tenant).pipe(
          Effect.mapError(
            (cause) =>
              new EventRegistrationInternalError({
                cause,
                message: 'Invalid tenant domain configuration',
              }),
          ),
        );

        const registration = yield* databaseEffect((database) =>
          database.query.eventRegistrations.findFirst({
            columns: {
              appliedDiscountedPrice: true,
              appliedDiscountType: true,
              basePriceAtRegistration: true,
              discountAmount: true,
              eventId: true,
              guestCount: true,
              id: true,
              registrationOptionId: true,
              status: true,
              userId: true,
            },
            where: {
              ...(expectedEventId && { eventId: expectedEventId }),
              id: registrationId,
              tenantId: tenant.id,
            },
            with: {
              addonPurchases: {
                columns: {
                  addonId: true,
                  id: true,
                  purchasedQuantity: true,
                  quantity: true,
                  taxRateDisplayName: true,
                  taxRateInclusive: true,
                  taxRatePercentage: true,
                  unitPrice: true,
                },
                with: {
                  addOn: {
                    columns: {
                      stripeTaxRateId: true,
                      title: true,
                    },
                  },
                },
              },
              event: {
                columns: {
                  start: true,
                  status: true,
                  tenantId: true,
                  title: true,
                },
              },
              registrationOption: {
                columns: {
                  eventId: true,
                  id: true,
                  isPaid: true,
                  price: true,
                  registrationMode: true,
                  stripeTaxRateId: true,
                },
              },
              user: {
                columns: {
                  communicationEmail: true,
                  email: true,
                },
              },
            },
          }),
        );

        if (!registration) {
          return yield* Effect.fail(
            new EventRegistrationNotFoundError({
              message: 'Registration not found',
            }),
          );
        }
        if (
          !registration.event ||
          !registration.registrationOption ||
          !registration.user
        ) {
          return yield* Effect.fail(
            new EventRegistrationInternalError({
              message: 'Registration relation missing',
            }),
          );
        }
        if (
          registration.event.tenantId !== tenant.id ||
          registration.registrationOption.eventId !== registration.eventId
        ) {
          return yield* Effect.fail(
            new EventRegistrationNotFoundError({
              message: 'Registration not found',
            }),
          );
        }
        const eventId = registration.eventId;
        yield* Effect.annotateCurrentSpan({ eventId });
        if (registration.event.status !== 'APPROVED') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Event is not open for registration approval',
            }),
          );
        }
        if (
          registration.status !== 'PENDING' ||
          registration.registrationOption.registrationMode !== 'application'
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                'Only pending manual approval registrations can be approved',
            }),
          );
        }
        const registrationOption = registration.registrationOption;
        const orderedAddonPurchases = orderRegistrationAddonPurchases(
          registration.addonPurchases,
        );
        const registeredSpotCount = registrationSpotCount(
          registration.guestCount,
        );
        const selectedAddonTotalPrice = orderedAddonPurchases.reduce(
          (total, purchase) =>
            total + purchase.unitPrice * purchase.purchasedQuantity,
          0,
        );
        const selectedTaxRateId =
          registrationOption.stripeTaxRateId ?? undefined;
        const tenantStripeAccountId = tenant.stripeAccountId;
        const selectedTaxRate =
          selectedTaxRateId && tenantStripeAccountId
            ? yield* databaseEffect((database) =>
                database.query.tenantStripeTaxRates.findFirst({
                  columns: {
                    displayName: true,
                    inclusive: true,
                    percentage: true,
                  },
                  where: {
                    active: true,
                    inclusive: true,
                    stripeAccountId: tenantStripeAccountId,
                    stripeTaxRateId: selectedTaxRateId,
                    tenantId: tenant.id,
                  },
                }),
              )
            : undefined;
        if (
          selectedTaxRateId &&
          (!selectedTaxRate || selectedTaxRate.percentage === null)
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                'Registration tax configuration is unavailable for the connected Stripe account',
            }),
          );
        }
        const addOnTaxExpectations: RegistrationTaxConfigurationAddonExpectation[] =
          [];
        for (const purchase of orderedAddonPurchases) {
          if (!purchase.addOn) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message: 'Registration add-on relation missing',
              }),
            );
          }
          addOnTaxExpectations.push({
            addOnId: purchase.addonId,
            requiresTaxRate:
              purchase.unitPrice > 0 && purchase.purchasedQuantity > 0,
            stripeTaxRateId: purchase.addOn.stripeTaxRateId,
          });
        }

        const basePrice = registrationOption.isPaid
          ? registrationOption.price
          : 0;
        let discountResolution: DiscountResolution =
          noDiscountResolution(basePrice);
        const cards = yield* databaseEffect((database) =>
          database.query.userDiscountCards.findMany({
            columns: {
              type: true,
              validTo: true,
            },
            where: {
              status: 'verified',
              tenantId: tenant.id,
              userId: registration.userId,
            },
          }),
        );
        if (cards.length > 0) {
          const tenantRecord = yield* databaseEffect((database) =>
            database.query.tenants.findFirst({
              columns: {
                discountProviders: true,
              },
              where: { id: tenant.id },
            }),
          );
          const providerConfig: TenantDiscountProviders =
            resolveTenantDiscountProviders(tenantRecord?.discountProviders);
          const enabledTypes = new Set(
            Object.entries(providerConfig)
              .filter(([, provider]) => provider?.status === 'enabled')
              .map(([key]) => key),
          );
          const discounts = yield* databaseEffect((database) =>
            database.query.eventRegistrationOptionDiscounts.findMany({
              columns: {
                discountedPrice: true,
                discountType: true,
              },
              where: { registrationOptionId: registrationOption.id },
            }),
          );
          discountResolution = resolveDiscount({
            basePrice,
            cards,
            discounts,
            enabledTypes,
            eventStart: registration.event.start,
          });
        }

        const {
          appliedDiscountedPrice,
          appliedDiscountType,
          discountAmount,
          effectivePrice,
        } = discountResolution;
        const effectiveTotalPrice =
          effectivePrice +
          basePrice * registration.guestCount +
          selectedAddonTotalPrice;
        const requiresCheckout = effectiveTotalPrice > 0;
        const appFee = Math.round(effectiveTotalPrice * 0.035);
        const eventUrl = yield* tenantOutboundUrl(
          tenant,
          `/events/${encodeURIComponent(eventId)}`,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new EventRegistrationInternalError({
                cause,
                message:
                  'Tenant event URL is invalid for registration approval',
              }),
          ),
        );
        const notificationEmail =
          registration.user.communicationEmail?.trim() ||
          registration.user.email;
        const checkoutExpiresAt = buildCheckoutSessionExpiresAt(24 * 60, {
          pinnedNowIso,
        });
        const checkoutLineItems: RegistrationCheckoutLineItemSnapshot[] = [];
        if (effectivePrice > 0) {
          checkoutLineItems.push({
            name: `Registration fee for ${registration.event.title}`,
            quantity: 1,
            ...(selectedTaxRateId && { taxRateId: selectedTaxRateId }),
            unitAmount: effectivePrice,
          });
        }
        if (registration.guestCount > 0) {
          if (
            effectivePrice === registrationOption.price &&
            checkoutLineItems.length === 1
          ) {
            checkoutLineItems[0] = {
              ...checkoutLineItems[0],
              quantity: registeredSpotCount,
            };
          } else {
            checkoutLineItems.push({
              name: `Guest registration fee for ${registration.event.title}`,
              quantity: registration.guestCount,
              ...(selectedTaxRateId && { taxRateId: selectedTaxRateId }),
              unitAmount: registrationOption.price,
            });
          }
        }
        for (const addOnPurchase of registration.addonPurchases) {
          if (addOnPurchase.unitPrice <= 0 || !addOnPurchase.addOn) {
            continue;
          }
          checkoutLineItems.push({
            addonId: addOnPurchase.addonId,
            allocationKey: `addon-purchase:${addOnPurchase.id}`,
            kind: 'addon',
            name: `${addOnPurchase.addOn.title} add-on for ${registration.event.title}`,
            quantity: addOnPurchase.purchasedQuantity,
            ...(addOnPurchase.addOn.stripeTaxRateId && {
              taxRateId: addOnPurchase.addOn.stripeTaxRateId,
            }),
            unitAmount: addOnPurchase.unitPrice,
          });
        }
        const checkoutRequest = {
          customerEmail: registration.user.email,
          eventTitle: registration.event.title,
          eventUrl,
          expiresAt: checkoutExpiresAt,
          lineItems: checkoutLineItems,
          notificationEmail,
        } satisfies RegistrationCheckoutSnapshot;
        const candidateTransactionId = createId();
        const claimSelection = registrationPaymentClaimSelection;
        const approvalTransition = (
          statusAfter: ManualRegistrationApprovalTransition['statusAfter'],
          transactionId: null | string,
        ): ManualRegistrationApprovalTransition => ({
          eventId,
          guestCount: registration.guestCount,
          registrationId: registration.id,
          registrationOptionId: registration.registrationOptionId,
          statusAfter,
          statusBefore: 'PENDING',
          transactionId,
          transactionStatus: transactionId ? 'pending' : null,
          userId: registration.userId,
        });

        const approvalResult = yield* Database.use((database) =>
          database
            .transaction((tx) =>
              Effect.gen(function* () {
                const lockedRegistrations = yield* tx
                  .select({ status: eventRegistrations.status })
                  .from(eventRegistrations)
                  .where(
                    and(
                      eq(eventRegistrations.id, registration.id),
                      eq(eventRegistrations.tenantId, tenant.id),
                      eq(eventRegistrations.eventId, eventId),
                    ),
                  )
                  .for('update');
                const lockedRegistration = lockedRegistrations[0];
                if (!lockedRegistration) {
                  return yield* Effect.fail(
                    new EventRegistrationNotFoundError({
                      message: 'Registration not found',
                    }),
                  );
                }
                if (lockedRegistration.status !== 'PENDING') {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message:
                        'Only pending manual approval registrations can be approved',
                    }),
                  );
                }

                const hasTaxConfiguration =
                  selectedTaxRateId !== undefined ||
                  addOnTaxExpectations.some(
                    (addOn) => addOn.stripeTaxRateId !== null,
                  );
                const mustLockStripeAccount =
                  requiresCheckout || hasTaxConfiguration;
                const lockedStripeAccount = mustLockStripeAccount
                  ? yield* lockTenantStripeAccount(tx, tenant.id)
                  : undefined;
                if (mustLockStripeAccount && !lockedStripeAccount) {
                  return yield* Effect.fail(
                    requiresCheckout
                      ? new EventRegistrationInternalError({
                          message: 'Stripe account not found',
                        })
                      : new EventRegistrationConflictError({
                          message:
                            'Registration tax configuration is unavailable because Stripe is not connected',
                        }),
                  );
                }

                const existingClaims = yield* tx
                  .select(claimSelection)
                  .from(transactions)
                  .where(
                    and(
                      eq(transactions.eventRegistrationId, registration.id),
                      eq(transactions.method, 'stripe'),
                      eq(transactions.status, 'pending'),
                      eq(transactions.tenantId, tenant.id),
                      eq(transactions.type, 'registration'),
                    ),
                  )
                  .for('update');
                const existingClaim = existingClaims[0];
                if (existingClaim) {
                  yield* tx
                    .update(eventRegistrationAddonPurchaseLots)
                    .set({ sourceTransactionId: existingClaim.id })
                    .where(
                      and(
                        eq(
                          eventRegistrationAddonPurchaseLots.registrationId,
                          registration.id,
                        ),
                        eq(
                          eventRegistrationAddonPurchaseLots.tenantId,
                          tenant.id,
                        ),
                        isNull(
                          eventRegistrationAddonPurchaseLots.sourceTransactionId,
                        ),
                        isNull(
                          eventRegistrationAddonPurchaseLots.paymentAllocationFinalizedAt,
                        ),
                      ),
                    );
                  return {
                    _tag: 'PaymentClaim' as const,
                    claim: existingClaim,
                  };
                }

                const lockedTaxRateById = lockedStripeAccount
                  ? yield* lockCurrentRegistrationTaxConfiguration(tx, {
                      addOns: addOnTaxExpectations,
                      eventId,
                      optionRequiresTaxRate: registrationOption.isPaid,
                      optionStripeTaxRateId: registrationOption.stripeTaxRateId,
                      registrationOptionId: registrationOption.id,
                      stripeAccountId: lockedStripeAccount,
                      tenantId: tenant.id,
                    })
                  : new Map<string, RegistrationTaxRateSnapshot>();
                const lockedSelectedTaxRate = selectedTaxRateId
                  ? lockedTaxRateById.get(selectedTaxRateId)
                  : undefined;

                if (requiresCheckout) {
                  const insertedClaims = yield* tx
                    .insert(transactions)
                    .values({
                      amount: effectiveTotalPrice,
                      appFee,
                      comment: `Registration approval for event ${registration.event.title} ${registration.eventId}`,
                      currency: tenant.currency,
                      eventId: registration.eventId,
                      eventRegistrationId: registration.id,
                      executiveUserId,
                      id: candidateTransactionId,
                      method: 'stripe',
                      status: 'pending',
                      stripeAccountId: lockedStripeAccount,
                      stripeCheckoutRequest: checkoutRequest,
                      targetUserId: registration.userId,
                      tenantId: tenant.id,
                      type: 'registration',
                    })
                    .onConflictDoNothing()
                    .returning(claimSelection);
                  const insertedClaim = insertedClaims[0];
                  if (!insertedClaim) {
                    const conflictingClaims = yield* tx
                      .select(claimSelection)
                      .from(transactions)
                      .where(
                        and(
                          eq(transactions.eventRegistrationId, registration.id),
                          eq(transactions.method, 'stripe'),
                          eq(transactions.status, 'pending'),
                          eq(transactions.tenantId, tenant.id),
                          eq(transactions.type, 'registration'),
                        ),
                      )
                      .for('update');
                    const conflictingClaim = conflictingClaims[0];
                    if (conflictingClaim) {
                      return {
                        _tag: 'PaymentClaim' as const,
                        claim: conflictingClaim,
                      };
                    }
                    return yield* Effect.fail(
                      new EventRegistrationInternalError({
                        message: 'Failed to create registration payment claim',
                      }),
                    );
                  }

                  yield* Effect.annotateCurrentSpan({
                    paymentClaim: 'created',
                    transactionId: insertedClaim.id,
                  });
                  yield* tx
                    .update(eventRegistrationAddonPurchaseLots)
                    .set({ sourceTransactionId: insertedClaim.id })
                    .where(
                      and(
                        eq(
                          eventRegistrationAddonPurchaseLots.registrationId,
                          registration.id,
                        ),
                        eq(
                          eventRegistrationAddonPurchaseLots.tenantId,
                          tenant.id,
                        ),
                        isNull(
                          eventRegistrationAddonPurchaseLots.sourceTransactionId,
                        ),
                        isNull(
                          eventRegistrationAddonPurchaseLots.paymentAllocationFinalizedAt,
                        ),
                      ),
                    );
                }

                const updatedOptions = yield* tx
                  .update(eventRegistrationOptions)
                  .set(
                    requiresCheckout
                      ? {
                          reservedSpots: sql`${eventRegistrationOptions.reservedSpots} + ${registeredSpotCount}`,
                        }
                      : {
                          confirmedSpots: sql`${eventRegistrationOptions.confirmedSpots} + ${registeredSpotCount}`,
                        },
                  )
                  .where(
                    and(
                      eq(eventRegistrationOptions.id, registrationOption.id),
                      eq(eventRegistrationOptions.eventId, eventId),
                      sql`${eventRegistrationOptions.confirmedSpots} + ${eventRegistrationOptions.reservedSpots} + ${registeredSpotCount} <= ${eventRegistrationOptions.spots}`,
                    ),
                  )
                  .returning({ id: eventRegistrationOptions.id });
                if (updatedOptions.length === 0) {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message: 'Registration option has no available spots',
                    }),
                  );
                }

                for (const addOnPurchase of orderedAddonPurchases) {
                  const updatedAddOns = yield* tx
                    .update(eventAddons)
                    .set({
                      totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} - ${addOnPurchase.quantity}`,
                    })
                    .where(
                      and(
                        eq(eventAddons.id, addOnPurchase.addonId),
                        eq(eventAddons.eventId, eventId),
                        sql`${eventAddons.totalAvailableQuantity} >= ${addOnPurchase.quantity}`,
                      ),
                    )
                    .returning({ id: eventAddons.id });
                  if (updatedAddOns.length === 0) {
                    return yield* Effect.fail(
                      new EventRegistrationConflictError({
                        message: 'Add-on quantity is no longer available',
                      }),
                    );
                  }
                }

                const updatedRegistrations = yield* tx
                  .update(eventRegistrations)
                  .set({
                    appliedDiscountedPrice,
                    appliedDiscountType,
                    basePriceAtRegistration: basePrice,
                    discountAmount,
                    status: requiresCheckout ? 'PENDING' : 'CONFIRMED',
                    ...(selectedTaxRateId && {
                      stripeTaxRateId: selectedTaxRateId,
                      taxRateDisplayName: lockedSelectedTaxRate?.displayName,
                      taxRateInclusive: lockedSelectedTaxRate?.inclusive,
                      taxRatePercentage: lockedSelectedTaxRate?.percentage,
                    }),
                  })
                  .where(
                    and(
                      eq(eventRegistrations.id, registration.id),
                      eq(eventRegistrations.tenantId, tenant.id),
                      eq(eventRegistrations.status, 'PENDING'),
                    ),
                  )
                  .returning({ id: eventRegistrations.id });
                if (updatedRegistrations.length === 0) {
                  return yield* Effect.fail(
                    new EventRegistrationNotFoundError({
                      message: 'Registration not found',
                    }),
                  );
                }

                if (!requiresCheckout) {
                  const lockedLots = yield* tx
                    .select({
                      baseAmount: eventRegistrationAddonPurchaseLots.baseAmount,
                      id: eventRegistrationAddonPurchaseLots.id,
                      purchaseId: eventRegistrationAddonPurchaseLots.purchaseId,
                      quantity: eventRegistrationAddonPurchaseLots.quantity,
                      sourceLineKey:
                        eventRegistrationAddonPurchaseLots.sourceLineKey,
                      taxRateDisplayName:
                        eventRegistrationAddonPurchaseLots.taxRateDisplayName,
                      taxRateInclusive:
                        eventRegistrationAddonPurchaseLots.taxRateInclusive,
                      taxRatePercentage:
                        eventRegistrationAddonPurchaseLots.taxRatePercentage,
                    })
                    .from(eventRegistrationAddonPurchaseLots)
                    .where(
                      and(
                        eq(
                          eventRegistrationAddonPurchaseLots.registrationId,
                          registration.id,
                        ),
                        eq(
                          eventRegistrationAddonPurchaseLots.tenantId,
                          tenant.id,
                        ),
                      ),
                    )
                    .for('update');
                  const purchasedAddonCount = orderedAddonPurchases.filter(
                    ({ purchasedQuantity }) => purchasedQuantity > 0,
                  ).length;
                  if (lockedLots.length !== purchasedAddonCount) {
                    return yield* Effect.fail(
                      new EventRegistrationInternalError({
                        message:
                          'Approved registration add-on acquisition terms are incomplete',
                      }),
                    );
                  }
                  const settledComponents = settleAcquisitionComponentTerms({
                    terms: [
                      {
                        allocationKey: `registration-initial:${registration.id}`,
                        baseAmount:
                          effectivePrice + basePrice * registration.guestCount,
                        id: `registration:${registration.id}`,
                        kind: 'registration',
                        quantity: registeredSpotCount,
                        taxRateDisplayName:
                          lockedSelectedTaxRate?.displayName ?? null,
                        taxRateInclusive:
                          lockedSelectedTaxRate?.inclusive ?? null,
                        taxRatePercentage:
                          lockedSelectedTaxRate?.percentage ?? null,
                      },
                      ...lockedLots.map((lot) => ({
                        allocationKey: lot.sourceLineKey,
                        baseAmount: lot.baseAmount,
                        id: `addon-lot:${lot.id}`,
                        kind: 'addon_lot' as const,
                        purchaseId: lot.purchaseId,
                        purchaseLotId: lot.id,
                        quantity: lot.quantity,
                        taxRateDisplayName: lot.taxRateDisplayName,
                        taxRateInclusive: lot.taxRateInclusive,
                        taxRatePercentage: lot.taxRatePercentage,
                      })),
                    ],
                  });
                  if (!settledComponents) {
                    return yield* Effect.fail(
                      new EventRegistrationInternalError({
                        message:
                          'Approved free registration acquisition terms are not zero-value',
                      }),
                    );
                  }
                  yield* establishRegistrationAcquisition(tx, {
                    acquiredAt: now,
                    components: settledComponents,
                    currency: tenant.currency,
                    eventId,
                    kind: 'initial',
                    operationKey: `registration-initial:${registration.id}`,
                    ownerUserId: registration.userId,
                    registrationId: registration.id,
                    spotCount: registeredSpotCount,
                    tenantId: tenant.id,
                  }).pipe(
                    Effect.mapError(
                      (cause) =>
                        new EventRegistrationInternalError({
                          cause,
                          message:
                            'Approved registration acquisition could not be persisted',
                        }),
                    ),
                  );
                  yield* enqueueManualApprovalEmail(tx, {
                    approvalKey: 'confirmed',
                    eventTitle: registration.event.title,
                    eventUrl,
                    paymentDeadline: null,
                    registrationId: registration.id,
                    tenant,
                    to: notificationEmail,
                  });
                  yield* onApproved(tx, approvalTransition('CONFIRMED', null));
                  return { _tag: 'Confirmed' as const };
                }

                const paymentClaims = yield* tx
                  .select(claimSelection)
                  .from(transactions)
                  .where(eq(transactions.id, candidateTransactionId));
                const paymentClaim = paymentClaims[0];
                if (!paymentClaim) {
                  return yield* Effect.fail(
                    new EventRegistrationInternalError({
                      message: 'Registration payment claim is missing',
                    }),
                  );
                }
                yield* onApproved(
                  tx,
                  approvalTransition('PENDING', paymentClaim.id),
                );
                return {
                  _tag: 'PaymentClaim' as const,
                  claim: paymentClaim,
                };
              }),
            )
            .pipe(
              Effect.catch((error) =>
                error instanceof EventRegistrationConflictError ||
                error instanceof EventRegistrationInternalError ||
                error instanceof EventRegistrationNotFoundError
                  ? Effect.fail(error)
                  : Effect.fail(
                      new EventRegistrationInternalError({
                        cause: error,
                        message: 'Failed to claim registration approval',
                      }),
                    ),
              ),
            ),
        );

        if (approvalResult._tag === 'Confirmed') {
          return { status: 'confirmed' as const };
        }

        const paymentClaim = approvalResult.claim;
        yield* Effect.annotateCurrentSpan({
          paymentClaim:
            paymentClaim.stripeCheckoutSessionId &&
            paymentClaim.stripeCheckoutUrl
              ? 'ready'
              : 'resuming',
          transactionId: paymentClaim.id,
        });
        if (
          paymentClaim.stripeCheckoutSessionId &&
          paymentClaim.stripeCheckoutUrl
        ) {
          return { status: 'paymentPending' as const };
        }
        if (
          paymentClaim.appFee === null ||
          !paymentClaim.stripeCheckoutRequest
        ) {
          return yield* Effect.fail(
            new EventRegistrationInternalError({
              message:
                'Registration payment setup cannot be resumed; cancel the registration and apply again',
            }),
          );
        }
        const checkoutRequestSnapshot =
          yield* decodeRegistrationCheckoutSnapshot(
            paymentClaim.stripeCheckoutRequest,
            'Registration payment setup cannot be resumed; cancel the registration and apply again',
          );
        const stripeAccount = paymentClaim.stripeAccountId;
        if (!stripeAccount) {
          return yield* Effect.fail(
            new EventRegistrationInternalError({
              message: 'Stripe account not found',
            }),
          );
        }

        const releaseApprovalClaim = Effect.fn(
          'EventRegistrationService.approveManualRegistration.releaseApprovalClaim',
        )(() =>
          Database.use((database) =>
            database
              .transaction((tx) =>
                Effect.gen(function* () {
                  const lockedRegistrations = yield* tx
                    .select({ status: eventRegistrations.status })
                    .from(eventRegistrations)
                    .where(
                      and(
                        eq(eventRegistrations.id, registration.id),
                        eq(eventRegistrations.tenantId, tenant.id),
                        eq(eventRegistrations.eventId, eventId),
                      ),
                    )
                    .for('update');
                  const lockedRegistration = lockedRegistrations[0];
                  const lockedClaims = yield* tx
                    .select({
                      method: transactions.method,
                      status: transactions.status,
                      stripeCheckoutCancellationRequestedAt:
                        transactions.stripeCheckoutCancellationRequestedAt,
                      stripeCheckoutSessionId:
                        transactions.stripeCheckoutSessionId,
                      type: transactions.type,
                    })
                    .from(transactions)
                    .where(
                      and(
                        eq(transactions.id, paymentClaim.id),
                        eq(transactions.tenantId, tenant.id),
                        eq(transactions.eventRegistrationId, registration.id),
                      ),
                    )
                    .for('update');
                  const lockedClaim = lockedClaims[0];
                  if (
                    lockedRegistration?.status === 'CANCELLED' &&
                    lockedClaim?.status === 'cancelled'
                  ) {
                    return;
                  }
                  if (
                    lockedRegistration?.status !== 'PENDING' ||
                    lockedClaim?.method !== 'stripe' ||
                    lockedClaim.status !== 'pending' ||
                    lockedClaim.stripeCheckoutCancellationRequestedAt !==
                      null ||
                    lockedClaim.stripeCheckoutSessionId !== null ||
                    lockedClaim.type !== 'registration'
                  ) {
                    return yield* Effect.fail(
                      new EventRegistrationInternalError({
                        message: 'Failed to release checkout claim',
                      }),
                    );
                  }

                  const cancelledClaims = yield* tx
                    .update(transactions)
                    .set({ status: 'cancelled' })
                    .where(
                      and(
                        eq(transactions.id, paymentClaim.id),
                        eq(transactions.tenantId, tenant.id),
                        eq(transactions.eventRegistrationId, registration.id),
                        eq(transactions.method, 'stripe'),
                        eq(transactions.status, 'pending'),
                        eq(transactions.type, 'registration'),
                        isNull(
                          transactions.stripeCheckoutCancellationRequestedAt,
                        ),
                        isNull(transactions.stripeCheckoutSessionId),
                      ),
                    )
                    .returning({ id: transactions.id });
                  if (cancelledClaims.length !== 1) {
                    return yield* Effect.fail(
                      new EventRegistrationInternalError({
                        message: 'Failed to release checkout claim',
                      }),
                    );
                  }

                  const releasedOptions = yield* tx
                    .update(eventRegistrationOptions)
                    .set({
                      reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${registeredSpotCount}`,
                    })
                    .where(
                      and(
                        eq(eventRegistrationOptions.id, registrationOption.id),
                        eq(eventRegistrationOptions.eventId, eventId),
                        sql`${eventRegistrationOptions.reservedSpots} >= ${registeredSpotCount}`,
                      ),
                    )
                    .returning({ id: eventRegistrationOptions.id });
                  if (releasedOptions.length !== 1) {
                    return yield* Effect.fail(
                      new EventRegistrationInternalError({
                        message: 'Failed to release registration capacity',
                      }),
                    );
                  }

                  for (const addOnPurchase of orderedAddonPurchases) {
                    const releasedAddOns = yield* tx
                      .update(eventAddons)
                      .set({
                        totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${addOnPurchase.quantity}`,
                      })
                      .where(
                        and(
                          eq(eventAddons.id, addOnPurchase.addonId),
                          eq(eventAddons.eventId, eventId),
                        ),
                      )
                      .returning({ id: eventAddons.id });
                    if (releasedAddOns.length !== 1) {
                      return yield* Effect.fail(
                        new EventRegistrationInternalError({
                          message:
                            'Failed to release registration add-on stock',
                        }),
                      );
                    }
                  }

                  yield* tx
                    .update(eventRegistrationAddonPurchaseLots)
                    .set({ sourceTransactionId: null })
                    .where(
                      and(
                        eq(
                          eventRegistrationAddonPurchaseLots.registrationId,
                          registration.id,
                        ),
                        eq(
                          eventRegistrationAddonPurchaseLots.tenantId,
                          tenant.id,
                        ),
                        eq(
                          eventRegistrationAddonPurchaseLots.sourceTransactionId,
                          paymentClaim.id,
                        ),
                        isNull(
                          eventRegistrationAddonPurchaseLots.paymentAllocationFinalizedAt,
                        ),
                      ),
                    );
                }),
              )
              .pipe(
                Effect.catch((error) =>
                  error instanceof EventRegistrationInternalError
                    ? Effect.fail(error)
                    : Effect.die(error),
                ),
              ),
          ),
        );

        const createSessionEffect = createHostedCheckoutSession(
          buildRegistrationCheckoutParameters({
            appFee: paymentClaim.appFee,
            currency: paymentClaim.currency,
            registrationId: registration.id,
            snapshot: checkoutRequestSnapshot,
            tenantId: tenant.id,
            transactionId: paymentClaim.id,
          }),
          {
            idempotencyKey: buildCheckoutSessionIdempotencyKey({
              registrationId: registration.id,
              transactionId: paymentClaim.id,
            }),
            stripeAccount,
          },
        ).pipe(
          Effect.mapError(
            (cause) =>
              new EventRegistrationInternalError({
                cause,
                message:
                  'Payment setup is still pending. Retry approval or cancel the registration.',
              }),
          ),
        );
        const session = yield* createSessionEffect.pipe(
          Effect.catch((error) =>
            isDefinitiveCheckoutSessionCreateFailure(error.cause)
              ? releaseApprovalClaim().pipe(Effect.andThen(Effect.fail(error)))
              : Effect.fail(error),
          ),
        );
        if (!session.url) {
          const missingUrlError = new EventRegistrationInternalError({
            message: 'Stripe checkout session did not provide a payment URL',
          });
          return yield* expireCheckoutSession(session.id, stripeAccount).pipe(
            Effect.andThen(releaseApprovalClaim()),
            Effect.andThen(Effect.fail(missingUrlError)),
          );
        }

        const reconcileApprovalBinding = Effect.fn(
          'EventRegistrationService.approveManualRegistration.reconcileApprovalBinding',
        )(() =>
          Database.use((database) =>
            database
              .transaction((tx) =>
                Effect.gen(function* () {
                  const lockedRegistrations = yield* tx
                    .select({ status: eventRegistrations.status })
                    .from(eventRegistrations)
                    .where(
                      and(
                        eq(eventRegistrations.id, registration.id),
                        eq(eventRegistrations.tenantId, tenant.id),
                        eq(eventRegistrations.eventId, eventId),
                      ),
                    )
                    .for('update');
                  const lockedClaims = yield* tx
                    .select({
                      method: transactions.method,
                      status: transactions.status,
                      stripeCheckoutCancellationRequestedAt:
                        transactions.stripeCheckoutCancellationRequestedAt,
                      stripeCheckoutSessionId:
                        transactions.stripeCheckoutSessionId,
                      type: transactions.type,
                    })
                    .from(transactions)
                    .where(
                      and(
                        eq(transactions.id, paymentClaim.id),
                        eq(transactions.tenantId, tenant.id),
                        eq(transactions.eventRegistrationId, registration.id),
                      ),
                    )
                    .for('update');
                  const lockedClaim = lockedClaims[0];
                  if (
                    lockedRegistrations[0]?.status !== 'PENDING' ||
                    lockedClaim?.method !== 'stripe' ||
                    lockedClaim.status !== 'pending' ||
                    lockedClaim.stripeCheckoutCancellationRequestedAt !==
                      null ||
                    lockedClaim.type !== 'registration'
                  ) {
                    return { _tag: 'Conflict' } as const;
                  }
                  if (lockedClaim.stripeCheckoutSessionId === session.id) {
                    const lockedOutboxRows = yield* tx
                      .select({ id: emailOutbox.id })
                      .from(emailOutbox)
                      .where(
                        and(
                          eq(emailOutbox.tenantId, tenant.id),
                          eq(emailOutbox.kind, 'manualApproval'),
                          eq(
                            emailOutbox.idempotencyKey,
                            `manual-approval/${tenant.id}/${registration.id}/${paymentClaim.id}`,
                          ),
                        ),
                      )
                      .for('update');
                    return lockedOutboxRows.length === 1
                      ? ({ _tag: 'Bound' } as const)
                      : ({ _tag: 'Conflict' } as const);
                  }
                  return lockedClaim.stripeCheckoutSessionId === null
                    ? ({ _tag: 'Unbound' } as const)
                    : ({ _tag: 'Conflict' } as const);
                }),
              )
              .pipe(
                Effect.catch((error) =>
                  error instanceof EventRegistrationInternalError
                    ? Effect.fail(error)
                    : Effect.die(error),
                ),
              ),
          ),
        );

        const bindingResult = yield* Database.use((database) =>
          database
            .transaction((tx) =>
              Effect.gen(function* () {
                const lockedRegistrations = yield* tx
                  .select({ status: eventRegistrations.status })
                  .from(eventRegistrations)
                  .where(
                    and(
                      eq(eventRegistrations.id, registration.id),
                      eq(eventRegistrations.eventId, eventId),
                      eq(eventRegistrations.tenantId, tenant.id),
                    ),
                  )
                  .for('update');
                if (lockedRegistrations[0]?.status !== 'PENDING') {
                  return { _tag: 'RegistrationUnavailable' as const };
                }

                const lockedClaims = yield* tx
                  .select({
                    stripeCheckoutCancellationRequestedAt:
                      transactions.stripeCheckoutCancellationRequestedAt,
                    stripeCheckoutSessionId:
                      transactions.stripeCheckoutSessionId,
                  })
                  .from(transactions)
                  .where(
                    and(
                      eq(transactions.id, paymentClaim.id),
                      eq(transactions.eventRegistrationId, registration.id),
                      eq(transactions.method, 'stripe'),
                      eq(transactions.status, 'pending'),
                      eq(transactions.tenantId, tenant.id),
                      eq(transactions.type, 'registration'),
                    ),
                  )
                  .for('update');
                const lockedClaim = lockedClaims[0];
                if (
                  !lockedClaim ||
                  lockedClaim.stripeCheckoutCancellationRequestedAt !== null
                ) {
                  return { _tag: 'RegistrationUnavailable' as const };
                }
                if (
                  lockedClaim.stripeCheckoutSessionId &&
                  lockedClaim.stripeCheckoutSessionId !== session.id
                ) {
                  return yield* Effect.fail(
                    new EventRegistrationInternalError({
                      message:
                        'Registration payment claim is bound to another checkout session',
                    }),
                  );
                }
                if (lockedClaim.stripeCheckoutSessionId === session.id) {
                  return { _tag: 'Bound' } as const;
                }

                const boundClaims = yield* tx
                  .update(transactions)
                  .set({
                    stripeCheckoutReconcileAttempts: 0,
                    stripeCheckoutReconcileLastError: null,
                    stripeCheckoutReconcileLeaseExpiresAt: null,
                    stripeCheckoutReconcileLeaseId: null,
                    stripeCheckoutReconcileNextAt:
                      registrationCheckoutInitialReconcileAt(),
                    stripeCheckoutSessionId: session.id,
                    stripeCheckoutUrl: session.url,
                    stripePaymentIntentId:
                      typeof session.payment_intent === 'string'
                        ? session.payment_intent
                        : session.payment_intent?.id,
                  })
                  .where(
                    and(
                      eq(transactions.id, paymentClaim.id),
                      eq(transactions.eventRegistrationId, registration.id),
                      eq(transactions.method, 'stripe'),
                      eq(transactions.status, 'pending'),
                      eq(transactions.tenantId, tenant.id),
                      eq(transactions.type, 'registration'),
                      isNull(
                        transactions.stripeCheckoutCancellationRequestedAt,
                      ),
                      isNull(transactions.stripeCheckoutSessionId),
                    ),
                  )
                  .returning({ id: transactions.id });
                if (boundClaims.length !== 1) {
                  return yield* Effect.fail(
                    new EventRegistrationInternalError({
                      message: 'Failed to bind stripe checkout session',
                    }),
                  );
                }

                yield* enqueueManualApprovalEmail(tx, {
                  approvalKey: paymentClaim.id,
                  eventTitle: checkoutRequestSnapshot.eventTitle,
                  eventUrl: checkoutRequestSnapshot.eventUrl,
                  paymentDeadline: new Date(
                    checkoutRequestSnapshot.expiresAt * 1000,
                  ),
                  registrationId: registration.id,
                  tenant,
                  to: checkoutRequestSnapshot.notificationEmail,
                });
                return { _tag: 'Bound' as const };
              }),
            )
            .pipe(
              Effect.catch((error) =>
                error instanceof EventRegistrationInternalError
                  ? Effect.fail(error)
                  : Effect.fail(
                      new EventRegistrationInternalError({
                        cause: error,
                        message: 'Failed to persist registration checkout',
                      }),
                    ),
              ),
            ),
        ).pipe(
          Effect.catchCause((bindingCause) =>
            reconcileApprovalBinding().pipe(
              Effect.catchCause((reconciliationCause) =>
                Effect.logError(
                  'Failed to reconcile Stripe checkout binding; retaining approval claim',
                ).pipe(
                  Effect.annotateLogs({
                    reconciliationCause,
                    registrationId: registration.id,
                    stripeCheckoutSessionId: session.id,
                    transactionId: paymentClaim.id,
                  }),
                  Effect.andThen(Effect.failCause(bindingCause)),
                ),
              ),
              Effect.flatMap((reconciliation) => {
                if (reconciliation._tag === 'Bound') {
                  return Effect.succeed({ _tag: 'Bound' } as const);
                }
                if (reconciliation._tag === 'Conflict') {
                  return Effect.failCause(bindingCause);
                }
                return expireCheckoutSession(session.id, stripeAccount).pipe(
                  Effect.catchCause((expiryCause) =>
                    Effect.logError(
                      'Failed to expire unbound Stripe checkout session; retaining approval claim',
                    ).pipe(
                      Effect.annotateLogs({
                        expiryCause,
                        registrationId: registration.id,
                        stripeCheckoutSessionId: session.id,
                        transactionId: paymentClaim.id,
                      }),
                      Effect.andThen(Effect.failCause(bindingCause)),
                    ),
                  ),
                  Effect.andThen(releaseApprovalClaim()),
                  Effect.andThen(Effect.failCause(bindingCause)),
                );
              }),
            ),
          ),
        );

        if (bindingResult._tag === 'RegistrationUnavailable') {
          yield* expireCheckoutSession(session.id, stripeAccount).pipe(
            Effect.mapError(
              (cause) =>
                new EventRegistrationInternalError({
                  cause,
                  message:
                    'Registration was cancelled, but its checkout session could not be expired',
                }),
            ),
          );
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Registration is no longer awaiting payment',
            }),
          );
        }

        return { status: 'paymentPending' as const };
      });

      const registerForEvent = Effect.fn(
        'EventRegistrationService.registerForEvent',
      )(function* ({
        addOns,
        answers,
        eventId,
        guestCount,
        registrationOptionId,
        tenant,
        user,
      }: RegisterForEventArguments) {
        const configProvider = yield* ConfigProvider.ConfigProvider;
        const serverEnvironment = yield* serverConfig
          .parse(configProvider)
          .pipe(
            Effect.mapError(
              (error) =>
                new EventRegistrationInternalError({
                  message: `Invalid server configuration:\n${formatConfigError(error)}`,
                }),
            ),
          );
        const pinnedNowIso = Option.getOrUndefined(
          serverEnvironment.E2E_NOW_ISO,
        );
        const registrationEventUrl = yield* tenantOutboundUrl(
          tenant,
          `/events/${encodeURIComponent(eventId)}`,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new EventRegistrationInternalError({
                cause,
                message: 'Invalid tenant domain configuration',
              }),
          ),
        );
        const now = getServerNow(pinnedNowIso).toJSDate();
        if (!Number.isInteger(guestCount) || guestCount < 0) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Guest count must be a non-negative integer',
            }),
          );
        }
        const requestedSpotCount = guestCount + 1;

        // Phase 1: ensure this user can register (no active registration + valid option + capacity).
        const existingRegistration = yield* databaseEffect((database) =>
          database.query.eventRegistrations.findFirst({
            columns: {
              id: true,
              registrationOptionId: true,
              status: true,
            },
            where: {
              eventId,
              status: { NOT: 'CANCELLED' },
              tenantId: tenant.id,
              userId: user.id,
            },
          }),
        );
        if (existingRegistration) {
          if (
            existingRegistration.status === 'PENDING' &&
            existingRegistration.registrationOptionId === registrationOptionId
          ) {
            const existingClaims = yield* databaseEffect((database) =>
              database
                .select(registrationPaymentClaimSelection)
                .from(transactions)
                .where(
                  and(
                    eq(
                      transactions.eventRegistrationId,
                      existingRegistration.id,
                    ),
                    eq(transactions.method, 'stripe'),
                    eq(transactions.status, 'pending'),
                    eq(transactions.tenantId, tenant.id),
                    eq(transactions.type, 'registration'),
                  ),
                ),
            );
            const existingClaim = existingClaims[0];
            if (existingClaim) {
              yield* resumeDirectRegistrationCheckout({
                eventId,
                paymentClaim: existingClaim,
                registrationId: existingRegistration.id,
                tenantId: tenant.id,
              });
              return;
            }
          }
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'User is already registered for this event',
            }),
          );
        }

        const registrationOption = yield* databaseEffect((database) =>
          database.query.eventRegistrationOptions.findFirst({
            columns: {
              closeRegistrationTime: true,
              confirmedSpots: true,
              eventId: true,
              id: true,
              isPaid: true,
              openRegistrationTime: true,
              organizingRegistration: true,
              price: true,
              registrationMode: true,
              reservedSpots: true,
              roleIds: true,
              spots: true,
              stripeTaxRateId: true,
            },
            where: { eventId, id: registrationOptionId },
            with: {
              event: {
                columns: {
                  start: true,
                  status: true,
                  tenantId: true,
                  title: true,
                },
              },
              questions: {
                columns: {
                  id: true,
                  required: true,
                },
              },
            },
          }),
        );
        if (!registrationOption) {
          return yield* Effect.fail(
            new EventRegistrationNotFoundError({
              message: 'Registration option not found',
            }),
          );
        }
        if (!registrationOption.event) {
          return yield* Effect.fail(
            new EventRegistrationInternalError({
              message: 'Registration option event relation missing',
            }),
          );
        }
        if (registrationOption.event.tenantId !== tenant.id) {
          return yield* Effect.fail(
            new EventRegistrationNotFoundError({
              message: 'Registration option not found',
            }),
          );
        }
        if (registrationOption.event.status !== 'APPROVED') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Event is not open for registration',
            }),
          );
        }
        if (
          now < registrationOption.openRegistrationTime ||
          now > registrationOption.closeRegistrationTime
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Registration is not open',
            }),
          );
        }
        if (
          !isUserEligibleForRegistrationOption({
            optionRoleIds: registrationOption.roleIds,
            userRoleIds: user.roleIds,
          })
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'User is not eligible for this registration option',
            }),
          );
        }
        const manualApproval =
          registrationOption.registrationMode === 'application';
        if (registrationOption.registrationMode !== 'fcfs' && !manualApproval) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Registration option mode is not supported',
            }),
          );
        }
        if (registrationOption.organizingRegistration && guestCount > 0) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Guest spots are only available for participant options',
            }),
          );
        }
        if (
          !manualApproval &&
          registrationOption.confirmedSpots +
            registrationOption.reservedSpots +
            requestedSpotCount >
            registrationOption.spots
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Registration option has no available spots',
            }),
          );
        }

        const answerInserts = yield* Effect.try({
          catch: (error) => error as EventRegistrationConflictError,
          try: () =>
            validateRegistrationQuestionAnswers({
              answers,
              questions: registrationOption.questions ?? [],
            }),
        });
        const availableAddOns = yield* databaseEffect((database) =>
          database
            .select({
              addOnId: eventAddons.id,
              allowMultiple: eventAddons.allowMultiple,
              allowPurchaseDuringRegistration:
                eventAddons.allowPurchaseDuringRegistration,
              includedQuantity:
                addonToEventRegistrationOptions.includedQuantity,
              maxQuantityPerUser: eventAddons.maxQuantityPerUser,
              optionalPurchaseQuantity:
                addonToEventRegistrationOptions.optionalPurchaseQuantity,
              price: eventAddons.price,
              stripeTaxRateId: eventAddons.stripeTaxRateId,
              taxRateDisplayName: tenantStripeTaxRates.displayName,
              taxRateInclusive: tenantStripeTaxRates.inclusive,
              taxRatePercentage: tenantStripeTaxRates.percentage,
              title: eventAddons.title,
              totalAvailableQuantity: eventAddons.totalAvailableQuantity,
            })
            .from(eventAddons)
            .innerJoin(
              addonToEventRegistrationOptions,
              eq(addonToEventRegistrationOptions.addonId, eventAddons.id),
            )
            .leftJoin(
              tenantStripeTaxRates,
              and(
                eq(
                  tenantStripeTaxRates.stripeTaxRateId,
                  eventAddons.stripeTaxRateId,
                ),
                eq(tenantStripeTaxRates.tenantId, tenant.id),
                eq(
                  tenantStripeTaxRates.stripeAccountId,
                  tenant.stripeAccountId ?? '',
                ),
                eq(tenantStripeTaxRates.active, true),
                eq(tenantStripeTaxRates.inclusive, true),
              ),
            )
            .where(
              and(
                eq(eventAddons.eventId, eventId),
                eq(
                  addonToEventRegistrationOptions.registrationOptionId,
                  registrationOption.id,
                ),
              ),
            ),
        );
        const selectedAddOns = yield* Effect.try({
          catch: (error) => error as EventRegistrationConflictError,
          try: () =>
            validateRegistrationAddons({
              addOns,
              availableAddOns,
            }),
        });
        if (
          selectedAddOns.some(
            (addOn) =>
              addOn.selectedQuantity > 0 &&
              addOn.price > 0 &&
              (!addOn.stripeTaxRateId ||
                addOn.taxRateInclusive !== true ||
                addOn.taxRatePercentage === null),
          )
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                'Add-on tax configuration is unavailable for the connected Stripe account',
            }),
          );
        }
        const addOnPurchasePlans = selectedAddOns.map((addOn) => ({
          addOn,
          purchaseId: createId(),
          ...(addOn.selectedQuantity > 0 && { purchaseLotId: createId() }),
        }));
        const addOnTaxExpectations = selectedAddOns.map((addOn) => ({
          addOnId: addOn.addOnId,
          requiresTaxRate: addOn.price > 0 && addOn.selectedQuantity > 0,
          stripeTaxRateId: addOn.stripeTaxRateId,
        }));
        const selectedAddonTotalPrice = selectedAddOns.reduce(
          (total, addOn) => total + addOn.price * addOn.selectedQuantity,
          0,
        );
        const mayRequireCheckout =
          registrationOption.isPaid || selectedAddonTotalPrice > 0;

        // Phase 2: create registration row. Manual approval applications stay
        // pending without consuming spots until an organizer approves them.
        // Direct paid registrations persist their claim in the same transaction
        // as capacity and add-on reservations, before Stripe is contacted.
        const selectedTaxRateId =
          registrationOption.stripeTaxRateId ?? undefined;
        const tenantStripeAccountId = tenant.stripeAccountId;
        const selectedTaxRate =
          selectedTaxRateId && tenantStripeAccountId
            ? yield* databaseEffect((database) =>
                database.query.tenantStripeTaxRates.findFirst({
                  columns: {
                    displayName: true,
                    inclusive: true,
                    percentage: true,
                  },
                  where: {
                    active: true,
                    inclusive: true,
                    stripeAccountId: tenantStripeAccountId,
                    stripeTaxRateId: selectedTaxRateId,
                    tenantId: tenant.id,
                  },
                }),
              )
            : undefined;
        if (
          selectedTaxRateId &&
          (!selectedTaxRate || selectedTaxRate.percentage === null)
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                'Registration tax configuration is unavailable for the connected Stripe account',
            }),
          );
        }

        const basePrice = registrationOption.isPaid
          ? registrationOption.price
          : 0;
        let discountResolution: DiscountResolution =
          noDiscountResolution(basePrice);
        if (!manualApproval && registrationOption.isPaid && basePrice > 0) {
          const cards = yield* databaseEffect((database) =>
            database.query.userDiscountCards.findMany({
              columns: {
                type: true,
                validTo: true,
              },
              where: {
                status: 'verified',
                tenantId: tenant.id,
                userId: user.id,
              },
            }),
          );
          if (cards.length > 0) {
            const tenantRecord = yield* databaseEffect((database) =>
              database.query.tenants.findFirst({
                columns: {
                  discountProviders: true,
                },
                where: { id: tenant.id },
              }),
            );
            const providerConfig: TenantDiscountProviders =
              resolveTenantDiscountProviders(tenantRecord?.discountProviders);
            const enabledTypes = new Set(
              Object.entries(providerConfig)
                .filter(([, provider]) => provider?.status === 'enabled')
                .map(([key]) => key),
            );
            const discounts = yield* databaseEffect((database) =>
              database.query.eventRegistrationOptionDiscounts.findMany({
                columns: {
                  discountedPrice: true,
                  discountType: true,
                },
                where: { registrationOptionId: registrationOption.id },
              }),
            );
            discountResolution = resolveDiscount({
              basePrice,
              cards,
              discounts,
              enabledTypes,
              eventStart: registrationOption.event.start ?? new Date(),
            });
          }
        }
        const {
          appliedDiscountedPrice,
          appliedDiscountType,
          discountAmount,
          effectivePrice,
        } = discountResolution;
        const effectiveTotalPrice =
          effectivePrice +
          registrationOption.price * guestCount +
          selectedAddonTotalPrice;
        const requiresCheckout =
          !manualApproval && mayRequireCheckout && effectiveTotalPrice > 0;

        let directConfirmationTicketUrl: string | undefined;
        if (!manualApproval && !requiresCheckout) {
          directConfirmationTicketUrl = registrationEventUrl;
        }

        let directCheckout:
          | undefined
          | {
              appFee: number;
              request: RegistrationCheckoutSnapshot;
              transactionId: string;
            };
        if (requiresCheckout) {
          if (!tenant.stripeAccountId) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message: 'Stripe account not found',
              }),
            );
          }
          const eventUrl = registrationEventUrl;
          const checkoutLineItems: RegistrationCheckoutLineItemSnapshot[] = [];
          if (effectivePrice > 0) {
            checkoutLineItems.push({
              name: `Registration fee for ${registrationOption.event.title}`,
              quantity: 1,
              ...(selectedTaxRateId && { taxRateId: selectedTaxRateId }),
              unitAmount: effectivePrice,
            });
          }
          if (guestCount > 0) {
            if (
              effectivePrice === registrationOption.price &&
              checkoutLineItems.length === 1
            ) {
              checkoutLineItems[0] = {
                ...checkoutLineItems[0],
                quantity: requestedSpotCount,
              };
            } else {
              checkoutLineItems.push({
                name: `Guest registration fee for ${registrationOption.event.title}`,
                quantity: guestCount,
                ...(selectedTaxRateId && { taxRateId: selectedTaxRateId }),
                unitAmount: registrationOption.price,
              });
            }
          }
          for (const { addOn, purchaseLotId } of addOnPurchasePlans) {
            if (addOn.price <= 0) {
              continue;
            }
            checkoutLineItems.push({
              addonId: addOn.addOnId,
              allocationKey: `addon-lot:${purchaseLotId}`,
              kind: 'addon',
              name: `${addOn.title} add-on for ${registrationOption.event.title}`,
              quantity: addOn.selectedQuantity,
              ...(addOn.stripeTaxRateId && {
                taxRateId: addOn.stripeTaxRateId,
              }),
              unitAmount: addOn.price,
            });
          }
          directCheckout = {
            appFee: Math.round(effectiveTotalPrice * 0.035),
            request: {
              customerEmail: user.email,
              eventTitle: registrationOption.event.title,
              eventUrl,
              expiresAt: buildCheckoutSessionExpiresAt(30, { pinnedNowIso }),
              lineItems: checkoutLineItems,
              notificationEmail: user.email,
            },
            transactionId: createId(),
          };
        }

        const reservationResult = yield* Database.use((database) =>
          database
            .transaction((tx) =>
              Effect.gen(function* () {
                const lockedMemberships = yield* tx
                  .select({ id: usersToTenants.id })
                  .from(usersToTenants)
                  .where(
                    and(
                      eq(usersToTenants.tenantId, tenant.id),
                      eq(usersToTenants.userId, user.id),
                    ),
                  )
                  .for('update');
                if (lockedMemberships.length !== 1) {
                  return yield* Effect.fail(
                    new EventRegistrationNotFoundError({
                      message: 'Tenant membership not found',
                    }),
                  );
                }

                const hasTaxConfiguration =
                  selectedTaxRateId !== undefined ||
                  addOnTaxExpectations.some(
                    (addOn) => addOn.stripeTaxRateId !== null,
                  );
                const mustLockStripeAccount =
                  directCheckout !== undefined || hasTaxConfiguration;
                const lockedStripeAccount = mustLockStripeAccount
                  ? yield* lockTenantStripeAccount(tx, tenant.id)
                  : undefined;
                if (mustLockStripeAccount && !lockedStripeAccount) {
                  return yield* Effect.fail(
                    directCheckout
                      ? new EventRegistrationInternalError({
                          message: 'Stripe account not found',
                        })
                      : new EventRegistrationConflictError({
                          message:
                            'Registration tax configuration is unavailable because Stripe is not connected',
                        }),
                  );
                }
                const lockedTaxRateById = lockedStripeAccount
                  ? yield* lockCurrentRegistrationTaxConfiguration(tx, {
                      addOns: addOnTaxExpectations,
                      eventId,
                      optionRequiresTaxRate: registrationOption.isPaid,
                      optionStripeTaxRateId: registrationOption.stripeTaxRateId,
                      registrationOptionId: registrationOption.id,
                      stripeAccountId: lockedStripeAccount,
                      tenantId: tenant.id,
                    })
                  : new Map<string, RegistrationTaxRateSnapshot>();
                const lockedSelectedTaxRate = selectedTaxRateId
                  ? lockedTaxRateById.get(selectedTaxRateId)
                  : undefined;
                const activeRegistrationLimit = Math.max(
                  0,
                  Math.trunc(tenant.maxActiveRegistrationsPerUser ?? 0),
                );

                const activeRegistrations =
                  yield* tx.query.eventRegistrations.findMany({
                    columns: {
                      id: true,
                    },
                    where: {
                      eventId,
                      status: { NOT: 'CANCELLED' },
                      tenantId: tenant.id,
                      userId: user.id,
                    },
                  });
                if (activeRegistrations.length > 0) {
                  return { _tag: 'AlreadyRegistered' } as const;
                }

                if (activeRegistrationLimit > 0) {
                  const activeFutureRegistrations = yield* tx
                    .select({
                      id: eventRegistrations.id,
                    })
                    .from(eventRegistrations)
                    .innerJoin(
                      eventInstances,
                      eq(eventInstances.id, eventRegistrations.eventId),
                    )
                    .where(
                      and(
                        eq(eventRegistrations.tenantId, tenant.id),
                        eq(eventRegistrations.userId, user.id),
                        sql`${eventRegistrations.status} <> 'CANCELLED'`,
                        sql`${eventInstances.start} > ${now}`,
                      ),
                    )
                    .limit(activeRegistrationLimit);
                  if (
                    activeFutureRegistrations.length >= activeRegistrationLimit
                  ) {
                    return { _tag: 'TenantLimitReached' } as const;
                  }
                }

                if (!manualApproval) {
                  const updatedOptions = yield* tx
                    .update(eventRegistrationOptions)
                    .set(
                      requiresCheckout
                        ? {
                            reservedSpots: sql`${eventRegistrationOptions.reservedSpots} + ${requestedSpotCount}`,
                          }
                        : {
                            confirmedSpots: sql`${eventRegistrationOptions.confirmedSpots} + ${requestedSpotCount}`,
                          },
                    )
                    .where(
                      and(
                        eq(eventRegistrationOptions.id, registrationOption.id),
                        eq(eventRegistrationOptions.eventId, eventId),
                        sql`${eventRegistrationOptions.confirmedSpots} + ${eventRegistrationOptions.reservedSpots} + ${requestedSpotCount} <= ${eventRegistrationOptions.spots}`,
                      ),
                    )
                    .returning({
                      id: eventRegistrationOptions.id,
                    });
                  if (updatedOptions.length === 0) {
                    return { _tag: 'CapacityFull' } as const;
                  }
                }

                const createdRegistrations = yield* tx
                  .insert(eventRegistrations)
                  .values({
                    ...(!manualApproval &&
                      mayRequireCheckout && {
                        appliedDiscountedPrice,
                        appliedDiscountType,
                        basePriceAtRegistration: basePrice,
                        discountAmount,
                      }),
                    eventId,
                    guestCount,
                    registrationOptionId: registrationOption.id,
                    status:
                      manualApproval || requiresCheckout
                        ? 'PENDING'
                        : 'CONFIRMED',
                    ...(selectedTaxRateId && {
                      stripeTaxRateId: selectedTaxRateId,
                      taxRateDisplayName: lockedSelectedTaxRate?.displayName,
                      taxRateInclusive: lockedSelectedTaxRate?.inclusive,
                      taxRatePercentage: lockedSelectedTaxRate?.percentage,
                    }),
                    tenantId: tenant.id,
                    userId: user.id,
                  })
                  .returning({
                    id: eventRegistrations.id,
                  });
                const userRegistration = createdRegistrations[0];
                if (!userRegistration) {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message: 'User is already registered for this event',
                    }),
                  );
                }

                if (answerInserts.length > 0) {
                  yield* tx.insert(eventRegistrationQuestionAnswers).values(
                    answerInserts.map((answer) => ({
                      answer: answer.answer,
                      questionId: answer.questionId,
                      registrationId: userRegistration.id,
                    })),
                  );
                }

                for (const {
                  addOn,
                  purchaseId,
                  purchaseLotId,
                } of addOnPurchasePlans) {
                  const lockedAddOnTaxRate = addOn.stripeTaxRateId
                    ? lockedTaxRateById.get(addOn.stripeTaxRateId)
                    : undefined;
                  if (!manualApproval) {
                    const updatedAddOns = yield* tx
                      .update(eventAddons)
                      .set({
                        totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} - ${addOn.fulfilledQuantity}`,
                      })
                      .where(
                        and(
                          eq(eventAddons.id, addOn.addOnId),
                          eq(eventAddons.eventId, eventId),
                          sql`${eventAddons.totalAvailableQuantity} >= ${addOn.fulfilledQuantity}`,
                        ),
                      )
                      .returning({
                        id: eventAddons.id,
                      });
                    if (updatedAddOns.length === 0) {
                      return yield* Effect.fail(
                        new EventRegistrationConflictError({
                          message: 'Add-on quantity is no longer available',
                        }),
                      );
                    }
                  }

                  yield* tx.insert(eventRegistrationAddonPurchases).values({
                    addonId: addOn.addOnId,
                    eventId,
                    id: purchaseId,
                    includedQuantity: addOn.includedQuantity,
                    purchasedQuantity: addOn.selectedQuantity,
                    quantity: addOn.fulfilledQuantity,
                    redeemedQuantity: 0,
                    refundAllocatedPurchasedQuantity: 0,
                    registrationId: userRegistration.id,
                    registrationOptionId: registrationOption.id,
                    taxRateDisplayName: lockedAddOnTaxRate?.displayName,
                    taxRateInclusive: lockedAddOnTaxRate?.inclusive,
                    taxRatePercentage: lockedAddOnTaxRate?.percentage,
                    tenantId: tenant.id,
                    unitPrice: addOn.price,
                  });
                  if (purchaseLotId) {
                    const hasNoPayment = addOn.price === 0;
                    yield* tx
                      .insert(eventRegistrationAddonPurchaseLots)
                      .values({
                        ...(hasNoPayment && {
                          applicationFeeAmount: 0,
                          grossAmount: 0,
                          netAmount: 0,
                          paymentAllocationFinalizedAt: now,
                          stripeFeeAmount: 0,
                          taxAmount: 0,
                        }),
                        baseAmount: addOn.price * addOn.selectedQuantity,
                        currency: tenant.currency,
                        eventId,
                        id: purchaseLotId,
                        purchaseId,
                        quantity: addOn.selectedQuantity,
                        registrationId: userRegistration.id,
                        registrationOptionId: registrationOption.id,
                        sourceLineKey: `addon-lot:${purchaseLotId}`,
                        ...(!hasNoPayment &&
                          directCheckout && {
                            sourceTransactionId: directCheckout.transactionId,
                          }),
                        taxRateDisplayName: lockedAddOnTaxRate?.displayName,
                        taxRateInclusive: lockedAddOnTaxRate?.inclusive,
                        taxRatePercentage: lockedAddOnTaxRate?.percentage,
                        tenantId: tenant.id,
                        unitPrice: addOn.price,
                      });
                  }
                }

                if (!manualApproval && !requiresCheckout) {
                  const settledComponents = settleAcquisitionComponentTerms({
                    terms: [
                      {
                        allocationKey: `registration-initial:${userRegistration.id}`,
                        baseAmount: effectivePrice + basePrice * guestCount,
                        id: `registration:${userRegistration.id}`,
                        kind: 'registration',
                        quantity: requestedSpotCount,
                        taxRateDisplayName:
                          lockedSelectedTaxRate?.displayName ?? null,
                        taxRateInclusive:
                          lockedSelectedTaxRate?.inclusive ?? null,
                        taxRatePercentage:
                          lockedSelectedTaxRate?.percentage ?? null,
                      },
                      ...addOnPurchasePlans.flatMap(
                        ({ addOn, purchaseId, purchaseLotId }) =>
                          purchaseLotId
                            ? [
                                {
                                  allocationKey: `addon-lot:${purchaseLotId}`,
                                  baseAmount:
                                    addOn.price * addOn.selectedQuantity,
                                  id: `addon-lot:${purchaseLotId}`,
                                  kind: 'addon_lot' as const,
                                  purchaseId,
                                  purchaseLotId,
                                  quantity: addOn.selectedQuantity,
                                  taxRateDisplayName:
                                    (addOn.stripeTaxRateId
                                      ? lockedTaxRateById.get(
                                          addOn.stripeTaxRateId,
                                        )?.displayName
                                      : null) ?? null,
                                  taxRateInclusive:
                                    (addOn.stripeTaxRateId
                                      ? lockedTaxRateById.get(
                                          addOn.stripeTaxRateId,
                                        )?.inclusive
                                      : null) ?? null,
                                  taxRatePercentage:
                                    (addOn.stripeTaxRateId
                                      ? lockedTaxRateById.get(
                                          addOn.stripeTaxRateId,
                                        )?.percentage
                                      : null) ?? null,
                                },
                              ]
                            : [],
                      ),
                    ],
                  });
                  if (!settledComponents) {
                    return yield* Effect.fail(
                      new EventRegistrationInternalError({
                        message:
                          'Direct free registration acquisition terms are not zero-value',
                      }),
                    );
                  }
                  yield* establishRegistrationAcquisition(tx, {
                    acquiredAt: now,
                    components: settledComponents,
                    currency: tenant.currency,
                    eventId,
                    kind: 'initial',
                    operationKey: `registration-initial:${userRegistration.id}`,
                    ownerUserId: user.id,
                    registrationId: userRegistration.id,
                    spotCount: requestedSpotCount,
                    tenantId: tenant.id,
                  }).pipe(
                    Effect.mapError(
                      (cause) =>
                        new EventRegistrationInternalError({
                          cause,
                          message:
                            'Direct registration acquisition could not be persisted',
                        }),
                    ),
                  );
                }

                if (directConfirmationTicketUrl) {
                  const emailTenant = tenant.name
                    ? {
                        emailSenderEmail: tenant.emailSenderEmail ?? null,
                        emailSenderName: tenant.emailSenderName ?? null,
                        id: tenant.id,
                        name: tenant.name,
                      }
                    : yield* tx.query.tenants.findFirst({
                        columns: {
                          emailSenderEmail: true,
                          emailSenderName: true,
                          id: true,
                          name: true,
                        },
                        where: { id: tenant.id },
                      });
                  if (!emailTenant) {
                    return yield* Effect.fail(
                      new EventRegistrationInternalError({
                        message:
                          'Tenant not found for registration confirmation email',
                      }),
                    );
                  }
                  const communicationEmail =
                    user.communicationEmail === undefined
                      ? (yield* tx.query.users.findFirst({
                          columns: {
                            communicationEmail: true,
                          },
                          where: { id: user.id },
                        }))?.communicationEmail
                      : user.communicationEmail;
                  yield* enqueueRegistrationConfirmedEmail(tx, {
                    eventTitle: registrationOption.event.title,
                    registrationId: userRegistration.id,
                    tenant: emailTenant,
                    ticketUrl: directConfirmationTicketUrl,
                    to: communicationEmail?.trim() || user.email,
                  });
                }

                let paymentClaim: RegistrationPaymentClaim | undefined;
                if (directCheckout) {
                  const insertedClaims = yield* tx
                    .insert(transactions)
                    .values({
                      amount: effectiveTotalPrice,
                      appFee: directCheckout.appFee,
                      comment: `Registration for event ${registrationOption.event.title} ${registrationOption.eventId}`,
                      currency: tenant.currency,
                      eventId: registrationOption.eventId,
                      eventRegistrationId: userRegistration.id,
                      executiveUserId: user.id,
                      id: directCheckout.transactionId,
                      method: 'stripe',
                      status: 'pending',
                      stripeAccountId: lockedStripeAccount,
                      stripeCheckoutRequest: directCheckout.request,
                      targetUserId: user.id,
                      tenantId: tenant.id,
                      type: 'registration',
                    })
                    .returning(registrationPaymentClaimSelection);
                  paymentClaim = insertedClaims[0];
                  if (!paymentClaim) {
                    return yield* Effect.fail(
                      new EventRegistrationInternalError({
                        message: 'Failed to create registration payment claim',
                      }),
                    );
                  }
                }

                return {
                  _tag: 'Reserved',
                  paymentClaim,
                  registrationId: userRegistration.id,
                } as const;
              }),
            )
            .pipe(
              Effect.catch((error) => {
                if (
                  isUniqueConstraintViolation(
                    error,
                    ACTIVE_REGISTRATION_UNIQUE_CONSTRAINT,
                  )
                ) {
                  return Effect.succeed({
                    _tag: 'AlreadyRegistered',
                  } as const);
                }
                return error instanceof EventRegistrationConflictError ||
                  error instanceof EventRegistrationInternalError ||
                  error instanceof EventRegistrationNotFoundError
                  ? Effect.fail(error)
                  : Effect.die(error);
              }),
            ),
        );
        if (reservationResult._tag === 'AlreadyRegistered') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'User is already registered for this event',
            }),
          );
        }
        if (reservationResult._tag === 'CapacityFull') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Registration option has no available spots',
            }),
          );
        }
        if (reservationResult._tag === 'TenantLimitReached') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Active registration limit reached',
            }),
          );
        }
        if (!reservationResult.paymentClaim) {
          return;
        }
        return yield* resumeDirectRegistrationCheckout({
          eventId,
          paymentClaim: reservationResult.paymentClaim,
          registrationId: reservationResult.registrationId,
          tenantId: tenant.id,
        });
      });

      const joinWaitlist = Effect.fn('EventRegistrationService.joinWaitlist')(
        function* ({
          answers,
          eventId,
          registrationOptionId,
          tenant,
          user,
        }: JoinWaitlistArguments) {
          const configProvider = yield* ConfigProvider.ConfigProvider;
          const serverEnvironment = yield* serverConfig
            .parse(configProvider)
            .pipe(
              Effect.mapError(
                (error) =>
                  new EventRegistrationInternalError({
                    message: `Invalid server configuration:\n${formatConfigError(error)}`,
                  }),
              ),
            );
          const pinnedNowIso = Option.getOrUndefined(
            serverEnvironment.E2E_NOW_ISO,
          );
          const now = getServerNow(pinnedNowIso).toJSDate();

          const existingRegistration = yield* databaseEffect((database) =>
            database.query.eventRegistrations.findFirst({
              columns: {
                id: true,
              },
              where: {
                eventId,
                status: { NOT: 'CANCELLED' },
                tenantId: tenant.id,
                userId: user.id,
              },
            }),
          );
          if (existingRegistration) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'User is already registered for this event',
              }),
            );
          }

          const registrationOption = yield* databaseEffect((database) =>
            database.query.eventRegistrationOptions.findFirst({
              columns: {
                closeRegistrationTime: true,
                confirmedSpots: true,
                eventId: true,
                id: true,
                openRegistrationTime: true,
                organizingRegistration: true,
                registrationMode: true,
                reservedSpots: true,
                roleIds: true,
                spots: true,
              },
              where: { eventId, id: registrationOptionId },
              with: {
                event: {
                  columns: {
                    status: true,
                    tenantId: true,
                  },
                },
                questions: {
                  columns: {
                    id: true,
                    required: true,
                  },
                },
              },
            }),
          );
          if (!registrationOption) {
            return yield* Effect.fail(
              new EventRegistrationNotFoundError({
                message: 'Registration option not found',
              }),
            );
          }
          if (!registrationOption.event) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message: 'Registration option event relation missing',
              }),
            );
          }
          if (registrationOption.event.tenantId !== tenant.id) {
            return yield* Effect.fail(
              new EventRegistrationNotFoundError({
                message: 'Registration option not found',
              }),
            );
          }
          if (registrationOption.event.status !== 'APPROVED') {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'Event is not open for registration',
              }),
            );
          }
          if (
            now < registrationOption.openRegistrationTime ||
            now > registrationOption.closeRegistrationTime
          ) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'Registration is not open',
              }),
            );
          }
          if (
            !isUserEligibleForRegistrationOption({
              optionRoleIds: registrationOption.roleIds,
              userRoleIds: user.roleIds,
            })
          ) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'User is not eligible for this registration option',
              }),
            );
          }
          if (registrationOption.organizingRegistration) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'Waitlist is only available for participant options',
              }),
            );
          }
          if (registrationOption.registrationMode !== 'fcfs') {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'Registration option mode is not available yet',
              }),
            );
          }
          if (
            registrationOption.confirmedSpots +
              registrationOption.reservedSpots <
            registrationOption.spots
          ) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'Registration option still has available spots',
              }),
            );
          }

          const answerInserts = yield* Effect.try({
            catch: (error) => error as EventRegistrationConflictError,
            try: () =>
              validateRegistrationQuestionAnswers({
                answers,
                questions: registrationOption.questions ?? [],
              }),
          });

          const waitlistResult = yield* Database.use((database) =>
            database
              .transaction((tx) =>
                Effect.gen(function* () {
                  const lockedMemberships = yield* tx
                    .select({ id: usersToTenants.id })
                    .from(usersToTenants)
                    .where(
                      and(
                        eq(usersToTenants.tenantId, tenant.id),
                        eq(usersToTenants.userId, user.id),
                      ),
                    )
                    .for('update');
                  if (lockedMemberships.length !== 1) {
                    return yield* Effect.fail(
                      new EventRegistrationNotFoundError({
                        message: 'Tenant membership not found',
                      }),
                    );
                  }

                  const activeRegistrationLimit = Math.max(
                    0,
                    Math.trunc(tenant.maxActiveRegistrationsPerUser ?? 0),
                  );

                  const activeRegistrations =
                    yield* tx.query.eventRegistrations.findMany({
                      columns: {
                        id: true,
                      },
                      where: {
                        eventId,
                        status: { NOT: 'CANCELLED' },
                        tenantId: tenant.id,
                        userId: user.id,
                      },
                    });
                  if (activeRegistrations.length > 0) {
                    return { _tag: 'AlreadyRegistered' } as const;
                  }

                  if (activeRegistrationLimit > 0) {
                    const activeFutureRegistrations = yield* tx
                      .select({ id: eventRegistrations.id })
                      .from(eventRegistrations)
                      .innerJoin(
                        eventInstances,
                        eq(eventInstances.id, eventRegistrations.eventId),
                      )
                      .where(
                        and(
                          eq(eventRegistrations.tenantId, tenant.id),
                          eq(eventRegistrations.userId, user.id),
                          sql`${eventRegistrations.status} <> 'CANCELLED'`,
                          sql`${eventInstances.start} > ${now}`,
                        ),
                      )
                      .limit(activeRegistrationLimit);
                    if (
                      activeFutureRegistrations.length >=
                      activeRegistrationLimit
                    ) {
                      return { _tag: 'TenantLimitReached' } as const;
                    }
                  }

                  const updatedOptions = yield* tx
                    .update(eventRegistrationOptions)
                    .set({
                      waitlistSpots: sql`${eventRegistrationOptions.waitlistSpots} + 1`,
                    })
                    .where(
                      and(
                        eq(eventRegistrationOptions.id, registrationOption.id),
                        eq(eventRegistrationOptions.eventId, eventId),
                        sql`${eventRegistrationOptions.confirmedSpots} + ${eventRegistrationOptions.reservedSpots} >= ${eventRegistrationOptions.spots}`,
                      ),
                    )
                    .returning({
                      id: eventRegistrationOptions.id,
                    });
                  if (updatedOptions.length === 0) {
                    return { _tag: 'CapacityAvailable' } as const;
                  }

                  const createdRegistrations = yield* tx
                    .insert(eventRegistrations)
                    .values({
                      eventId,
                      registrationOptionId: registrationOption.id,
                      status: 'WAITLIST',
                      tenantId: tenant.id,
                      userId: user.id,
                    })
                    .returning({
                      id: eventRegistrations.id,
                    });
                  if (!createdRegistrations[0]) {
                    return { _tag: 'CapacityAvailable' } as const;
                  }

                  if (answerInserts.length > 0) {
                    yield* tx.insert(eventRegistrationQuestionAnswers).values(
                      answerInserts.map((answer) => ({
                        answer: answer.answer,
                        questionId: answer.questionId,
                        registrationId: createdRegistrations[0].id,
                      })),
                    );
                  }

                  return { _tag: 'Joined' } as const;
                }),
              )
              .pipe(
                Effect.catch((error) => {
                  if (
                    isUniqueConstraintViolation(
                      error,
                      ACTIVE_REGISTRATION_UNIQUE_CONSTRAINT,
                    )
                  ) {
                    return Effect.succeed({
                      _tag: 'AlreadyRegistered',
                    } as const);
                  }
                  return error instanceof EventRegistrationConflictError ||
                    error instanceof EventRegistrationInternalError ||
                    error instanceof EventRegistrationNotFoundError
                    ? Effect.fail(error)
                    : Effect.die(error);
                }),
              ),
          );

          if (waitlistResult._tag === 'AlreadyRegistered') {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'User is already registered for this event',
              }),
            );
          }
          if (waitlistResult._tag === 'CapacityAvailable') {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'Registration option still has available spots',
              }),
            );
          }
          if (waitlistResult._tag === 'TenantLimitReached') {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'Active registration limit reached',
              }),
            );
          }
        },
      );

      return {
        approveManualRegistration,
        joinWaitlist,
        registerForEvent,
      } as const;
    }),
  },
) {
  static readonly Default = Layer.effect(
    EventRegistrationService,
    EventRegistrationService.make,
  );

  static readonly approveManualRegistration = (
    input: ApproveManualRegistrationArguments,
  ) =>
    EventRegistrationService.use((service) =>
      service.approveManualRegistration(input),
    );

  static readonly joinWaitlist = (input: JoinWaitlistArguments) =>
    EventRegistrationService.use((service) => service.joinWaitlist(input));

  static readonly registerForEvent = (input: RegisterForEventArguments) =>
    EventRegistrationService.use((service) => service.registerForEvent(input));
}
