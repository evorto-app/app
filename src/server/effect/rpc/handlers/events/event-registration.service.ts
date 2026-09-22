import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
  MAX_REGISTRATION_GUESTS,
} from '@shared/registration-quantity-limits';
import { registrationSpotCount } from '@shared/registration-spots';
import { stripeCheckoutUrlMatchesSession } from '@shared/stripe-checkout-url';
import {
  resolveTenantDiscountProviders,
  type TenantDiscountProviders,
} from '@shared/tenant-config';
import { and, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import {
  Cause,
  ConfigProvider,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
} from 'effect';
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
  tenants,
  tenantStripeTaxRates,
  transactions,
  userDiscountCards,
} from '../../../../../db/schema';
import { type Tenant } from '../../../../../types/custom/tenant';
import { type User } from '../../../../../types/custom/user';
import { getServerNow } from '../../../../clock';
import { serverClockConfig } from '../../../../config/server-config';
import { verifiedDiscountCardCoversEvent } from '../../../../discounts/verified-discount-card';
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
import {
  isPersistableNonNegativeInteger,
  maximumPersistedPaymentAmount,
} from '../../../../payments/payment-amount';
import { lockTenantStripeAccount } from '../../../../payments/pending-stripe-obligations';
import { recordCheckoutSessionIncident } from '../../../../registrations/checkout-session-incident';
import { validateRegistrationQuestionAnswers } from '../../../../registrations/event-question-answer-guard';
import {
  establishRegistrationAcquisition,
  settleAcquisitionComponentTerms,
} from '../../../../registrations/registration-acquisition-write';
import { registrationCheckoutInitialReconcileAt } from '../../../../registrations/registration-checkout-completion';
import { registrationCheckoutHasTooManyLines } from '../../../../registrations/registration-checkout-lines';
import {
  buildDirectRegistrationCheckoutMetadata,
  directRegistrationCheckoutMetadataOwnsIdentity,
} from '../../../../registrations/registration-checkout-metadata';
import {
  isUserEligibleForRegistrationOption,
  lockCurrentRegistrationEligibility,
} from '../../../../registrations/registration-eligibility';
import { StripeClient } from '../../../../stripe-client';
import {
  tenantOutboundRootUrl,
  tenantOutboundUrl,
} from '../../../../tenant-outbound-url';
import { safeServerErrorSummary } from '../../../../utils/safe-server-error-summary';
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

const mapEventRegistrationInternalError =
  (operation: string, message: string) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, EventRegistrationInternalError, R> =>
    effect.pipe(
      Effect.tapError((error) =>
        Effect.logError(message).pipe(
          Effect.annotateLogs(safeServerErrorSummary(operation, error)),
        ),
      ),
      Effect.mapError(() => new EventRegistrationInternalError({ message })),
    );

const failEventRegistrationInternalError = (
  operation: string,
  message: string,
  error: unknown,
) =>
  Effect.logError(message).pipe(
    Effect.annotateLogs(safeServerErrorSummary(operation, error)),
    Effect.andThen(
      Effect.fail(new EventRegistrationInternalError({ message })),
    ),
  );

const causeHasUnexpected = <E>(cause: Cause.Cause<E>) =>
  Cause.hasDies(cause) || Cause.hasInterrupts(cause);

const prioritizeUnexpectedCauses = <E, E2>(
  primary: Cause.Cause<E>,
  secondary: Cause.Cause<E2>,
  expected: Cause.Cause<E2> | Cause.Cause<E> = primary,
) =>
  causeHasUnexpected(primary) && causeHasUnexpected(secondary)
    ? Cause.combine(primary, secondary)
    : causeHasUnexpected(primary)
      ? primary
      : causeHasUnexpected(secondary)
        ? secondary
        : expected;

const registrationServiceNow = (pinnedNowIso?: string) =>
  Effect.try({
    catch: (cause) => cause,
    try: () => getServerNow(pinnedNowIso).toJSDate(),
  }).pipe(
    mapEventRegistrationInternalError(
      'eventRegistration.clock',
      'The current time could not be checked. No sign-up was changed. Try again.',
    ),
  );

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

const expireCheckoutSession = (
  sessionId: string,
  stripeAccount: string,
  verifyIdentity = false,
) =>
  Effect.gen(function* () {
    const stripe = yield* StripeClient;
    const expiredSession = yield* Effect.tryPromise({
      catch: (cause) => cause,
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
    }).pipe(
      mapEventRegistrationInternalError(
        'eventRegistration.checkout.expireUnbound',
        'The unfinished payment could not be closed. No payment was taken. Reopen the ticket and review its current payment status.',
      ),
    );
    if (
      expiredSession.status !== 'expired' ||
      (verifyIdentity &&
        (expiredSession.id !== sessionId ||
          expiredSession.mode !== 'payment' ||
          expiredSession.object !== 'checkout.session' ||
          expiredSession.payment_status !== 'unpaid'))
    ) {
      return yield* Effect.fail(
        new EventRegistrationInternalError({
          message: 'Failed to expire unbound stripe checkout session',
        }),
      );
    }
  });

type DiscountCardRecord = Pick<
  typeof userDiscountCards.$inferSelect,
  'type' | 'validFrom' | 'validTo'
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
        verifiedDiscountCardCoversEvent(card, eventStart),
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
    | 'timezone'
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
  metadata,
  registrationId,
  snapshot,
  tenantId,
  transactionId,
}: {
  appFee: number;
  currency: typeof transactions.$inferSelect.currency;
  metadata?: Stripe.MetadataParam;
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
  metadata: metadata ?? {
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
    mapEventRegistrationInternalError(
      'eventRegistration.checkoutSnapshot.decode',
      message,
    ),
  ),
);

type RegistrationPaymentClaim = Pick<
  typeof transactions.$inferSelect,
  | 'amount'
  | 'appFee'
  | 'currency'
  | 'id'
  | 'stripeAccountId'
  | 'stripeCheckoutIncidentSessionId'
  | 'stripeCheckoutRequest'
  | 'stripeCheckoutSessionId'
  | 'stripeCheckoutUrl'
  | 'targetUserId'
>;

const registrationPaymentClaimSelection = {
  amount: transactions.amount,
  appFee: transactions.appFee,
  currency: transactions.currency,
  id: transactions.id,
  stripeAccountId: transactions.stripeAccountId,
  stripeCheckoutIncidentSessionId: transactions.stripeCheckoutIncidentSessionId,
  stripeCheckoutRequest: transactions.stripeCheckoutRequest,
  stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
  stripeCheckoutUrl: transactions.stripeCheckoutUrl,
  targetUserId: transactions.targetUserId,
};

const registrationPaymentClaimTuplePredicate = (input: {
  readonly amount: number;
  readonly appFee: number;
  readonly currency: typeof transactions.$inferSelect.currency;
  readonly eventId: string;
  readonly registrationId: string;
  readonly stripeAccountId: string;
  readonly stripeCheckoutRequest: RegistrationCheckoutSnapshot;
  readonly targetUserId: string;
  readonly tenantId: string;
  readonly transactionId: string;
}) =>
  sql<boolean>`${and(
    eq(transactions.id, input.transactionId),
    eq(transactions.amount, input.amount),
    eq(transactions.appFee, input.appFee),
    eq(transactions.currency, input.currency),
    eq(transactions.eventId, input.eventId),
    eq(transactions.eventRegistrationId, input.registrationId),
    eq(transactions.method, 'stripe'),
    eq(transactions.stripeAccountId, input.stripeAccountId),
    eq(transactions.stripeCheckoutRequest, input.stripeCheckoutRequest),
    eq(transactions.targetUserId, input.targetUserId),
    eq(transactions.tenantId, input.tenantId),
    eq(transactions.type, 'registration'),
  )}`;

const resumeRegistrationCheckout = Effect.fn(
  'EventRegistrationService.resumeRegistrationCheckout',
)(function* ({
  allowSessionCreation,
  eventId,
  manualApproval,
  paymentClaim,
  registrationId,
  tenantId,
}: {
  allowSessionCreation: boolean;
  eventId: string;
  manualApproval?: {
    readonly releaseClaim: (
      paymentClaimTuple: SQL,
    ) => Effect.Effect<void, EventRegistrationInternalError, Database>;
    readonly tenant: Parameters<typeof enqueueManualApprovalEmail>[1]['tenant'];
  };
  paymentClaim: RegistrationPaymentClaim;
  registrationId: string;
  tenantId: string;
}) {
  yield* Effect.annotateCurrentSpan({
    eventId,
    paymentClaim: paymentClaim.stripeCheckoutSessionId ? 'ready' : 'resuming',
    registrationId,
    tenantId,
    transactionId: paymentClaim.id,
  });
  if (paymentClaim.stripeCheckoutIncidentSessionId !== null) {
    return yield* Effect.fail(
      new EventRegistrationConflictError({
        message:
          'We could not safely finish setting up this payment. Contact an organizer before trying again.',
      }),
    );
  }
  const appFee = paymentClaim.appFee;
  const stripeAccount = paymentClaim.stripeAccountId;
  const stripeCheckoutRequest = paymentClaim.stripeCheckoutRequest;
  const targetUserId = paymentClaim.targetUserId;
  if (
    appFee === null ||
    !stripeAccount?.trim() ||
    !stripeCheckoutRequest ||
    !targetUserId?.trim()
  ) {
    return yield* Effect.fail(
      new EventRegistrationInternalError({
        message:
          'The saved payment details are incomplete. Contact an organizer before trying again.',
      }),
    );
  }
  if (
    (paymentClaim.stripeCheckoutSessionId === null) !==
      (paymentClaim.stripeCheckoutUrl === null) ||
    (paymentClaim.stripeCheckoutSessionId !== null &&
      (!paymentClaim.stripeCheckoutSessionId.trim() ||
        !paymentClaim.stripeCheckoutUrl?.trim() ||
        !stripeCheckoutUrlMatchesSession(
          paymentClaim.stripeCheckoutUrl,
          paymentClaim.stripeCheckoutSessionId,
        )))
  ) {
    return yield* Effect.fail(
      new EventRegistrationInternalError({
        message:
          'The saved payment details are incomplete. Contact an organizer before trying again.',
      }),
    );
  }
  const checkoutRequestSnapshot = yield* decodeRegistrationCheckoutSnapshot(
    stripeCheckoutRequest,
    'The saved payment details are invalid. Contact an organizer before trying again.',
  );
  const paymentClaimTuple = registrationPaymentClaimTuplePredicate({
    amount: paymentClaim.amount,
    appFee,
    currency: paymentClaim.currency,
    eventId,
    registrationId,
    stripeAccountId: stripeAccount,
    stripeCheckoutRequest: checkoutRequestSnapshot,
    targetUserId,
    tenantId,
    transactionId: paymentClaim.id,
  });
  if (paymentClaim.stripeCheckoutSessionId) {
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
                paymentClaimTuple,
                eq(transactions.status, 'pending'),
                isNull(transactions.stripeCheckoutIncidentSessionId),
              ),
            )
            .for('update');
          const lockedClaim = lockedClaims[0];
          const claimIsActive =
            lockedRegistrations[0]?.status === 'PENDING' &&
            lockedClaim?.stripeCheckoutCancellationRequestedAt === null &&
            lockedClaim.stripeCheckoutSessionId ===
              paymentClaim.stripeCheckoutSessionId &&
            lockedClaim.stripeCheckoutUrl === paymentClaim.stripeCheckoutUrl;
          if (!claimIsActive) return false;
          if (manualApproval) {
            const outbox = yield* tx
              .select({ id: emailOutbox.id })
              .from(emailOutbox)
              .where(
                and(
                  eq(emailOutbox.tenantId, tenantId),
                  eq(emailOutbox.kind, 'manualApproval'),
                  eq(
                    emailOutbox.idempotencyKey,
                    `manual-approval/${tenantId}/${registrationId}/${paymentClaim.id}`,
                  ),
                ),
              )
              .for('update');
            if (outbox.length !== 1) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'The approval notification could not be confirmed. Contact an organizer before trying again.',
                }),
              );
            }
          }
          return true;
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
  if (!allowSessionCreation) {
    return yield* Effect.fail(
      new EventRegistrationConflictError({
        message:
          'This payment still needs attention. Contact an organizer before trying again.',
      }),
    );
  }
  const releaseDirectCheckoutClaim = Effect.fn(
    'EventRegistrationService.resumeRegistrationCheckout.releaseClaim',
  )(
    (
      expectedStripeCheckoutSessionId: null | string,
      releaseOnlyWhenIneligible = false,
    ) =>
      Database.use((database) =>
        database
          .transaction((tx) =>
            Effect.gen(function* () {
              const lockedRegistrations = yield* tx
                .select({
                  guestCount: eventRegistrations.guestCount,
                  registrationOptionId: eventRegistrations.registrationOptionId,
                  status: eventRegistrations.status,
                  userId: eventRegistrations.userId,
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
                  stripeCheckoutIncidentSessionId:
                    transactions.stripeCheckoutIncidentSessionId,
                  stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
                  type: transactions.type,
                })
                .from(transactions)
                .where(
                  and(
                    paymentClaimTuple,
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
                return 'alreadyUnavailable' as const;
              }
              if (
                lockedRegistration?.status !== 'PENDING' ||
                lockedClaim?.method !== 'stripe' ||
                lockedClaim.stripeCheckoutIncidentSessionId !== null ||
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

              if (releaseOnlyWhenIneligible) {
                const currentEligibility =
                  yield* lockCurrentRegistrationEligibility(tx, {
                    eventId,
                    registrationOptionId:
                      lockedRegistration.registrationOptionId,
                    tenantId,
                    tenantLockMode: 'key share',
                    userId: lockedRegistration.userId,
                  });
                if (
                  currentEligibility._tag === 'Current' &&
                  currentEligibility.eventStatus === 'APPROVED' &&
                  isUserEligibleForRegistrationOption({
                    optionRoleIds: currentEligibility.roleIds,
                    userRoleIds: currentEligibility.userRoleIds,
                  })
                ) {
                  return 'stillEligible' as const;
                }
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
                    paymentClaimTuple,
                    eq(transactions.tenantId, tenantId),
                    eq(transactions.eventRegistrationId, registrationId),
                    eq(transactions.method, 'stripe'),
                    eq(transactions.status, 'pending'),
                    eq(transactions.type, 'registration'),
                    isNull(transactions.stripeCheckoutCancellationRequestedAt),
                    isNull(transactions.stripeCheckoutIncidentSessionId),
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
              return 'released' as const;
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

  const releaseClaim = (expectedStripeCheckoutSessionId: null | string) =>
    manualApproval
      ? manualApproval.releaseClaim(paymentClaimTuple)
      : releaseDirectCheckoutClaim(expectedStripeCheckoutSessionId);

  const paymentNeedsOrganizerMessage =
    'We could not safely finish setting up this payment. Contact an organizer before trying again.';
  const checkoutMetadataIdentity = {
    registrationId,
    tenantId,
    transactionId: paymentClaim.id,
    userId: targetUserId,
  };
  const checkoutMetadata = buildDirectRegistrationCheckoutMetadata(
    checkoutMetadataIdentity,
  );

  const recordCreatedSessionIncident = Effect.fn(
    'EventRegistrationService.resumeRegistrationCheckout.recordIncident',
  )(
    ({
      cause,
      operation,
      stripeCheckoutSessionId,
    }: {
      cause: unknown;
      operation: string;
      stripeCheckoutSessionId: string;
    }) =>
      Effect.logError(
        'A registration payment session could not be proven stopped; recording it for manual review',
      ).pipe(
        Effect.annotateLogs({
          ...safeServerErrorSummary(operation, cause),
          operation,
          registrationId,
          stripeAccountId: stripeAccount,
          stripeCheckoutSessionId,
          transactionId: paymentClaim.id,
        }),
        Effect.andThen(
          recordCheckoutSessionIncident({
            amount: paymentClaim.amount,
            appFee,
            currency: paymentClaim.currency,
            eventId,
            method: 'stripe',
            operation,
            registrationId,
            stripeAccountId: stripeAccount,
            stripeCheckoutRequest: checkoutRequestSnapshot,
            stripeCheckoutSessionId,
            targetUserId,
            tenantId,
            transactionId: paymentClaim.id,
            type: 'registration',
          }),
        ),
        Effect.catchTag('EffectDrizzleQueryError', Effect.die),
        mapEventRegistrationInternalError(
          'eventRegistration.checkout.recordIncident',
          paymentNeedsOrganizerMessage,
        ),
      ),
  );

  const checkoutParameters = buildRegistrationCheckoutParameters({
    appFee,
    currency: paymentClaim.currency,
    metadata: checkoutMetadata,
    registrationId,
    snapshot: checkoutRequestSnapshot,
    tenantId,
    transactionId: paymentClaim.id,
  });
  const createSessionEffect = createHostedCheckoutSession(checkoutParameters, {
    idempotencyKey: buildCheckoutSessionIdempotencyKey({
      registrationId,
      transactionId: paymentClaim.id,
    }),
    stripeAccount,
  }).pipe(
    Effect.catch((error) => {
      const failure = failEventRegistrationInternalError(
        'eventRegistration.checkout.create',
        'The payment could not be prepared. Contact an organizer before trying again.',
        error,
      );
      return isDefinitiveCheckoutSessionCreateFailure(error)
        ? releaseClaim(null).pipe(Effect.andThen(failure))
        : failure;
    }),
  );
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const session = yield* restore(createSessionEffect);
      const stripeCheckoutSessionId = yield* Effect.sync(() => session.id);
      if (
        typeof stripeCheckoutSessionId !== 'string' ||
        stripeCheckoutSessionId.length === 0 ||
        stripeCheckoutSessionId.trim() !== stripeCheckoutSessionId
      ) {
        return yield* Effect.die(
          new Error('Stripe returned a Checkout session without an identity'),
        );
      }

      const stopCreatedSessionOrRecordIncident = Effect.fn(
        'EventRegistrationService.resumeRegistrationCheckout.stopCreatedSession',
      )((operation: string) =>
        Effect.gen(function* () {
          const expiry = yield* Effect.exit(
            expireCheckoutSession(stripeCheckoutSessionId, stripeAccount, true),
          );
          if (Exit.isSuccess(expiry)) return 'stopped' as const;
          const incident = yield* Effect.exit(
            recordCreatedSessionIncident({
              cause: expiry.cause,
              operation,
              stripeCheckoutSessionId,
            }),
          );
          if (Exit.isFailure(incident)) {
            return yield* Effect.failCause(
              prioritizeUnexpectedCauses(incident.cause, expiry.cause),
            );
          }
          return causeHasUnexpected(expiry.cause)
            ? yield* Effect.failCause(expiry.cause)
            : ('incidentRecorded' as const);
        }),
      );

      const createdSessionValidation = yield* Effect.exit(
        Effect.sync(() => {
          const stripeCheckoutUrl = session.url;
          if (
            session.object !== 'checkout.session' ||
            session.mode !== 'payment' ||
            session.status !== 'open' ||
            session.payment_status !== 'unpaid' ||
            session.payment_intent !== null ||
            session.amount_total !== paymentClaim.amount ||
            session.currency !== paymentClaim.currency.toLowerCase() ||
            session.expires_at !== checkoutRequestSnapshot.expiresAt ||
            session.customer_email !== checkoutParameters.customer_email ||
            session.success_url !== checkoutParameters.success_url ||
            session.cancel_url !== checkoutParameters.cancel_url ||
            !directRegistrationCheckoutMetadataOwnsIdentity({
              identity: checkoutMetadataIdentity,
              metadata: session.metadata,
            }) ||
            typeof stripeCheckoutUrl !== 'string' ||
            !stripeCheckoutUrlMatchesSession(
              stripeCheckoutUrl,
              stripeCheckoutSessionId,
            )
          ) {
            return { _tag: 'Invalid' } as const;
          }
          return {
            _tag: 'Valid',
            stripeCheckoutUrl,
          } as const;
        }),
      );
      if (Exit.isFailure(createdSessionValidation)) {
        const cleanup = yield* Effect.exit(
          stopCreatedSessionOrRecordIncident(
            'direct-registration-created-session-validation',
          ),
        );
        return yield* Effect.failCause(
          Exit.isFailure(cleanup)
            ? prioritizeUnexpectedCauses(
                cleanup.cause,
                createdSessionValidation.cause,
              )
            : createdSessionValidation.cause,
        );
      }
      if (createdSessionValidation.value._tag === 'Invalid') {
        const stopOutcome = yield* stopCreatedSessionOrRecordIncident(
          'direct-registration-invalid-created-session',
        );
        return yield* Effect.fail(
          new EventRegistrationInternalError({
            message:
              stopOutcome === 'incidentRecorded'
                ? paymentNeedsOrganizerMessage
                : 'The payment could not be prepared. Contact an organizer before trying again.',
          }),
        );
      }
      const { stripeCheckoutUrl } = createdSessionValidation.value;
      const reconcileDirectBinding = Effect.fn(
        'EventRegistrationService.resumeRegistrationCheckout.reconcileBinding',
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
                    status: transactions.status,
                    stripeCheckoutCancellationRequestedAt:
                      transactions.stripeCheckoutCancellationRequestedAt,
                    stripeCheckoutIncidentSessionId:
                      transactions.stripeCheckoutIncidentSessionId,
                    stripeCheckoutSessionId:
                      transactions.stripeCheckoutSessionId,
                    stripeCheckoutUrl: transactions.stripeCheckoutUrl,
                  })
                  .from(transactions)
                  .where(paymentClaimTuple)
                  .for('update');
                const lockedClaim = lockedClaims[0];
                if (
                  lockedClaim?.stripeCheckoutSessionId ===
                    stripeCheckoutSessionId &&
                  lockedClaim.stripeCheckoutUrl === stripeCheckoutUrl
                ) {
                  if (manualApproval) {
                    const outbox = yield* tx
                      .select({ id: emailOutbox.id })
                      .from(emailOutbox)
                      .where(
                        and(
                          eq(emailOutbox.tenantId, tenantId),
                          eq(emailOutbox.kind, 'manualApproval'),
                          eq(
                            emailOutbox.idempotencyKey,
                            `manual-approval/${tenantId}/${registrationId}/${paymentClaim.id}`,
                          ),
                        ),
                      )
                      .for('update');
                    if (outbox.length !== 1)
                      return { _tag: 'BoundWithoutNotification' } as const;
                  }
                  return { _tag: 'Bound' } as const;
                }
                if (
                  lockedRegistrations[0]?.status !== 'PENDING' ||
                  lockedClaim?.status !== 'pending' ||
                  lockedClaim.stripeCheckoutCancellationRequestedAt !== null ||
                  lockedClaim.stripeCheckoutIncidentSessionId !== null
                ) {
                  return { _tag: 'Conflict' } as const;
                }
                return lockedClaim.stripeCheckoutSessionId === null &&
                  lockedClaim.stripeCheckoutUrl === null
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
                  stripeCheckoutIncidentSessionId:
                    transactions.stripeCheckoutIncidentSessionId,
                  stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
                  stripeCheckoutUrl: transactions.stripeCheckoutUrl,
                })
                .from(transactions)
                .where(
                  and(paymentClaimTuple, eq(transactions.status, 'pending')),
                )
                .for('update');
              const lockedClaim = lockedClaims[0];
              if (
                !lockedClaim ||
                lockedClaim.stripeCheckoutCancellationRequestedAt !== null ||
                lockedClaim.stripeCheckoutIncidentSessionId !== null
              ) {
                return { _tag: 'RegistrationUnavailable' as const };
              }
              if (
                lockedClaim.stripeCheckoutSessionId ===
                  stripeCheckoutSessionId &&
                lockedClaim.stripeCheckoutUrl === stripeCheckoutUrl
              ) {
                return { _tag: 'Bound' } as const;
              }
              if (
                lockedClaim.stripeCheckoutSessionId !== null ||
                lockedClaim.stripeCheckoutUrl !== null
              ) {
                return { _tag: 'RegistrationUnavailable' as const };
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
                  stripeCheckoutSessionId,
                  stripeCheckoutUrl,
                })
                .where(
                  and(
                    paymentClaimTuple,
                    eq(transactions.status, 'pending'),
                    isNull(transactions.stripeCheckoutCancellationRequestedAt),
                    isNull(transactions.stripeCheckoutIncidentSessionId),
                    isNull(transactions.stripeCheckoutSessionId),
                    isNull(transactions.stripeCheckoutUrl),
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
              if (manualApproval) {
                yield* enqueueManualApprovalEmail(tx, {
                  approvalKey: paymentClaim.id,
                  eventTitle: checkoutRequestSnapshot.eventTitle,
                  eventUrl: checkoutRequestSnapshot.eventUrl,
                  paymentDeadline: new Date(
                    checkoutRequestSnapshot.expiresAt * 1000,
                  ),
                  registrationId,
                  tenant: manualApproval.tenant,
                  to: checkoutRequestSnapshot.notificationEmail,
                });
              }
              return { _tag: 'Bound' } as const;
            }),
          )
          .pipe(
            Effect.catch((error) =>
              error instanceof EventRegistrationInternalError
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      ).pipe(
        Effect.catchCause((bindingCause) =>
          Effect.gen(function* () {
            const reconciliation = yield* Effect.exit(reconcileDirectBinding());
            if (
              Exit.isSuccess(reconciliation) &&
              reconciliation.value._tag === 'Bound'
            ) {
              yield* Effect.logError(
                'A registration payment binding completed without a successful acknowledgement',
              ).pipe(Effect.annotateLogs({ bindingCause }));
              return yield* Effect.failCause(bindingCause);
            }
            if (
              Exit.isSuccess(reconciliation) &&
              reconciliation.value._tag === 'BoundWithoutNotification'
            ) {
              return yield* Effect.failCause(bindingCause);
            }
            const causeToSurface = Exit.isFailure(reconciliation)
              ? prioritizeUnexpectedCauses(
                  reconciliation.cause,
                  bindingCause,
                  bindingCause,
                )
              : bindingCause;
            const cleanup = yield* Effect.exit(
              stopCreatedSessionOrRecordIncident(
                'direct-registration-binding-reconciliation',
              ),
            );
            if (
              Exit.isSuccess(cleanup) &&
              cleanup.value === 'stopped' &&
              Exit.isSuccess(reconciliation) &&
              reconciliation.value._tag === 'Unbound'
            ) {
              const release = yield* Effect.exit(
                releaseClaim(stripeCheckoutSessionId),
              );
              if (Exit.isFailure(release))
                return yield* Effect.failCause(
                  prioritizeUnexpectedCauses(release.cause, causeToSurface),
                );
            }
            return yield* Effect.failCause(
              Exit.isFailure(cleanup)
                ? prioritizeUnexpectedCauses(cleanup.cause, causeToSurface)
                : causeToSurface,
            );
          }),
        ),
      );

      if (bindingResult._tag === 'RegistrationUnavailable') {
        const stopOutcome = yield* stopCreatedSessionOrRecordIncident(
          'direct-registration-no-longer-available',
        );
        if (stopOutcome === 'incidentRecorded') {
          return yield* Effect.fail(
            new EventRegistrationInternalError({
              message: paymentNeedsOrganizerMessage,
            }),
          );
        }
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Registration is no longer awaiting payment',
          }),
        );
      }
    }),
  );
});

interface JoinWaitlistArguments {
  answers?: readonly RegistrationQuestionAnswerInput[] | undefined;
  eventId: string;
  registrationOptionId: string;
  tenant: Pick<Tenant, 'id'>;
  user: Pick<User, 'id' | 'roleIds'>;
}

interface RegisterForEventArguments {
  addOns?: readonly RegistrationAddonInput[] | undefined;
  answers?: readonly RegistrationQuestionAnswerInput[] | undefined;
  eventId: string;
  guestCount: number;
  registrationOptionId: string;
  tenant: Pick<
    Tenant,
    | 'currency'
    | 'domain'
    | 'emailSenderEmail'
    | 'emailSenderName'
    | 'id'
    | 'maxActiveRegistrationsPerUser'
    | 'name'
    | 'stripeAccountId'
  >;
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
  isPaid: boolean;
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

const registrationAddonTermsColumns = {
  addOnId: eventAddons.id,
  allowMultiple: eventAddons.allowMultiple,
  allowPurchaseDuringRegistration: eventAddons.allowPurchaseDuringRegistration,
  includedQuantity: addonToEventRegistrationOptions.includedQuantity,
  isPaid: eventAddons.isPaid,
  maxQuantityPerUser: eventAddons.maxQuantityPerUser,
  optionalPurchaseQuantity:
    addonToEventRegistrationOptions.optionalPurchaseQuantity,
  price: eventAddons.price,
  stripeTaxRateId: eventAddons.stripeTaxRateId,
};

type RegistrationAddonTerms = Pick<
  RegistrationAddonRecord,
  keyof typeof registrationAddonTermsColumns
>;

interface RegistrationCheckoutAddonAmountInput {
  readonly key: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

type RegistrationDiscountTerms = readonly Pick<
  typeof eventRegistrationOptionDiscounts.$inferSelect,
  'discountedPrice' | 'discountType'
>[];

const maximumPersistedPaymentAmountBigInt = BigInt(
  maximumPersistedPaymentAmount,
);

export const registrationCheckoutPriceBreakdown = Effect.fn(
  'EventRegistration.registrationCheckoutPriceBreakdown',
)(function* ({
  addOns,
  effectivePrice,
  guestCount,
  guestUnitPrice,
}: {
  readonly addOns: readonly RegistrationCheckoutAddonAmountInput[];
  readonly effectivePrice: number;
  readonly guestCount: number;
  readonly guestUnitPrice: number;
}) {
  if (
    !isPersistableNonNegativeInteger(effectivePrice) ||
    !isPersistableNonNegativeInteger(guestCount) ||
    !isPersistableNonNegativeInteger(guestUnitPrice)
  ) {
    return yield* Effect.fail(
      new EventRegistrationConflictError({
        message:
          'The price for this sign-up is not valid. Review your choices and try again.',
      }),
    );
  }

  const registrationBaseAmount =
    BigInt(effectivePrice) + BigInt(guestCount) * BigInt(guestUnitPrice);
  if (registrationBaseAmount > maximumPersistedPaymentAmountBigInt) {
    return yield* Effect.fail(
      new EventRegistrationConflictError({
        message:
          'The sign-up price is too high to pay online. Contact the organizer.',
      }),
    );
  }

  let selectedAddonTotalPrice = 0n;
  const addOnBaseAmounts = new Map<string, number>();
  for (const addOn of addOns) {
    if (
      addOnBaseAmounts.has(addOn.key) ||
      !isPersistableNonNegativeInteger(addOn.quantity) ||
      !isPersistableNonNegativeInteger(addOn.unitPrice)
    ) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message:
            'One selected add-on has an invalid price. Review your add-ons and try again.',
        }),
      );
    }

    const baseAmount = BigInt(addOn.quantity) * BigInt(addOn.unitPrice);
    if (baseAmount > maximumPersistedPaymentAmountBigInt) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message:
            'One selected add-on costs too much to pay online. Contact the organizer.',
        }),
      );
    }
    selectedAddonTotalPrice += baseAmount;
    if (selectedAddonTotalPrice > maximumPersistedPaymentAmountBigInt) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message:
            'The selected add-ons cost too much to pay online. Contact the organizer.',
        }),
      );
    }
    addOnBaseAmounts.set(addOn.key, Number(baseAmount));
  }

  const totalPrice = registrationBaseAmount + selectedAddonTotalPrice;
  if (totalPrice > maximumPersistedPaymentAmountBigInt) {
    return yield* Effect.fail(
      new EventRegistrationConflictError({
        message:
          'The total price is too high to pay online. Contact the organizer.',
      }),
    );
  }

  return {
    addOnBaseAmounts,
    registrationBaseAmount: Number(registrationBaseAmount),
    selectedAddonTotalPrice: Number(selectedAddonTotalPrice),
    totalPrice: Number(totalPrice),
  };
});

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

const registrationSnapshotChanged = () =>
  new EventRegistrationConflictError({
    message:
      'Sign-up details changed while this request was being processed. Nothing was saved. Review the current details and try again.',
  });

/**
 * Callers hold tenant and event locks. Discount evaluation requires tenant
 * UPDATE before event/question/member locks, including a fully discounted price.
 */
export const ensureCurrentRegistrationSnapshot = Effect.fn(
  'EventRegistration.ensureCurrentRegistrationSnapshot',
)(function* (
  database: Pick<DatabaseClient, 'query' | 'select'>,
  input: {
    readonly addOns?: readonly RegistrationAddonTerms[];
    readonly admission?: Pick<
      typeof eventRegistrationOptions.$inferSelect,
      | 'closeRegistrationTime'
      | 'openRegistrationTime'
      | 'organizingRegistration'
      | 'roleIds'
    > & { readonly now: Date };
    readonly eventId: string;
    readonly pricing?: Pick<
      typeof eventRegistrationOptions.$inferSelect,
      'isPaid' | 'price' | 'stripeTaxRateId'
    > & {
      readonly discountEligibility?: {
        readonly resolution: DiscountResolution;
        readonly userId: string;
      };
      readonly discounts?: RegistrationDiscountTerms;
      readonly eventStart: Date;
    };
    readonly registrationMode: typeof eventRegistrationOptions.$inferSelect.registrationMode;
    readonly registrationOptionId: string;
    readonly tenantId: string;
  },
) {
  const current = yield* database.query.eventRegistrationOptions
    .findFirst({
      columns: {
        closeRegistrationTime: true,
        id: true,
        isPaid: true,
        openRegistrationTime: true,
        organizingRegistration: true,
        price: true,
        registrationMode: true,
        roleIds: true,
        stripeTaxRateId: true,
      },
      where: { eventId: input.eventId, id: input.registrationOptionId },
      with: {
        event: {
          columns: { start: true, status: true, tenantId: true },
        },
      },
    })
    .pipe(Effect.orDie);
  if (
    !current?.event ||
    current.event.tenantId !== input.tenantId ||
    current.event.status !== 'APPROVED' ||
    current.registrationMode !== input.registrationMode
  ) {
    return yield* registrationSnapshotChanged();
  }

  const admission = input.admission;
  if (admission) {
    const currentRoles = current.roleIds.toSorted();
    const expectedRoles = admission.roleIds.toSorted();
    if (
      current.openRegistrationTime.getTime() !==
        admission.openRegistrationTime.getTime() ||
      current.closeRegistrationTime.getTime() !==
        admission.closeRegistrationTime.getTime() ||
      admission.now < current.openRegistrationTime ||
      admission.now > current.closeRegistrationTime ||
      current.organizingRegistration !== admission.organizingRegistration ||
      currentRoles.length !== expectedRoles.length ||
      currentRoles.some((roleId, index) => roleId !== expectedRoles[index])
    ) {
      return yield* registrationSnapshotChanged();
    }
  }

  if (input.addOns) {
    const mappedAddOns = yield* database
      .select(registrationAddonTermsColumns)
      .from(eventAddons)
      .innerJoin(
        addonToEventRegistrationOptions,
        and(
          eq(addonToEventRegistrationOptions.addonId, eventAddons.id),
          eq(addonToEventRegistrationOptions.eventId, eventAddons.eventId),
        ),
      )
      .where(
        and(
          eq(eventAddons.eventId, input.eventId),
          eq(
            addonToEventRegistrationOptions.registrationOptionId,
            input.registrationOptionId,
          ),
        ),
      )
      .pipe(Effect.orDie);
    const expectedAddOns = new Map(
      input.addOns.map((addOn) => [addOn.addOnId, addOn]),
    );
    const currentAddOns = mappedAddOns.filter(
      (addOn) =>
        addOn.includedQuantity > 0 || expectedAddOns.has(addOn.addOnId),
    );
    if (
      expectedAddOns.size !== input.addOns.length ||
      currentAddOns.length !== expectedAddOns.size ||
      currentAddOns.some((addOn) => {
        const expected = expectedAddOns.get(addOn.addOnId);
        return (
          !expected ||
          addOn.isPaid !== expected.isPaid ||
          addOn.price !== expected.price ||
          addOn.stripeTaxRateId !== expected.stripeTaxRateId ||
          addOn.includedQuantity !== expected.includedQuantity ||
          addOn.optionalPurchaseQuantity !==
            expected.optionalPurchaseQuantity ||
          addOn.allowMultiple !== expected.allowMultiple ||
          addOn.allowPurchaseDuringRegistration !==
            expected.allowPurchaseDuringRegistration ||
          addOn.maxQuantityPerUser !== expected.maxQuantityPerUser
        );
      })
    ) {
      return yield* registrationSnapshotChanged();
    }
  }

  const pricing = input.pricing;
  if (!pricing) return current;
  if (
    current.isPaid !== pricing.isPaid ||
    current.price !== pricing.price ||
    current.stripeTaxRateId !== pricing.stripeTaxRateId ||
    current.event.start.getTime() !== pricing.eventStart.getTime()
  ) {
    return yield* registrationSnapshotChanged();
  }
  if (pricing.discounts || pricing.discountEligibility) {
    const discounts = yield* database.query.eventRegistrationOptionDiscounts
      .findMany({
        columns: { discountedPrice: true, discountType: true },
        where: { registrationOptionId: input.registrationOptionId },
      })
      .pipe(Effect.orDie);
    if (pricing.discounts) {
      const compareDiscounts = (
        left: RegistrationDiscountTerms[number],
        right: RegistrationDiscountTerms[number],
      ) =>
        left.discountType.localeCompare(right.discountType) ||
        left.discountedPrice - right.discountedPrice;
      const currentDiscounts = discounts.toSorted(compareDiscounts);
      const expectedDiscounts = pricing.discounts.toSorted(compareDiscounts);
      if (
        currentDiscounts.length !== expectedDiscounts.length ||
        currentDiscounts.some(
          (discount, index) =>
            expectedDiscounts[index]?.discountType !== discount.discountType ||
            expectedDiscounts[index]?.discountedPrice !==
              discount.discountedPrice,
        )
      ) {
        return yield* registrationSnapshotChanged();
      }
    }
    if (pricing.discountEligibility) {
      const tenant = yield* database.query.tenants
        .findFirst({
          columns: { discountProviders: true },
          where: { id: input.tenantId },
        })
        .pipe(Effect.orDie);
      if (!tenant) return yield* registrationSnapshotChanged();
      // Lock every status: filtering in SQL would miss a concurrent transition
      // from unverified to verified. Tenant UPDATE also serializes new inserts.
      const cards = yield* database
        .select({
          status: userDiscountCards.status,
          type: userDiscountCards.type,
          validFrom: userDiscountCards.validFrom,
          validTo: userDiscountCards.validTo,
        })
        .from(userDiscountCards)
        .where(
          and(
            eq(userDiscountCards.tenantId, input.tenantId),
            eq(userDiscountCards.userId, pricing.discountEligibility.userId),
          ),
        )
        .orderBy(userDiscountCards.id)
        .for('share')
        .pipe(Effect.orDie);
      const providerConfig = resolveTenantDiscountProviders(
        tenant.discountProviders,
      );
      const enabledTypes = new Set(
        Object.entries(providerConfig)
          .filter(([, provider]) => provider?.status === 'enabled')
          .map(([key]) => key),
      );
      const resolution = resolveDiscount({
        basePrice: current.isPaid ? current.price : 0,
        cards: cards.filter((card) => card.status === 'verified'),
        discounts,
        enabledTypes,
        eventStart: current.event.start,
      });
      const expected = pricing.discountEligibility.resolution;
      if (
        resolution.appliedDiscountedPrice !== expected.appliedDiscountedPrice ||
        resolution.appliedDiscountType !== expected.appliedDiscountType ||
        resolution.discountAmount !== expected.discountAmount ||
        resolution.effectivePrice !== expected.effectivePrice
      )
        return yield* registrationSnapshotChanged();
    }
  }
  return current;
});

const registrationTaxConfigurationChanged = () =>
  new EventRegistrationConflictError({
    message:
      'The payment details changed before they could be reserved. Review the sign-up and try again.',
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
    if (!taxRate.percentage?.trim()) {
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
  if ((addOns?.length ?? 0) > MAX_EVENT_ADDON_TYPES) {
    throw new EventRegistrationConflictError({
      message: `Choose no more than ${MAX_EVENT_ADDON_TYPES} different add-ons`,
    });
  }
  if (
    availableAddOns.length > MAX_EVENT_ADDON_TYPES ||
    availableAddOns.some(
      (addOn) =>
        addOn.includedQuantity + addOn.optionalPurchaseQuantity >
        MAX_REGISTRATION_ADDON_QUANTITY,
    )
  ) {
    throw new EventRegistrationConflictError({
      message:
        'Registration is unavailable because its add-on settings need to be corrected. Contact the organizer.',
    });
  }
  const availableAddOnById = new Map(
    availableAddOns.map((addOn) => [addOn.addOnId, addOn]),
  );
  const selectedAddOns = new Map<string, number>();

  for (const addOn of addOns ?? []) {
    if (
      !Number.isInteger(addOn.quantity) ||
      addOn.quantity < 0 ||
      addOn.quantity > MAX_REGISTRATION_ADDON_QUANTITY
    ) {
      throw new EventRegistrationConflictError({
        message: `Choose between 0 and ${MAX_REGISTRATION_ADDON_QUANTITY} of each add-on`,
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
      if (fulfilledQuantity > MAX_REGISTRATION_ADDON_QUANTITY) {
        throw new EventRegistrationConflictError({
          message: `Choose no more than ${MAX_REGISTRATION_ADDON_QUANTITY} of the same add-on`,
        });
      }
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
        const serverEnvironment = yield* serverClockConfig
          .parse(configProvider)
          .pipe(
            mapEventRegistrationInternalError(
              'eventRegistration.approval.settings',
              'Sign-ups are unavailable because Evorto could not check the service settings. Nothing was changed. Contact Evorto support if the problem continues.',
            ),
          );
        const pinnedNowIso = Option.getOrUndefined(
          serverEnvironment.E2E_NOW_ISO,
        );
        const now = yield* registrationServiceNow(pinnedNowIso);
        yield* tenantOutboundRootUrl(tenant).pipe(
          mapEventRegistrationInternalError(
            'eventRegistration.approval.rootUrl',
            'The organization link could not be prepared. No sign-up request was changed. Contact an organizer.',
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
        if (!registration.event || !registration.registrationOption) {
          return yield* Effect.fail(
            new EventRegistrationInternalError({
              message: 'Registration relation missing',
            }),
          );
        }
        if (!registration.user) {
          return yield* Effect.fail(
            new EventRegistrationInternalError({
              message:
                'The ticket owner could not be verified. No approval or payment was started. Reopen the sign-up request and try again.',
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
        if (
          registration.guestCount > MAX_REGISTRATION_GUESTS ||
          orderedAddonPurchases.some(
            (purchase) =>
              purchase.quantity > MAX_REGISTRATION_ADDON_QUANTITY ||
              purchase.purchasedQuantity > MAX_REGISTRATION_ADDON_QUANTITY,
          )
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                'This sign-up includes too many items for one online payment. Reduce the guest or add-on quantities and try again.',
            }),
          );
        }
        const registeredSpotCount = registrationSpotCount(
          registration.guestCount,
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
        if (selectedTaxRateId && !selectedTaxRate?.percentage?.trim()) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                "Online payment cannot be started because this sign-up choice's tax details are no longer available. No approval or payment was started. Update the tax details before approving again.",
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
        let discountTerms: RegistrationDiscountTerms | undefined;
        const cards = yield* databaseEffect((database) =>
          database.query.userDiscountCards.findMany({
            columns: {
              type: true,
              validFrom: true,
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
          if (!tenantRecord) {
            return yield* new EventRegistrationNotFoundError({
              message: 'Registration not found',
            });
          }
          const providerConfig: TenantDiscountProviders =
            resolveTenantDiscountProviders(tenantRecord.discountProviders);
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
          discountTerms = discounts;
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
        const checkoutPriceBreakdown =
          yield* registrationCheckoutPriceBreakdown({
            addOns: orderedAddonPurchases.map((purchase) => ({
              key: purchase.id,
              quantity: purchase.purchasedQuantity,
              unitPrice: purchase.unitPrice,
            })),
            effectivePrice,
            guestCount: registration.guestCount,
            guestUnitPrice: basePrice,
          });
        const effectiveTotalPrice = checkoutPriceBreakdown.totalPrice;
        const requiresCheckout = effectiveTotalPrice > 0;
        const appFee = Math.round(effectiveTotalPrice * 0.035);
        const eventUrl = yield* tenantOutboundUrl(
          tenant,
          `/events/${encodeURIComponent(eventId)}`,
        ).pipe(
          mapEventRegistrationInternalError(
            'eventRegistration.approval.eventUrl',
            'The event link could not be prepared. No sign-up request was changed. Contact an organizer.',
          ),
        );
        const notificationEmail =
          registration.user.communicationEmail.trim() ||
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
        if (registration.guestCount > 0 && basePrice > 0) {
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
              unitAmount: basePrice,
            });
          }
        }
        for (const addOnPurchase of registration.addonPurchases) {
          if (
            addOnPurchase.unitPrice <= 0 ||
            addOnPurchase.purchasedQuantity <= 0 ||
            !addOnPurchase.addOn
          ) {
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
        if (registrationCheckoutHasTooManyLines(checkoutLineItems)) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                'This sign-up includes too many different charges for one payment. Reduce the selected add-ons and try again.',
            }),
          );
        }
        if (orderedAddonPurchases.length > MAX_EVENT_ADDON_TYPES) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: `Choose no more than ${MAX_EVENT_ADDON_TYPES} different add-ons`,
            }),
          );
        }
        const checkoutRequest = {
          customerEmail: notificationEmail,
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
                const lockedEligibility =
                  yield* lockCurrentRegistrationEligibility(tx, {
                    eventId,
                    registrationOptionId: registration.registrationOptionId,
                    tenantId: tenant.id,
                    tenantLockMode: 'update',
                    userId: registration.userId,
                  });
                if (lockedEligibility._tag === 'NotMember') {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message:
                        'The applicant is no longer a member of this organization.',
                    }),
                  );
                }
                if (lockedEligibility._tag === 'Unavailable') {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message:
                        'The selected sign-up choice is no longer available.',
                    }),
                  );
                }
                if (lockedEligibility.eventStatus !== 'APPROVED') {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message: 'This event is not open for approvals.',
                    }),
                  );
                }
                if (
                  lockedEligibility.registrationMode !== 'application' ||
                  !isUserEligibleForRegistrationOption({
                    optionRoleIds: lockedEligibility.roleIds,
                    userRoleIds: lockedEligibility.userRoleIds,
                  })
                ) {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message:
                        "The applicant's access in this organization no longer includes this sign-up choice. No approval or payment was started. Check their access before approving again.",
                    }),
                  );
                }

                // Eligibility already holds the tenant update lock. Capture the
                // current sender and time zone for this approval before provider work.
                const [notificationTenant] = yield* tx
                  .select({
                    emailSenderEmail: tenants.emailSenderEmail,
                    emailSenderName: tenants.emailSenderName,
                    id: tenants.id,
                    name: tenants.name,
                    timezone: tenants.timezone,
                  })
                  .from(tenants)
                  .where(eq(tenants.id, tenant.id));
                if (!notificationTenant) {
                  return yield* Effect.fail(
                    new EventRegistrationInternalError({
                      message:
                        'The organization email settings could not be verified. No approval or payment was started. Reopen the request and try again.',
                    }),
                  );
                }

                const lockedStripeAccount = mustLockStripeAccount
                  ? yield* lockTenantStripeAccount(tx, tenant.id)
                  : undefined;
                if (mustLockStripeAccount && !lockedStripeAccount) {
                  return yield* Effect.fail(
                    requiresCheckout
                      ? new EventRegistrationInternalError({
                          message:
                            'The payment account could not be found. No sign-up was completed.',
                        })
                      : new EventRegistrationConflictError({
                          message:
                            'Payments are no longer available for this organization. No sign-up was completed.',
                        }),
                  );
                }

                yield* ensureCurrentRegistrationSnapshot(tx, {
                  eventId,
                  pricing: {
                    discountEligibility: {
                      resolution: discountResolution,
                      userId: registration.userId,
                    },
                    eventStart: registration.event.start,
                    isPaid: registrationOption.isPaid,
                    price: registrationOption.price,
                    stripeTaxRateId: registrationOption.stripeTaxRateId,
                    ...(discountTerms !== undefined && {
                      discounts: discountTerms,
                    }),
                  },
                  registrationMode: registrationOption.registrationMode,
                  registrationOptionId: registrationOption.id,
                  tenantId: tenant.id,
                });

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
                    created: false,
                    notificationTenant,
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
                        created: false,
                        notificationTenant,
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
                    discountAmount: discountAmount ?? 0,
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
                          checkoutPriceBreakdown.registrationBaseAmount,
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
                    mapEventRegistrationInternalError(
                      'eventRegistration.approval.persistAcquisition',
                      'The payment details could not be saved, so the sign-up request was not approved. Contact an Evorto administrator.',
                    ),
                  );
                  yield* enqueueManualApprovalEmail(tx, {
                    approvalKey: 'confirmed',
                    eventTitle: registration.event.title,
                    eventUrl,
                    paymentDeadline: null,
                    registrationId: registration.id,
                    tenant: notificationTenant,
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
                  created: true,
                  notificationTenant,
                };
              }),
            )
            .pipe(
              Effect.catch((error) =>
                error instanceof EventRegistrationConflictError ||
                error instanceof EventRegistrationInternalError ||
                error instanceof EventRegistrationNotFoundError
                  ? Effect.fail(error)
                  : failEventRegistrationInternalError(
                      'eventRegistration.approval.claim',
                      'The sign-up request could not be approved. Nothing was changed. Reopen the request and review it again.',
                      error,
                    ),
              ),
            ),
        );

        if (approvalResult._tag === 'Confirmed') {
          return { status: 'confirmed' as const };
        }

        const paymentClaim = approvalResult.claim;
        const releaseApprovalClaim = Effect.fn(
          'EventRegistrationService.approveManualRegistration.releaseApprovalClaim',
        )((paymentClaimTuple: SQL) =>
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
                      stripeCheckoutIncidentSessionId:
                        transactions.stripeCheckoutIncidentSessionId,
                      stripeCheckoutSessionId:
                        transactions.stripeCheckoutSessionId,
                      type: transactions.type,
                    })
                    .from(transactions)
                    .where(
                      and(
                        paymentClaimTuple,
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
                    lockedClaim.stripeCheckoutIncidentSessionId !== null ||
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
                        paymentClaimTuple,
                        eq(transactions.tenantId, tenant.id),
                        eq(transactions.eventRegistrationId, registration.id),
                        eq(transactions.method, 'stripe'),
                        eq(transactions.status, 'pending'),
                        eq(transactions.type, 'registration'),
                        isNull(
                          transactions.stripeCheckoutCancellationRequestedAt,
                        ),
                        isNull(transactions.stripeCheckoutSessionId),
                        isNull(transactions.stripeCheckoutIncidentSessionId),
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

        yield* resumeRegistrationCheckout({
          allowSessionCreation: approvalResult.created,
          eventId,
          manualApproval: {
            releaseClaim: releaseApprovalClaim,
            tenant: approvalResult.notificationTenant,
          },
          paymentClaim,
          registrationId: registration.id,
          tenantId: tenant.id,
        });

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
        const serverEnvironment = yield* serverClockConfig
          .parse(configProvider)
          .pipe(
            mapEventRegistrationInternalError(
              'eventRegistration.create.settings',
              'Sign-ups are unavailable because Evorto could not check the service settings. Nothing was changed. Contact Evorto support if the problem continues.',
            ),
          );
        const pinnedNowIso = Option.getOrUndefined(
          serverEnvironment.E2E_NOW_ISO,
        );
        const registrationEventUrl = yield* tenantOutboundUrl(
          tenant,
          `/events/${encodeURIComponent(eventId)}`,
        ).pipe(
          mapEventRegistrationInternalError(
            'eventRegistration.create.eventUrl',
            'The event link could not be prepared. No sign-up was created. Contact an organizer.',
          ),
        );
        const now = yield* registrationServiceNow(pinnedNowIso);
        if (
          !Number.isInteger(guestCount) ||
          guestCount < 0 ||
          guestCount > MAX_REGISTRATION_GUESTS
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: `Choose between 0 and ${MAX_REGISTRATION_GUESTS} guests`,
            }),
          );
        }
        const requestedSpotCount = guestCount + 1;

        // Phase 1: ensure this user can register (no active registration + valid option + capacity).
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
              message: 'You are already signed up for this event.',
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
              message: 'The selected sign-up choice is no longer available.',
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
              message: 'The selected sign-up choice is no longer available.',
            }),
          );
        }
        if (registrationOption.event.status !== 'APPROVED') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'This event is not open for sign-ups.',
            }),
          );
        }
        const eventStart = registrationOption.event.start;
        if (!eventStart) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                'This event does not have a start time, so sign-ups are unavailable. Contact an organizer.',
            }),
          );
        }
        if (
          now < registrationOption.openRegistrationTime ||
          now > registrationOption.closeRegistrationTime
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Sign-ups are not open at this time.',
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
              message:
                'Your access in this organization does not include this sign-up choice. No sign-up or payment was started. Choose another sign-up choice or contact the organizer.',
            }),
          );
        }
        const manualApproval =
          registrationOption.registrationMode === 'application';
        if (registrationOption.registrationMode !== 'fcfs' && !manualApproval) {
          return yield* new EventRegistrationConflictError({
            message: 'Registration option mode is not supported',
          });
        }
        if (registrationOption.organizingRegistration && guestCount > 0) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Guests can only be added to attendee sign-ups.',
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
              message:
                'There are not enough places left for this sign-up choice.',
            }),
          );
        }

        const availableAddOns = yield* databaseEffect((database) =>
          database
            .select({
              ...registrationAddonTermsColumns,
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
                "Online payment cannot be started because a selected add-on's tax details are no longer available. No sign-up or payment was started. Contact the organizer.",
            }),
          );
        }
        const addOnTaxExpectations = selectedAddOns.map((addOn) => ({
          addOnId: addOn.addOnId,
          requiresTaxRate: addOn.price > 0 && addOn.selectedQuantity > 0,
          stripeTaxRateId: addOn.stripeTaxRateId,
        }));
        const mayRequireCheckout =
          registrationOption.isPaid ||
          selectedAddOns.some(
            (addOn) => addOn.price > 0 && addOn.selectedQuantity > 0,
          );

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
        if (selectedTaxRateId && !selectedTaxRate?.percentage?.trim()) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                "Online payment cannot be started because this sign-up choice's tax details are no longer available. No sign-up or payment was started. Contact the organizer.",
            }),
          );
        }

        const basePrice = registrationOption.isPaid
          ? registrationOption.price
          : 0;
        let discountResolution: DiscountResolution =
          noDiscountResolution(basePrice);
        let discountTerms: RegistrationDiscountTerms | undefined;
        const evaluatesDiscounts =
          !manualApproval && registrationOption.isPaid && basePrice > 0;
        if (evaluatesDiscounts) {
          const cards = yield* databaseEffect((database) =>
            database.query.userDiscountCards.findMany({
              columns: {
                type: true,
                validFrom: true,
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
            if (!tenantRecord) {
              return yield* new EventRegistrationNotFoundError({
                message: 'Registration option not found',
              });
            }
            const providerConfig: TenantDiscountProviders =
              resolveTenantDiscountProviders(tenantRecord.discountProviders);
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
            discountTerms = discounts;
            discountResolution = resolveDiscount({
              basePrice,
              cards,
              discounts,
              enabledTypes,
              eventStart,
            });
          }
        }
        const {
          appliedDiscountedPrice,
          appliedDiscountType,
          discountAmount,
          effectivePrice,
        } = discountResolution;
        const checkoutPriceBreakdown =
          yield* registrationCheckoutPriceBreakdown({
            addOns: selectedAddOns.map((addOn) => ({
              key: addOn.addOnId,
              quantity: addOn.selectedQuantity,
              unitPrice: addOn.price,
            })),
            effectivePrice,
            guestCount,
            guestUnitPrice: basePrice,
          });
        const effectiveTotalPrice = checkoutPriceBreakdown.totalPrice;
        const addOnPurchasePlans = yield* Effect.all(
          selectedAddOns.map((addOn) =>
            Effect.gen(function* () {
              const baseAmount = checkoutPriceBreakdown.addOnBaseAmounts.get(
                addOn.addOnId,
              );
              if (baseAmount === undefined) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message:
                      'An add-on price could not be checked, so no sign-up was created. Review the selected add-ons or contact an organizer.',
                  }),
                );
              }
              return {
                addOn,
                baseAmount,
                purchaseId: createId(),
                ...(addOn.selectedQuantity > 0 && {
                  purchaseLotId: createId(),
                }),
              };
            }),
          ),
        );
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
          if (guestCount > 0 && basePrice > 0) {
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
                unitAmount: basePrice,
              });
            }
          }
          for (const { addOn, purchaseLotId } of addOnPurchasePlans) {
            if (addOn.price <= 0 || addOn.selectedQuantity <= 0) {
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
          if (registrationCheckoutHasTooManyLines(checkoutLineItems)) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message:
                  'This sign-up includes too many different charges for one payment. Reduce the selected add-ons and try again.',
              }),
            );
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
                const hasTaxConfiguration =
                  selectedTaxRateId !== undefined ||
                  addOnTaxExpectations.some(
                    (addOn) => addOn.stripeTaxRateId !== null,
                  );
                const mustLockStripeAccount =
                  directCheckout !== undefined || hasTaxConfiguration;
                const lockedEligibility =
                  yield* lockCurrentRegistrationEligibility(tx, {
                    eventId,
                    registrationOptionId: registrationOption.id,
                    tenantId: tenant.id,
                    tenantLockMode:
                      mustLockStripeAccount || evaluatesDiscounts
                        ? 'update'
                        : 'key share',
                    userId: user.id,
                  });
                if (lockedEligibility._tag === 'NotMember') {
                  return yield* Effect.fail(
                    new EventRegistrationNotFoundError({
                      message:
                        'You are no longer a member of this organization.',
                    }),
                  );
                }
                if (lockedEligibility._tag === 'Unavailable') {
                  return yield* Effect.fail(
                    new EventRegistrationNotFoundError({
                      message:
                        'The selected sign-up choice is no longer available.',
                    }),
                  );
                }
                if (lockedEligibility.eventStatus !== 'APPROVED') {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message: 'This event is not open for sign-ups.',
                    }),
                  );
                }
                if (
                  now < lockedEligibility.openRegistrationTime ||
                  now > lockedEligibility.closeRegistrationTime
                ) {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message: 'Sign-ups are not open at this time.',
                    }),
                  );
                }
                if (
                  !isUserEligibleForRegistrationOption({
                    optionRoleIds: lockedEligibility.roleIds,
                    userRoleIds: lockedEligibility.userRoleIds,
                  })
                ) {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message:
                        'Your access in this organization no longer includes this sign-up choice. No sign-up or payment was started. Choose another sign-up choice or contact the organizer.',
                    }),
                  );
                }
                if (
                  lockedEligibility.registrationMode !==
                    registrationOption.registrationMode ||
                  lockedEligibility.organizingRegistration !==
                    registrationOption.organizingRegistration
                ) {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message:
                        'This sign-up choice changed while you were signing up. Review it and try again.',
                    }),
                  );
                }

                const lockedStripeAccount = mustLockStripeAccount
                  ? yield* lockTenantStripeAccount(tx, tenant.id)
                  : undefined;
                if (mustLockStripeAccount && !lockedStripeAccount) {
                  return yield* Effect.fail(
                    directCheckout
                      ? new EventRegistrationInternalError({
                          message:
                            'The payment account could not be found. No sign-up was completed.',
                        })
                      : new EventRegistrationConflictError({
                          message:
                            'Payments are no longer available for this organization. No sign-up was completed.',
                        }),
                  );
                }
                yield* ensureCurrentRegistrationSnapshot(tx, {
                  addOns: selectedAddOns,
                  admission: {
                    closeRegistrationTime:
                      registrationOption.closeRegistrationTime,
                    now: yield* registrationServiceNow(pinnedNowIso),
                    openRegistrationTime:
                      registrationOption.openRegistrationTime,
                    organizingRegistration:
                      registrationOption.organizingRegistration,
                    roleIds: registrationOption.roleIds,
                  },
                  eventId,
                  pricing: {
                    ...(evaluatesDiscounts && {
                      discountEligibility: {
                        resolution: discountResolution,
                        userId: user.id,
                      },
                    }),
                    eventStart: registrationOption.event.start,
                    isPaid: registrationOption.isPaid,
                    price: registrationOption.price,
                    stripeTaxRateId: registrationOption.stripeTaxRateId,
                    ...(discountTerms !== undefined && {
                      discounts: discountTerms,
                    }),
                  },
                  registrationMode: registrationOption.registrationMode,
                  registrationOptionId: registrationOption.id,
                  tenantId: tenant.id,
                });
                const answerInserts = yield* Effect.try({
                  catch: (error) => error,
                  try: () =>
                    validateRegistrationQuestionAnswers({
                      answers,
                      questions: lockedEligibility.questions,
                    }),
                }).pipe(
                  Effect.catch((error) =>
                    Effect.gen(function* () {
                      if (error instanceof EventRegistrationConflictError)
                        return yield* Effect.fail(error);
                      return yield* failEventRegistrationInternalError(
                        'eventRegistration.questionValidation',
                        'Sign-up questions could not be checked. No sign-up was changed. Try again.',
                        error,
                      );
                    }),
                  ),
                );
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
                // Canonical eligibility already holds the tenant lock. Settings
                // writers take UPDATE, so this read stays current until commit.
                const [currentTenantSettings] = yield* tx
                  .select({
                    maxActiveRegistrationsPerUser:
                      tenants.maxActiveRegistrationsPerUser,
                  })
                  .from(tenants)
                  .where(eq(tenants.id, tenant.id));
                if (!currentTenantSettings) {
                  return yield* Effect.fail(
                    new EventRegistrationNotFoundError({
                      message:
                        'This organization is no longer available. No sign-up was completed.',
                    }),
                  );
                }
                const activeRegistrationLimit =
                  currentTenantSettings.maxActiveRegistrationsPerUser;

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
                        inArray(eventRegistrations.status, [
                          'PENDING',
                          'CONFIRMED',
                        ]),
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
                    ...(!manualApproval && {
                      appliedDiscountedPrice,
                      appliedDiscountType,
                      basePriceAtRegistration: basePrice,
                      discountAmount: discountAmount ?? 0,
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
                      message: 'You are already signed up for this event.',
                    }),
                  );
                }

                if (answerInserts.length > 0) {
                  yield* tx.insert(eventRegistrationQuestionAnswers).values(
                    answerInserts.map((answer) => ({
                      answer: answer.answer,
                      eventId,
                      questionId: answer.questionId,
                      registrationId: userRegistration.id,
                      registrationOptionId: registrationOption.id,
                      tenantId: tenant.id,
                    })),
                  );
                }

                for (const {
                  addOn,
                  baseAmount,
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
                          message:
                            'There are not enough of one selected add-on left.',
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
                        baseAmount,
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
                        baseAmount:
                          checkoutPriceBreakdown.registrationBaseAmount,
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
                        ({ addOn, baseAmount, purchaseId, purchaseLotId }) =>
                          purchaseLotId
                            ? [
                                {
                                  allocationKey: `addon-lot:${purchaseLotId}`,
                                  baseAmount,
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
                    mapEventRegistrationInternalError(
                      'eventRegistration.create.persistAcquisition',
                      'The payment details could not be saved, so no sign-up was created. No payment was taken. Reopen the event and try again.',
                    ),
                  );
                }

                if (directConfirmationTicketUrl) {
                  const communicationEmail =
                    user.communicationEmail === undefined
                      ? (yield* tx.query.users.findFirst({
                          columns: { communicationEmail: true },
                          where: { id: user.id },
                        }))?.communicationEmail
                      : user.communicationEmail;
                  yield* enqueueRegistrationConfirmedEmail(tx, {
                    eventTitle: registrationOption.event.title,
                    registrationId: userRegistration.id,
                    tenant: {
                      emailSenderEmail: tenant.emailSenderEmail,
                      emailSenderName: tenant.emailSenderName,
                      id: tenant.id,
                      name: tenant.name,
                    },
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
              message: 'You are already signed up for this event.',
            }),
          );
        }
        if (reservationResult._tag === 'CapacityFull') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                'There are not enough places left for this sign-up choice.',
            }),
          );
        }
        if (reservationResult._tag === 'TenantLimitReached') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                'This organization has reached its limit for current sign-ups. Contact an administrator.',
            }),
          );
        }
        if (!reservationResult.paymentClaim) {
          return;
        }
        return yield* resumeRegistrationCheckout({
          allowSessionCreation: true,
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
          const serverEnvironment = yield* serverClockConfig
            .parse(configProvider)
            .pipe(
              mapEventRegistrationInternalError(
                'eventRegistration.waitlist.settings',
                'Sign-ups are unavailable because Evorto could not check the service settings. Nothing was changed. Contact Evorto support if the problem continues.',
              ),
            );
          const pinnedNowIso = Option.getOrUndefined(
            serverEnvironment.E2E_NOW_ISO,
          );
          const now = yield* registrationServiceNow(pinnedNowIso);

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
                message: 'You are already signed up for this event.',
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
                message: 'The selected sign-up choice is no longer available.',
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
                message: 'The selected sign-up choice is no longer available.',
              }),
            );
          }
          if (registrationOption.event.status !== 'APPROVED') {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'This event is not open for sign-ups.',
              }),
            );
          }
          if (
            now < registrationOption.openRegistrationTime ||
            now > registrationOption.closeRegistrationTime
          ) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'Sign-ups are not open at this time.',
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
                message:
                  'Your access in this organization does not include this sign-up choice. You were not added to the waitlist. Choose another sign-up choice or contact the organizer.',
              }),
            );
          }
          if (registrationOption.organizingRegistration) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'Only attendee sign-up choices can have a waitlist.',
              }),
            );
          }
          if (registrationOption.registrationMode !== 'fcfs') {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'This sign-up choice does not have a waitlist.',
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
                message:
                  'Places are still available, so you can sign up now instead.',
              }),
            );
          }

          const waitlistResult = yield* Database.use((database) =>
            database
              .transaction((tx) =>
                Effect.gen(function* () {
                  const lockedEligibility =
                    yield* lockCurrentRegistrationEligibility(tx, {
                      eventId,
                      registrationOptionId: registrationOption.id,
                      tenantId: tenant.id,
                      tenantLockMode: 'key share',
                      userId: user.id,
                    });
                  if (lockedEligibility._tag === 'NotMember') {
                    return yield* Effect.fail(
                      new EventRegistrationNotFoundError({
                        message:
                          'You are no longer a member of this organization.',
                      }),
                    );
                  }
                  if (lockedEligibility._tag === 'Unavailable') {
                    return yield* Effect.fail(
                      new EventRegistrationNotFoundError({
                        message:
                          'The selected sign-up choice is no longer available.',
                      }),
                    );
                  }
                  if (lockedEligibility.eventStatus !== 'APPROVED') {
                    return yield* Effect.fail(
                      new EventRegistrationConflictError({
                        message: 'This event is not open for sign-ups.',
                      }),
                    );
                  }
                  if (
                    now < lockedEligibility.openRegistrationTime ||
                    now > lockedEligibility.closeRegistrationTime
                  ) {
                    return yield* Effect.fail(
                      new EventRegistrationConflictError({
                        message: 'Sign-ups are not open at this time.',
                      }),
                    );
                  }
                  if (
                    !isUserEligibleForRegistrationOption({
                      optionRoleIds: lockedEligibility.roleIds,
                      userRoleIds: lockedEligibility.userRoleIds,
                    })
                  ) {
                    return yield* Effect.fail(
                      new EventRegistrationConflictError({
                        message:
                          'Your access in this organization no longer includes this sign-up choice. You were not added to the waitlist. Choose another sign-up choice or contact the organizer.',
                      }),
                    );
                  }
                  if (
                    lockedEligibility.organizingRegistration ||
                    lockedEligibility.registrationMode !== 'fcfs'
                  ) {
                    return yield* Effect.fail(
                      new EventRegistrationConflictError({
                        message:
                          'This sign-up choice is no longer available for the waitlist.',
                      }),
                    );
                  }

                  yield* ensureCurrentRegistrationSnapshot(tx, {
                    admission: {
                      closeRegistrationTime:
                        registrationOption.closeRegistrationTime,
                      now: yield* registrationServiceNow(pinnedNowIso),
                      openRegistrationTime:
                        registrationOption.openRegistrationTime,
                      organizingRegistration:
                        registrationOption.organizingRegistration,
                      roleIds: registrationOption.roleIds,
                    },
                    eventId,
                    registrationMode: registrationOption.registrationMode,
                    registrationOptionId: registrationOption.id,
                    tenantId: tenant.id,
                  });
                  const answerInserts = yield* Effect.try({
                    catch: (error) => error,
                    try: () =>
                      validateRegistrationQuestionAnswers({
                        answers,
                        questions: lockedEligibility.questions,
                      }),
                  }).pipe(
                    Effect.catch((error) =>
                      Effect.gen(function* () {
                        if (error instanceof EventRegistrationConflictError)
                          return yield* Effect.fail(error);
                        return yield* failEventRegistrationInternalError(
                          'eventRegistration.questionValidation',
                          'Sign-up questions could not be checked. No sign-up was changed. Try again.',
                          error,
                        );
                      }),
                    ),
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
                        eventId,
                        questionId: answer.questionId,
                        registrationId: createdRegistrations[0].id,
                        registrationOptionId: registrationOption.id,
                        tenantId: tenant.id,
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
                message: 'You are already signed up for this event.',
              }),
            );
          }
          if (waitlistResult._tag === 'CapacityAvailable') {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message:
                  'Places are still available, so you can sign up now instead.',
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
