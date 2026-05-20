import type { Headers } from 'effect/unstable/http';
import type Stripe from 'stripe';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { ConfigProvider, Context, Effect, Layer, Option } from 'effect';

import { Database, type DatabaseClient } from '../../../../../db';
import { createId } from '../../../../../db/create-id';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventRegistrationAddonPurchases,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrations,
  tenantStripeTaxRates,
  transactions,
  userDiscountCards,
} from '../../../../../db/schema';
import {
  resolveTenantDiscountProviders,
  type TenantDiscountProviders,
} from '../../../../../shared/tenant-config';
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

type DiscountCardRecord = Pick<
  typeof userDiscountCards.$inferSelect,
  'type' | 'validTo'
>;

interface DiscountResolution {
  appliedDiscountedPrice: null | number;
  appliedDiscountType:
    | null
    | typeof eventRegistrationOptionDiscounts.$inferSelect.discountType;
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

const resolveRequestOrigin = (headers: Headers.Headers): string | undefined => {
  const forwardedProtocol = headers['x-forwarded-proto']?.split(',')[0]?.trim();
  const forwardedHost = headers['x-forwarded-host']?.split(',')[0]?.trim();
  const host = forwardedHost ?? headers['host'];

  return (
    headers['origin'] ??
    (host ? `${forwardedProtocol ?? 'http'}://${host}` : undefined)
  );
};

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
  headers: Headers.Headers;
  registrationOptionId: string;
  tenant: Pick<Tenant, 'currency' | 'id' | 'stripeAccountId'>;
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

  return [...normalizedAnswers.entries()]
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
}): readonly (RegistrationAddonRecord & { selectedQuantity: number })[] => {
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

  return [...selectedAddOns.entries()].map(([addOnId, selectedQuantity]) => {
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
    if (selectedQuantity > availableAddOn.totalAvailableQuantity) {
      throw new EventRegistrationConflictError({
        message: 'Add-on quantity is no longer available',
      });
    }

    return {
      ...availableAddOn,
      selectedQuantity,
    };
  });
};

export class EventRegistrationService extends Context.Service<EventRegistrationService>()(
  '@server/effect/rpc/handlers/events/EventRegistrationService',
  {
    make: Effect.sync(() => {
      const registerForEvent = Effect.fn(
        'EventRegistrationService.registerForEvent',
      )(function* ({
        addOns,
        answers,
        eventId,
        guestCount,
        headers,
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
        if (registrationOption.registrationMode !== 'fcfs') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Registration option mode is not available yet',
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
          (total, addOn) => total + addOn.price * addOn.selectedQuantity,
          0,
        );
        const requiresCheckout =
          registrationOption.isPaid || selectedAddonTotalPrice > 0;

        // Phase 2: create registration row and reserve/confirm a spot immediately.
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

        const reservationResult = yield* databaseEffect((database) =>
          database.transaction((tx) =>
            Effect.gen(function* () {
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

              const createdRegistrations = yield* tx
                .insert(eventRegistrations)
                .values({
                  eventId,
                  guestCount,
                  registrationOptionId: registrationOption.id,
                  status: requiresCheckout ? 'PENDING' : 'CONFIRMED',
                  ...(selectedTaxRateId
                    ? {
                        stripeTaxRateId: selectedTaxRateId,
                        taxRateDisplayName: selectedTaxRate?.displayName,
                        taxRateInclusive: selectedTaxRate?.inclusive,
                        taxRatePercentage: selectedTaxRate?.percentage,
                      }
                    : {}),
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
                const updatedAddOns = yield* tx
                  .update(eventAddons)
                  .set({
                    totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} - ${addOn.selectedQuantity}`,
                  })
                  .where(
                    and(
                      eq(eventAddons.id, addOn.addOnId),
                      eq(eventAddons.eventId, eventId),
                      sql`${eventAddons.totalAvailableQuantity} >= ${addOn.selectedQuantity}`,
                    ),
                  )
                  .returning({
                    id: eventAddons.id,
                  });
                if (updatedAddOns.length === 0) {
                  return { _tag: 'AddonUnavailable' } as const;
                }

                yield* tx.insert(eventRegistrationAddonPurchases).values({
                  addonId: addOn.addOnId,
                  quantity: addOn.selectedQuantity,
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
        if (reservationResult._tag === 'AddonUnavailable') {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Add-on quantity is no longer available',
            }),
          );
        }

        if (!requiresCheckout) {
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
                    totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${addOn.selectedQuantity}`,
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
          const origin = resolveRequestOrigin(headers);
          const eventUrl = `${origin ?? ''}/events/${eventId}`;

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
          const applicationFee = Math.round(effectiveTotalPrice * 0.035);
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
              ...(selectedTaxRateId ? { tax_rates: [selectedTaxRateId] } : {}),
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
                ...(selectedTaxRateId
                  ? { tax_rates: [selectedTaxRateId] }
                  : {}),
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
              ...(addOn.stripeTaxRateId
                ? { tax_rates: [addOn.stripeTaxRateId] }
                : {}),
              quantity: addOn.selectedQuantity,
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
                application_fee_amount: applicationFee,
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

          const waitlistResult = yield* databaseEffect((database) =>
            database.transaction((tx) =>
              Effect.gen(function* () {
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

  static readonly joinWaitlist = (input: JoinWaitlistArguments) =>
    EventRegistrationService.use((service) => service.joinWaitlist(input));

  static readonly registerForEvent = (input: RegisterForEventArguments) =>
    EventRegistrationService.use((service) => service.registerForEvent(input));
}
