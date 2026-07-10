import type Stripe from 'stripe';

import { registrationSpotCount } from '@shared/registration-spots';
import {
  resolveTenantDiscountProviders,
  type TenantDiscountProviders,
} from '@shared/tenant-config';
import { resolveTenantPublicOrigin } from '@shared/tenant-origin';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ConfigProvider, Context, Effect, Layer, Option } from 'effect';

import { Database, type DatabaseClient } from '../../../../../db';
import { createId } from '../../../../../db/create-id';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchases,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrations,
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
} from '../../../../integrations/stripe-checkout';
import { enqueueManualApprovalEmail } from '../../../../notifications/email-delivery';
import { StripeClient } from '../../../../stripe-client';
import {
  ACTIVE_REGISTRATION_UNIQUE_CONSTRAINT,
  isUniqueConstraintViolation,
  PENDING_REGISTRATION_TRANSACTION_UNIQUE_CONSTRAINT,
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

const expireCheckoutSession = (sessionId: string, stripeAccount: string) =>
  Effect.gen(function* () {
    const stripe = yield* StripeClient;
    yield* Effect.tryPromise({
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

const resolveRegistrationPublicOrigin = ({
  baseUrl,
  domain,
  nodeEnvironment,
}: {
  baseUrl: string | undefined;
  domain: string;
  nodeEnvironment: string | undefined;
}) =>
  Effect.try({
    catch: (cause) =>
      new EventRegistrationInternalError({
        cause,
        message: 'Invalid tenant domain configuration',
      }),
    try: () =>
      resolveTenantPublicOrigin({
        baseUrl,
        nodeEnvironment,
        primaryDomain: domain,
      }),
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

interface ApproveManualRegistrationArguments {
  eventId: string;
  registrationId: string;
  tenant: Pick<
    Tenant,
    | 'currency'
    | 'domain'
    | 'emailSenderEmail'
    | 'emailSenderName'
    | 'id'
    | 'name'
    | 'stripeAccountId'
  >;
  user: Pick<User, 'id'>;
}

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
  tenant: Partial<Pick<Tenant, 'maxActiveRegistrationsPerUser'>> &
    Pick<Tenant, 'currency' | 'domain' | 'id' | 'stripeAccountId'>;
  user: Pick<User, 'email' | 'id' | 'roleIds'>;
}

interface RegistrationAddonInput {
  addOnId: string;
  quantity: number;
}

interface RegistrationAddonRecord {
  addOnId: string;
  allowMultiple: boolean;
  maxQuantityPerUser: number;
  price: number;
  quantity: number;
  stripeTaxRateId: null | string;
  taxRateDisplayName: null | string;
  taxRateInclusive: boolean | null;
  taxRatePercentage: null | string;
  title: string;
  totalAvailableQuantity: number;
}

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

  return [...selectedAddOns]
    .toSorted(([leftAddOnId], [rightAddOnId]) =>
      compareCodeUnitStrings(leftAddOnId, rightAddOnId),
    )
    .map(([addOnId, selectedQuantity]) => {
      const availableAddOn = availableAddOnById.get(addOnId);
      if (!availableAddOn) {
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
      const fulfilledQuantity = selectedQuantity * availableAddOn.quantity;
      if (fulfilledQuantity > availableAddOn.totalAvailableQuantity) {
        throw new EventRegistrationConflictError({
          message: 'Add-on quantity is no longer available',
        });
      }

      return {
        ...availableAddOn,
        fulfilledQuantity,
        selectedQuantity,
      };
    });
};

export class EventRegistrationService extends Context.Service<EventRegistrationService>()(
  '@server/effect/rpc/handlers/events/EventRegistrationService',
  {
    make: Effect.sync(() => {
      const approveManualRegistration = Effect.fn(
        'EventRegistrationService.approveManualRegistration',
      )(function* ({
        eventId,
        registrationId,
        tenant,
        user,
      }: ApproveManualRegistrationArguments) {
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
        const publicOrigin = yield* resolveRegistrationPublicOrigin({
          baseUrl: Option.getOrUndefined(serverEnvironment.BASE_URL),
          domain: tenant.domain,
          nodeEnvironment: Option.getOrUndefined(serverEnvironment.NODE_ENV),
        });

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
              eventId,
              id: registrationId,
              tenantId: tenant.id,
            },
            with: {
              addonPurchases: {
                columns: {
                  addonId: true,
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
              transactions: {
                columns: {
                  status: true,
                  type: true,
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
          registration.registrationOption.eventId !== eventId
        ) {
          return yield* Effect.fail(
            new EventRegistrationNotFoundError({
              message: 'Registration not found',
            }),
          );
        }
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
        if (
          registration.transactions.some(
            (transaction) =>
              transaction.type === 'registration' &&
              transaction.status === 'pending',
          )
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Registration is already awaiting payment',
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
          (total, purchase) => total + purchase.unitPrice * purchase.quantity,
          0,
        );
        const selectedTaxRateId =
          registrationOption.stripeTaxRateId ?? undefined;
        const selectedTaxRate = selectedTaxRateId
          ? yield* databaseEffect((database) =>
              database.query.tenantStripeTaxRates.findFirst({
                columns: {
                  displayName: true,
                  inclusive: true,
                  percentage: true,
                },
                where: {
                  stripeTaxRateId: selectedTaxRateId,
                  tenantId: tenant.id,
                },
              }),
            )
          : undefined;

        const basePrice = registrationOption.price;
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
          registrationOption.price * registration.guestCount +
          selectedAddonTotalPrice;
        const requiresCheckout = effectiveTotalPrice > 0;
        const appFee = Math.round(effectiveTotalPrice * 0.035);
        const stripeAccount = tenant.stripeAccountId;
        if (requiresCheckout && !stripeAccount) {
          return yield* Effect.fail(
            new EventRegistrationInternalError({
              message: 'Stripe account not found',
            }),
          );
        }
        const eventUrl = `${publicOrigin}/events/${eventId}`;
        const notificationEmail =
          registration.user.communicationEmail?.trim() ||
          registration.user.email;
        const transactionId = createId();

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
                if (
                  !lockedRegistration ||
                  lockedRegistration.status !== 'PENDING'
                ) {
                  return { _tag: 'RegistrationUnavailable' } as const;
                }

                const pendingClaims = yield* tx
                  .select({ id: transactions.id })
                  .from(transactions)
                  .where(
                    and(
                      eq(transactions.tenantId, tenant.id),
                      eq(transactions.eventRegistrationId, registration.id),
                      eq(transactions.method, 'stripe'),
                      eq(transactions.status, 'pending'),
                      eq(transactions.type, 'registration'),
                    ),
                  )
                  .for('update');
                if (pendingClaims.length > 0) {
                  return { _tag: 'AlreadyAwaitingPayment' } as const;
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
                  .returning({
                    id: eventRegistrationOptions.id,
                  });
                if (updatedOptions.length === 0) {
                  return { _tag: 'CapacityFull' } as const;
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
                      taxRateDisplayName: selectedTaxRate?.displayName,
                      taxRateInclusive: selectedTaxRate?.inclusive,
                      taxRatePercentage: selectedTaxRate?.percentage,
                    }),
                  })
                  .where(
                    and(
                      eq(eventRegistrations.id, registration.id),
                      eq(eventRegistrations.tenantId, tenant.id),
                      eq(eventRegistrations.status, 'PENDING'),
                    ),
                  )
                  .returning({
                    id: eventRegistrations.id,
                  });
                if (updatedRegistrations.length === 0) {
                  return yield* Effect.fail(
                    new EventRegistrationNotFoundError({
                      message: 'Registration not found',
                    }),
                  );
                }

                if (requiresCheckout) {
                  yield* tx.insert(transactions).values({
                    amount: effectiveTotalPrice,
                    appFee,
                    comment: `Registration approval for event ${registration.event.title} ${registration.eventId}`,
                    currency: tenant.currency,
                    eventId: registration.eventId,
                    eventRegistrationId: registration.id,
                    executiveUserId: user.id,
                    id: transactionId,
                    method: 'stripe',
                    status: 'pending',
                    targetUserId: registration.userId,
                    tenantId: tenant.id,
                    type: 'registration',
                  });
                } else {
                  yield* enqueueManualApprovalEmail(tx, {
                    eventTitle: registration.event.title,
                    eventUrl,
                    paymentDeadline: null,
                    registrationId: registration.id,
                    tenant,
                    to: notificationEmail,
                  });
                }

                return { _tag: 'Approved' } as const;
              }),
            )
            .pipe(
              Effect.catch((error) => {
                if (
                  isUniqueConstraintViolation(
                    error,
                    PENDING_REGISTRATION_TRANSACTION_UNIQUE_CONSTRAINT,
                  )
                ) {
                  return Effect.succeed({
                    _tag: 'AlreadyAwaitingPayment',
                  } as const);
                }
                return error instanceof EventRegistrationConflictError ||
                  error instanceof EventRegistrationNotFoundError
                  ? Effect.fail(error)
                  : Effect.die(error);
              }),
            ),
        );
        if (approvalResult._tag === 'CapacityFull') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Registration option has no available spots',
            }),
          );
        }
        if (approvalResult._tag === 'AlreadyAwaitingPayment') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Registration is already awaiting payment',
            }),
          );
        }
        if (approvalResult._tag === 'RegistrationUnavailable') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message:
                'Only pending manual approval registrations can be approved',
            }),
          );
        }
        if (!requiresCheckout) {
          return;
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
                  if (!lockedRegistration) {
                    return yield* Effect.fail(
                      new EventRegistrationInternalError({
                        message:
                          'Registration missing while releasing checkout claim',
                      }),
                    );
                  }
                  if (lockedRegistration.status === 'CANCELLED') {
                    return;
                  }

                  const cancelledClaims = yield* tx
                    .update(transactions)
                    .set({ status: 'cancelled' })
                    .where(
                      and(
                        eq(transactions.id, transactionId),
                        eq(transactions.tenantId, tenant.id),
                        eq(transactions.eventRegistrationId, registration.id),
                        eq(transactions.method, 'stripe'),
                        eq(transactions.status, 'pending'),
                        eq(transactions.type, 'registration'),
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

        const paymentFlow = Effect.gen(function* () {
          if (!stripeAccount) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message: 'Stripe account not found',
              }),
            );
          }

          const checkoutLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
            [];
          if (effectivePrice > 0) {
            checkoutLineItems.push({
              price_data: {
                currency: tenant.currency,
                product_data: {
                  name: `Registration fee for ${registration.event.title}`,
                },
                unit_amount: effectivePrice,
              },
              ...(selectedTaxRateId && { tax_rates: [selectedTaxRateId] }),
              quantity: 1,
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
                price_data: {
                  currency: tenant.currency,
                  product_data: {
                    name: `Guest registration fee for ${registration.event.title}`,
                  },
                  unit_amount: registrationOption.price,
                },
                ...(selectedTaxRateId && { tax_rates: [selectedTaxRateId] }),
                quantity: registration.guestCount,
              });
            }
          }
          for (const addOnPurchase of orderedAddonPurchases) {
            if (addOnPurchase.unitPrice <= 0 || !addOnPurchase.addOn) {
              continue;
            }
            checkoutLineItems.push({
              price_data: {
                currency: tenant.currency,
                product_data: {
                  name: `${addOnPurchase.addOn.title} add-on for ${registration.event.title}`,
                },
                unit_amount: addOnPurchase.unitPrice,
              },
              ...(addOnPurchase.addOn.stripeTaxRateId && {
                tax_rates: [addOnPurchase.addOn.stripeTaxRateId],
              }),
              quantity: addOnPurchase.quantity,
            });
          }

          const checkoutExpiresAt = buildCheckoutSessionExpiresAt(24 * 60, {
            pinnedNowIso,
          });
          const session = yield* createHostedCheckoutSession(
            {
              cancel_url: `${eventUrl}?registrationStatus=cancel`,
              customer_email: registration.user.email,
              expires_at: checkoutExpiresAt,
              line_items: checkoutLineItems,
              metadata: {
                registrationId: registration.id,
                tenantId: tenant.id,
                transactionId,
              },
              mode: 'payment',
              payment_intent_data: {
                application_fee_amount: appFee,
              },
              success_url: `${eventUrl}?registrationStatus=success`,
            },
            {
              idempotencyKey: buildCheckoutSessionIdempotencyKey({
                registrationId: registration.id,
                transactionId,
              }),
              stripeAccount,
            },
          ).pipe(
            Effect.mapError(
              (cause) =>
                new EventRegistrationInternalError({
                  cause,
                  message: 'Failed to create stripe checkout session',
                }),
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
                        eq(eventRegistrations.tenantId, tenant.id),
                        eq(eventRegistrations.eventId, eventId),
                      ),
                    )
                    .for('update');
                  const lockedRegistration = lockedRegistrations[0];
                  if (
                    !lockedRegistration ||
                    lockedRegistration.status !== 'PENDING'
                  ) {
                    return { _tag: 'RegistrationUnavailable' } as const;
                  }

                  const boundClaims = yield* tx
                    .update(transactions)
                    .set({
                      stripeCheckoutSessionId: session.id,
                      stripeCheckoutUrl: session.url,
                      stripePaymentIntentId:
                        typeof session.payment_intent === 'string'
                          ? session.payment_intent
                          : session.payment_intent?.id,
                    })
                    .where(
                      and(
                        eq(transactions.id, transactionId),
                        eq(transactions.tenantId, tenant.id),
                        eq(transactions.eventRegistrationId, registration.id),
                        eq(transactions.method, 'stripe'),
                        eq(transactions.status, 'pending'),
                        eq(transactions.type, 'registration'),
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
                    eventTitle: registration.event.title,
                    eventUrl,
                    paymentDeadline: new Date(checkoutExpiresAt * 1000),
                    registrationId: registration.id,
                    tenant,
                    to: notificationEmail,
                  });

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
              expireCheckoutSession(session.id, stripeAccount).pipe(
                Effect.catchCause((expiryCause) =>
                  Effect.logError(
                    'Failed to expire unbound Stripe checkout session; retaining approval claim',
                  ).pipe(
                    Effect.annotateLogs({
                      expiryCause,
                      registrationId: registration.id,
                      stripeCheckoutSessionId: session.id,
                      transactionId,
                    }),
                    Effect.andThen(Effect.failCause(bindingCause)),
                  ),
                ),
                Effect.andThen(releaseApprovalClaim()),
                Effect.andThen(Effect.failCause(bindingCause)),
              ),
            ),
          );
          if (bindingResult._tag === 'RegistrationUnavailable') {
            yield* expireCheckoutSession(session.id, stripeAccount);
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'Registration is no longer awaiting payment',
              }),
            );
          }

          return {
            checkoutExpiresAt,
          };
        });

        const paymentNotification = yield* paymentFlow;
        void paymentNotification;
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
        const publicOrigin = yield* resolveRegistrationPublicOrigin({
          baseUrl: Option.getOrUndefined(serverEnvironment.BASE_URL),
          domain: tenant.domain,
          nodeEnvironment: Option.getOrUndefined(serverEnvironment.NODE_ENV),
        });
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
        const requestedAddOnIds = [
          ...new Set(
            (addOns ?? [])
              .filter((addOn) => addOn.quantity > 0)
              .map((addOn) => addOn.addOnId),
          ),
        ];
        const availableAddOns =
          requestedAddOnIds.length === 0
            ? []
            : yield* databaseEffect((database) =>
                database
                  .select({
                    addOnId: eventAddons.id,
                    allowMultiple: eventAddons.allowMultiple,
                    maxQuantityPerUser: eventAddons.maxQuantityPerUser,
                    price: eventAddons.price,
                    quantity: addonToEventRegistrationOptions.quantity,
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
                    ),
                  )
                  .where(
                    and(
                      eq(eventAddons.eventId, eventId),
                      eq(eventAddons.allowPurchaseDuringRegistration, true),
                      eq(
                        addonToEventRegistrationOptions.registrationOptionId,
                        registrationOption.id,
                      ),
                      inArray(eventAddons.id, requestedAddOnIds),
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
        const selectedAddonTotalPrice = selectedAddOns.reduce(
          (total, addOn) => total + addOn.price * addOn.fulfilledQuantity,
          0,
        );
        const requiresCheckout =
          registrationOption.isPaid || selectedAddonTotalPrice > 0;

        // Phase 2: create registration row. Manual approval applications stay
        // pending without consuming spots until an organizer approves them.
        const selectedTaxRateId =
          registrationOption.stripeTaxRateId ?? undefined;
        const selectedTaxRate = selectedTaxRateId
          ? yield* databaseEffect((database) =>
              database.query.tenantStripeTaxRates.findFirst({
                columns: {
                  displayName: true,
                  inclusive: true,
                  percentage: true,
                },
                where: {
                  stripeTaxRateId: selectedTaxRateId,
                  tenantId: tenant.id,
                },
              }),
            )
          : undefined;

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
                if (lockedMemberships.length === 0) {
                  return yield* Effect.fail(
                    new EventRegistrationNotFoundError({
                      message: 'Tenant membership not found',
                    }),
                  );
                }

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

                const activeRegistrationLimit = Math.max(
                  0,
                  Math.trunc(tenant.maxActiveRegistrationsPerUser ?? 0),
                );
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
                    eventId,
                    guestCount,
                    registrationOptionId: registrationOption.id,
                    status:
                      manualApproval || requiresCheckout
                        ? 'PENDING'
                        : 'CONFIRMED',
                    ...(selectedTaxRateId && {
                      stripeTaxRateId: selectedTaxRateId,
                      taxRateDisplayName: selectedTaxRate?.displayName,
                      taxRateInclusive: selectedTaxRate?.inclusive,
                      taxRatePercentage: selectedTaxRate?.percentage,
                    }),
                    tenantId: tenant.id,
                    userId: user.id,
                  })
                  .returning({
                    id: eventRegistrations.id,
                  });
                const userRegistration = createdRegistrations[0];
                if (!userRegistration) {
                  return { _tag: 'CapacityFull' } as const;
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

                for (const addOn of selectedAddOns) {
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
                    quantity: addOn.fulfilledQuantity,
                    registrationId: userRegistration.id,
                    taxRateDisplayName: addOn.taxRateDisplayName,
                    taxRateInclusive: addOn.taxRateInclusive,
                    taxRatePercentage: addOn.taxRatePercentage,
                    unitPrice: addOn.price,
                  });
                }

                return {
                  _tag: 'Reserved',
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
        if (manualApproval || !requiresCheckout) {
          return;
        }
        const userRegistration = {
          id: reservationResult.registrationId,
        };

        const rollbackOnFailure = Effect.fn(
          'EventRegistrationService.registerForEvent.rollbackOnFailure',
        )(() =>
          Effect.gen(function* () {
            // Undo any DB writes if payment initialization fails after reservation.
            yield* databaseEffect((database) =>
              database
                .update(eventRegistrationOptions)
                .set({
                  reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${requestedSpotCount}`,
                })
                .where(
                  and(
                    eq(eventRegistrationOptions.id, registrationOption.id),
                    eq(eventRegistrationOptions.eventId, eventId),
                    sql`${eventRegistrationOptions.reservedSpots} >= ${requestedSpotCount}`,
                  ),
                ),
            );

            for (const addOn of selectedAddOns) {
              yield* databaseEffect((database) =>
                database
                  .update(eventAddons)
                  .set({
                    totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${addOn.fulfilledQuantity}`,
                  })
                  .where(
                    and(
                      eq(eventAddons.id, addOn.addOnId),
                      eq(eventAddons.eventId, eventId),
                    ),
                  ),
              );
            }

            yield* databaseEffect((database) =>
              database
                .delete(eventRegistrations)
                .where(eq(eventRegistrations.id, userRegistration.id)),
            );
          }),
        );

        const paymentFlow = Effect.gen(function* () {
          const transactionId = createId();
          const eventUrl = `${publicOrigin}/events/${eventId}`;

          // Phase 3: resolve the effective price (including discount provider/card logic).
          const basePrice = registrationOption.price;
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
            const eventStart = registrationOption.event.start ?? new Date();
            discountResolution = resolveDiscount({
              basePrice,
              cards,
              discounts,
              enabledTypes,
              eventStart,
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
            registrationOption.price * guestCount +
            selectedAddonTotalPrice;

          yield* databaseEffect((database) =>
            database
              .update(eventRegistrations)
              .set({
                appliedDiscountedPrice,
                appliedDiscountType,
                basePriceAtRegistration: basePrice,
                discountAmount,
              })
              .where(eq(eventRegistrations.id, userRegistration.id)),
          );

          // Free registrations skip Stripe but still transition reservation -> confirmed.
          if (effectiveTotalPrice <= 0) {
            yield* databaseEffect((database) =>
              database
                .update(eventRegistrations)
                .set({
                  status: 'CONFIRMED',
                })
                .where(eq(eventRegistrations.id, userRegistration.id)),
            );

            yield* databaseEffect((database) =>
              database
                .update(eventRegistrationOptions)
                .set({
                  confirmedSpots: sql`${eventRegistrationOptions.confirmedSpots} + ${requestedSpotCount}`,
                  reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${requestedSpotCount}`,
                })
                .where(
                  and(
                    eq(eventRegistrationOptions.id, registrationOption.id),
                    eq(eventRegistrationOptions.eventId, eventId),
                    sql`${eventRegistrationOptions.reservedSpots} >= ${requestedSpotCount}`,
                  ),
                ),
            );
            return;
          }

          // Phase 4: paid registration path (Stripe session + pending transaction record).
          const appFee = Math.round(effectiveTotalPrice * 0.035);
          const stripeAccount = tenant.stripeAccountId;
          if (!stripeAccount) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message: 'Stripe account not found',
              }),
            );
          }

          const checkoutLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
            [];
          if (effectivePrice > 0) {
            checkoutLineItems.push({
              price_data: {
                currency: tenant.currency,
                product_data: {
                  name: `Registration fee for ${registrationOption.event.title}`,
                },
                unit_amount: effectivePrice,
              },
              ...(selectedTaxRateId && { tax_rates: [selectedTaxRateId] }),
              quantity: 1,
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
                price_data: {
                  currency: tenant.currency,
                  product_data: {
                    name: `Guest registration fee for ${registrationOption.event.title}`,
                  },
                  unit_amount: registrationOption.price,
                },
                ...(selectedTaxRateId && { tax_rates: [selectedTaxRateId] }),
                quantity: guestCount,
              });
            }
          }
          for (const addOn of selectedAddOns) {
            if (addOn.price <= 0) {
              continue;
            }
            checkoutLineItems.push({
              price_data: {
                currency: tenant.currency,
                product_data: {
                  name: `${addOn.title} add-on for ${registrationOption.event.title}`,
                },
                unit_amount: addOn.price,
              },
              ...(addOn.stripeTaxRateId && {
                tax_rates: [addOn.stripeTaxRateId],
              }),
              quantity: addOn.fulfilledQuantity,
            });
          }

          const session = yield* createHostedCheckoutSession(
            {
              cancel_url: `${eventUrl}?registrationStatus=cancel`,
              customer_email: user.email,
              expires_at: buildCheckoutSessionExpiresAt(30, { pinnedNowIso }),
              line_items: checkoutLineItems,
              metadata: {
                registrationId: userRegistration.id,
                tenantId: tenant.id,
                transactionId,
              },
              mode: 'payment',
              payment_intent_data: {
                application_fee_amount: appFee,
              },
              success_url: `${eventUrl}?registrationStatus=success`,
            },
            {
              idempotencyKey: buildCheckoutSessionIdempotencyKey({
                registrationId: userRegistration.id,
                transactionId,
              }),
              stripeAccount,
            },
          ).pipe(
            Effect.mapError(
              () =>
                new EventRegistrationInternalError({
                  message: 'Failed to create stripe checkout session',
                }),
            ),
          );

          yield* databaseEffect((database) =>
            database.insert(transactions).values({
              amount: effectiveTotalPrice,
              comment: `Registration for event ${registrationOption.event.title} ${registrationOption.eventId}`,
              currency: tenant.currency,
              eventId: registrationOption.eventId,
              eventRegistrationId: userRegistration.id,
              executiveUserId: user.id,
              id: transactionId,
              method: 'stripe',
              status: 'pending',
              stripeCheckoutSessionId: session.id,
              stripeCheckoutUrl: session.url,
              stripePaymentIntentId:
                typeof session.payment_intent === 'string'
                  ? session.payment_intent
                  : session.payment_intent?.id,
              targetUserId: user.id,
              tenantId: tenant.id,
              type: 'registration',
            }),
          );
        });

        return yield* paymentFlow.pipe(
          // Any failure after reservation must rollback reservation + inserted
          // registration so callers never observe a half-created paid flow.
          Effect.catchCause((cause) =>
            rollbackOnFailure().pipe(
              Effect.orDie,
              Effect.andThen(Effect.failCause(cause)),
            ),
          ),
        );
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
                  if (lockedMemberships.length === 0) {
                    return yield* Effect.fail(
                      new EventRegistrationNotFoundError({
                        message: 'Tenant membership not found',
                      }),
                    );
                  }

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
                  return error instanceof EventRegistrationNotFoundError
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
