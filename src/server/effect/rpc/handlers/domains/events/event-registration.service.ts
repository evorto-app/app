import type { Headers } from '@effect/platform';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { DateTime } from 'luxon';

import { Database, type DatabaseClient } from '../../../../../../db';
import { createId } from '../../../../../../db/create-id';
import {
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrations,
  tenantStripeTaxRates,
  tenants,
  transactions,
  userDiscountCards,
} from '../../../../../../db/schema';
import { type TenantDiscountProviders, resolveTenantDiscountProviders } from '../../../../../../shared/tenant-config';
import { type Tenant } from '../../../../../../types/custom/tenant';
import { type User } from '../../../../../../types/custom/user';
import { stripe } from '../../../../../stripe-client';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from './events.errors';

const dbEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Effect.flatMap(Database, (database) => operation(database).pipe(Effect.orDie));

interface RegisterForEventArgs {
  eventId: string;
  headers: Headers.Headers;
  registrationOptionId: string;
  tenant: Pick<Tenant, 'currency' | 'id' | 'stripeAccountId'>;
  user: Pick<User, 'email' | 'id'>;
}

export class EventRegistrationService extends Effect.Service<EventRegistrationService>()(
  '@server/effect/rpc/handlers/domains/events/EventRegistrationService',
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const registerForEvent = Effect.fn(
        'EventRegistrationService.registerForEvent',
      )(function* ({
        eventId,
        headers,
        registrationOptionId,
        tenant,
        user,
      }: RegisterForEventArgs) {
        const existingRegistration = yield* dbEffect((database) =>
          database.query.eventRegistrations.findFirst({
            where: {
              eventId,
              status: { NOT: 'CANCELLED' },
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

        const registrationOption = yield* dbEffect((database) =>
          database.query.eventRegistrationOptions.findFirst({
            where: { eventId, id: registrationOptionId },
            with: {
              event: {
                columns: {
                  start: true,
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
        if (
          registrationOption.confirmedSpots + registrationOption.reservedSpots >=
          registrationOption.spots
        ) {
          return yield* Effect.fail(
            new EventRegistrationConflictError({
              message: 'Registration option has no available spots',
            }),
          );
        }

        const selectedTaxRateId = registrationOption.stripeTaxRateId ?? undefined;
        const selectedTaxRate = selectedTaxRateId
          ? yield* dbEffect((database) =>
              database.query.tenantStripeTaxRates.findFirst({
                where: {
                  stripeTaxRateId: selectedTaxRateId,
                  tenantId: tenant.id,
                },
              }),
            )
          : undefined;

        const createdRegistrations = yield* dbEffect((database) =>
          database
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
            }),
        );
        const userRegistration = createdRegistrations[0];
        if (!userRegistration) {
          return yield* Effect.fail(
            new EventRegistrationInternalError({
              message: 'Failed to create registration',
            }),
          );
        }

        yield* dbEffect((database) =>
          database
            .update(eventRegistrationOptions)
            .set(
              registrationOption.isPaid
                ? { reservedSpots: registrationOption.reservedSpots + 1 }
                : {
                    confirmedSpots: registrationOption.confirmedSpots + 1,
                  },
            )
            .where(
              and(
                eq(eventRegistrationOptions.id, registrationOption.id),
                eq(eventRegistrationOptions.eventId, eventId),
              ),
            ),
        );

        if (!registrationOption.isPaid) {
          return;
        }

        const rollbackOnFailure = Effect.fn(
          'EventRegistrationService.registerForEvent.rollbackOnFailure',
        )(
          () =>
            Effect.gen(function* () {
              const rollbackRegistrationOption = yield* dbEffect((database) =>
                database.query.eventRegistrationOptions.findFirst({
                  where: {
                    eventId,
                    id: registrationOptionId,
                  },
                }),
              );

              if (rollbackRegistrationOption) {
                yield* dbEffect((database) =>
                  database
                    .update(eventRegistrationOptions)
                    .set({
                      reservedSpots: Math.max(
                        0,
                        rollbackRegistrationOption.reservedSpots - 1,
                      ),
                    })
                    .where(
                      and(
                        eq(eventRegistrationOptions.id, rollbackRegistrationOption.id),
                        eq(eventRegistrationOptions.eventId, eventId),
                      ),
                    ),
                );
              }

              yield* dbEffect((database) =>
                database
                  .delete(eventRegistrations)
                  .where(eq(eventRegistrations.id, userRegistration.id)),
              );
            }),
        );

        const paymentFlow = Effect.gen(function* () {
          const transactionId = createId();
          const forwardedProtocol = headers['x-forwarded-proto']
            ?.split(',')[0]
            ?.trim();
          const forwardedHost = headers['x-forwarded-host']
            ?.split(',')[0]
            ?.trim();
          const host = forwardedHost ?? headers['host'];
          const origin =
            headers['origin'] ??
            (host ? `${forwardedProtocol ?? 'http'}://${host}` : undefined);
          const eventUrl = `${origin ?? ''}/events/${eventId}`;

          const basePrice = registrationOption.price;
          let effectivePrice = registrationOption.price;
          let appliedDiscountType:
            | null
            | typeof eventRegistrationOptionDiscounts.$inferSelect.discountType =
            null;
          let appliedDiscountedPrice: null | number = null;

          const cards = yield* dbEffect((database) =>
            database.query.userDiscountCards.findMany({
              where: {
                status: 'verified',
                tenantId: tenant.id,
                userId: user.id,
              },
            }),
          );
          if (cards.length > 0) {
            const tenantRecord = yield* dbEffect((database) =>
              database.query.tenants.findFirst({
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
            const discounts = yield* dbEffect((database) =>
              database.query.eventRegistrationOptionDiscounts.findMany({
                where: { registrationOptionId: registrationOption.id },
              }),
            );
            const eventStart = registrationOption.event.start ?? new Date();
            const eligible = discounts.filter((discount) =>
              cards.some(
                (card) =>
                  card.type === discount.discountType &&
                  enabledTypes.has(card.type) &&
                  (!card.validTo || card.validTo > eventStart),
              ),
            );
            if (eligible.length > 0) {
              let bestDiscount = eligible[0];
              for (const candidate of eligible.slice(1)) {
                if (candidate.discountedPrice < bestDiscount.discountedPrice) {
                  bestDiscount = candidate;
                }
              }
              effectivePrice = bestDiscount.discountedPrice;
              appliedDiscountType = bestDiscount.discountType;
              appliedDiscountedPrice = bestDiscount.discountedPrice;
            }
          }

          const discountAmount =
            appliedDiscountedPrice === null
              ? null
              : Math.max(0, basePrice - appliedDiscountedPrice);

          yield* dbEffect((database) =>
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

          if (effectivePrice <= 0) {
            yield* dbEffect((database) =>
              database
                .update(eventRegistrations)
                .set({
                  status: 'CONFIRMED',
                })
                .where(eq(eventRegistrations.id, userRegistration.id)),
            );

            yield* dbEffect((database) =>
              database
                .update(eventRegistrationOptions)
                .set({
                  confirmedSpots: registrationOption.confirmedSpots + 1,
                  reservedSpots: Math.max(0, registrationOption.reservedSpots - 1),
                })
                .where(eq(eventRegistrationOptions.id, registrationOption.id)),
            );
            return;
          }

          const applicationFee = Math.round(effectivePrice * 0.035);
          const stripeAccount = tenant.stripeAccountId;
          if (!stripeAccount) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message: 'Stripe account not found',
              }),
            );
          }

          const session = yield* Effect.tryPromise({
            catch: () =>
              new EventRegistrationInternalError({
                message: 'Failed to create stripe checkout session',
              }),
            try: () =>
              stripe.checkout.sessions.create(
                {
                  cancel_url: `${eventUrl}?registrationStatus=cancel`,
                  customer_email: user.email,
                  expires_at: Math.ceil(
                    DateTime.local().plus({ minutes: 30 }).toSeconds(),
                  ),
                  line_items: [
                    {
                      price_data: {
                        currency: tenant.currency,
                        product_data: {
                          name: `Registration fee for ${registrationOption.event.title}`,
                        },
                        unit_amount: effectivePrice,
                      },
                      ...(selectedTaxRateId
                        ? { tax_rates: [selectedTaxRateId] as string[] }
                        : {}),
                      quantity: 1,
                    },
                  ],
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
                { stripeAccount },
              ),
          });

          yield* dbEffect((database) =>
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
          Effect.catchAllCause(() =>
            rollbackOnFailure().pipe(
              Effect.orDie,
              Effect.zipRight(
                Effect.fail(
                  new EventRegistrationInternalError({
                    message: 'Failed to initialize paid event registration',
                  }),
                ),
              ),
            ),
          ),
        );
      });

      return {
        registerForEvent,
      } as const;
    }),
  },
) {}
