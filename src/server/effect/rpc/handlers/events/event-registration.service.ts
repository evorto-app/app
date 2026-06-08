import type { Headers } from 'effect/unstable/http';
import type Stripe from 'stripe';

import { and, eq, sql } from 'drizzle-orm';
import { ConfigProvider, Context, Effect, Layer, Option } from 'effect';

import { Database, type DatabaseClient } from '../../../../../db';
import { createId } from '../../../../../db/create-id';
import {
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrations,
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

interface RegisterForEventArguments {
  eventId: string;
  headers: Headers.Headers;
  registrationOptionId: string;
  tenant: Pick<Tenant, 'currency' | 'id' | 'stripeAccountId'>;
  user: Pick<User, 'email' | 'id' | 'roleIds'>;
}

export class EventRegistrationService extends Context.Service<EventRegistrationService>()(
  '@server/effect/rpc/handlers/events/EventRegistrationService',
  {
    make: Effect.sync(() => {
      const registerForEvent = Effect.fn(
        'EventRegistrationService.registerForEvent',
      )(function* ({
        eventId,
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
        if (
          registrationOption.confirmedSpots +
            registrationOption.reservedSpots >=
          registrationOption.spots
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Registration option has no available spots',
            }),
          );
        }

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
                  registrationOption.isPaid
                    ? {
                        reservedSpots: sql`${eventRegistrationOptions.reservedSpots} + 1`,
                      }
                    : {
                        confirmedSpots: sql`${eventRegistrationOptions.confirmedSpots} + 1`,
                      },
                )
                .where(
                  and(
                    eq(eventRegistrationOptions.id, registrationOption.id),
                    eq(eventRegistrationOptions.eventId, eventId),
                    sql`${eventRegistrationOptions.confirmedSpots} + ${eventRegistrationOptions.reservedSpots} < ${eventRegistrationOptions.spots}`,
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
                  registrationOptionId: registrationOption.id,
                  status: registrationOption.isPaid ? 'PENDING' : 'CONFIRMED',
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

        if (!registrationOption.isPaid) {
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
                  reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - 1`,
                })
                .where(
                  and(
                    eq(eventRegistrationOptions.id, registrationOption.id),
                    eq(eventRegistrationOptions.eventId, eventId),
                    sql`${eventRegistrationOptions.reservedSpots} > 0`,
                  ),
                ),
            );

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
          if (effectivePrice <= 0) {
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
                  confirmedSpots: sql`${eventRegistrationOptions.confirmedSpots} + 1`,
                  reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - 1`,
                })
                .where(
                  and(
                    eq(eventRegistrationOptions.id, registrationOption.id),
                    eq(eventRegistrationOptions.eventId, eventId),
                    sql`${eventRegistrationOptions.reservedSpots} > 0`,
                  ),
                ),
            );
            return;
          }

          // Phase 4: paid registration path (Stripe session + pending transaction record).
          const applicationFee = Math.round(effectivePrice * 0.035);
          const stripeAccount = tenant.stripeAccountId;
          if (!stripeAccount) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message: 'Stripe account not found',
              }),
            );
          }

          const checkoutLineItem: Stripe.Checkout.SessionCreateParams.LineItem =
            {
              price_data: {
                currency: tenant.currency,
                product_data: {
                  name: `Registration fee for ${registrationOption.event.title}`,
                },
                unit_amount: effectivePrice,
              },
              ...(selectedTaxRateId ? { tax_rates: [selectedTaxRateId] } : {}),
              quantity: 1,
            };

          const session = yield* createHostedCheckoutSession(
            {
              cancel_url: `${eventUrl}?registrationStatus=cancel`,
              customer_email: user.email,
              expires_at: buildCheckoutSessionExpiresAt(30, { pinnedNowIso }),
              line_items: [checkoutLineItem],
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
              amount: effectivePrice,
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

      return {
        registerForEvent,
      } as const;
    }),
  },
) {
  static readonly Default = Layer.effect(
    EventRegistrationService,
    EventRegistrationService.make,
  );

  static readonly registerForEvent = (input: RegisterForEventArguments) =>
    EventRegistrationService.use((service) => service.registerForEvent(input));
}
