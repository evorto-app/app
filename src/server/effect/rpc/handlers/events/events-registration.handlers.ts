import {
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import { and, eq, gte, sql } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database } from '../../../../../db';
import {
  eventRegistrationOptions,
  eventRegistrations,
  transactions,
} from '../../../../../db/schema';
import { StripeClient } from '../../../../stripe-client';
import { RpcAccess } from '../shared/rpc-access.service';
import { EventRegistrationService } from './event-registration.service';
import { databaseEffect } from './events.shared';

export const eventRegistrationHandlers = {
'events.cancelPendingRegistration': ({ registrationId }, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensureAuthenticated();
        const stripe = yield* StripeClient;
        const { tenant } = yield* RpcAccess.current();
        const user = yield* RpcAccess.requireUser();

        const registration = yield* databaseEffect((database) =>
          database.query.eventRegistrations.findFirst({
            columns: {
              id: true,
              registrationOptionId: true,
            },
            where: {
              id: registrationId,
              status: 'PENDING',
              tenantId: tenant.id,
              userId: user.id,
            },
            with: {
              registrationOption: {
                columns: {
                  reservedSpots: true,
                },
              },
              transactions: {
                columns: {
                  id: true,
                  method: true,
                  status: true,
                  stripeCheckoutSessionId: true,
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

        const pendingStripeTransaction = registration.transactions.find(
          (currentTransaction) =>
            currentTransaction.status === 'pending' &&
            currentTransaction.method === 'stripe',
        );
        const stripeCheckoutSessionId =
          pendingStripeTransaction?.stripeCheckoutSessionId;
        const stripeAccount = tenant.stripeAccountId;
        if (stripeCheckoutSessionId && !stripeAccount) {
          return yield* Effect.fail(
            new EventRegistrationInternalError({
              message: 'Stripe account not found',
            }),
          );
        }

        const cancelledStripeTransaction = yield* Database.pipe(
          Effect.flatMap((database) =>
            database.transaction((tx) =>
              Effect.gen(function* () {
                const cancelledRegistrations = yield* tx
                  .update(eventRegistrations)
                  .set({
                    status: 'CANCELLED',
                  })
                  .where(
                    and(
                      eq(eventRegistrations.id, registration.id),
                      eq(eventRegistrations.status, 'PENDING'),
                    ),
                  )
                  .returning({
                    id: eventRegistrations.id,
                  });
                if (cancelledRegistrations.length === 0) {
                  return yield* Effect.fail(
                    new EventRegistrationNotFoundError({
                      message: 'Registration not found',
                    }),
                  );
                }

                const updatedOptions = yield* tx
                  .update(eventRegistrationOptions)
                  .set({
                    reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - 1`,
                  })
                  .where(
                    and(
                      eq(
                        eventRegistrationOptions.id,
                        registration.registrationOptionId,
                      ),
                      gte(eventRegistrationOptions.reservedSpots, 1),
                    ),
                  )
                  .returning({
                    id: eventRegistrationOptions.id,
                  });
                if (updatedOptions.length === 0) {
                  return yield* Effect.fail(
                    new EventRegistrationInternalError({
                      message: 'Registration option missing',
                    }),
                  );
                }

                if (!pendingStripeTransaction) {
                  return null;
                }

                yield* tx
                  .update(transactions)
                  .set({
                    status: 'cancelled',
                  })
                  .where(eq(transactions.id, pendingStripeTransaction.id));

                return {
                  stripeCheckoutSessionId,
                  transactionId: pendingStripeTransaction.id,
                };
              }),
            ),
          ),
          Effect.catchAll((error) =>
            error instanceof EventRegistrationInternalError
              ? Effect.fail(error)
              : Effect.fail(
                  new EventRegistrationInternalError({
                    cause: error,
                    message: 'Internal server error',
                  }),
                ),
          ),
        );

        if (!cancelledStripeTransaction || !stripeCheckoutSessionId || !stripeAccount) {
          return;
        }

        yield* Effect.tryPromise(() =>
          Promise.race([
            stripe.checkout.sessions.expire(
              stripeCheckoutSessionId,
              undefined,
              {
                stripeAccount,
              },
            ),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Stripe checkout expiry timed out')), 5000);
            }),
          ]),
        ).pipe(
          Effect.tapError((error) =>
            Effect.logError(
              'Failed to expire Stripe checkout session on registration cancellation',
            ).pipe(
              Effect.annotateLogs({
                error,
                registrationId: registration.id,
                stripeCheckoutSessionId,
                transactionId: cancelledStripeTransaction.transactionId,
              }),
            ),
          ),
          Effect.catchAll(() => Effect.void),
        );
      }),
'events.getRegistrationStatus': ({ eventId }, _options) =>
      Effect.gen(function* () {
        const { tenant } = yield* RpcAccess.current();
        const { user } = yield* RpcAccess.current();
        if (!user) {
          return {
            isRegistered: false,
            registrations: [],
          };
        }

        const registrations = yield* databaseEffect((database) =>
          database.query.eventRegistrations.findMany({
            columns: {
              appliedDiscountedPrice: true,
              appliedDiscountType: true,
              basePriceAtRegistration: true,
              discountAmount: true,
              id: true,
              registrationOptionId: true,
              status: true,
            },
            where: {
              eventId,
              status: {
                NOT: 'CANCELLED',
              },
              tenantId: tenant.id,
              userId: user.id,
            },
            with: {
              registrationOption: {
                columns: {
                  price: true,
                  registeredDescription: true,
                  title: true,
                },
              },
              transactions: {
                columns: {
                  amount: true,
                  method: true,
                  status: true,
                  stripeCheckoutUrl: true,
                  type: true,
                },
              },
            },
          }),
        );

        const registrationSummaries = registrations.map((registration) => {
          const registrationOption = registration.registrationOption;
          if (!registrationOption) {
            throw new Error(
              `Registration option missing for registration ${registration.id}`,
            );
          }

          const registrationTransaction = registration.transactions.find(
            (transaction) =>
              transaction.type === 'registration' &&
              transaction.amount < registrationOption.price,
          );

          const discountedPrice =
            registration.appliedDiscountedPrice ??
            registrationTransaction?.amount ??
            undefined;
          const appliedDiscountType =
            registration.appliedDiscountType ??
            (discountedPrice === undefined ? undefined : ('esnCard' as const));
          const basePriceAtRegistration =
            registration.basePriceAtRegistration ??
            (discountedPrice === undefined
              ? undefined
              : registrationOption.price);
          const discountAmount =
            registration.discountAmount ??
            (discountedPrice === undefined
              ? undefined
              : registrationOption.price - discountedPrice);

          return {
            appliedDiscountedPrice: discountedPrice,
            appliedDiscountType,
            basePriceAtRegistration,
            checkoutUrl: registration.transactions.find(
              (transaction) =>
                transaction.method === 'stripe' &&
                transaction.type === 'registration',
            )?.stripeCheckoutUrl,
            discountAmount,
            id: registration.id,
            paymentPending: registration.transactions.some(
              (transaction) =>
                transaction.status === 'pending' &&
                transaction.type === 'registration',
            ),
            registeredDescription: registrationOption.registeredDescription,
            registrationOptionId: registration.registrationOptionId,
            registrationOptionTitle: registrationOption.title,
            status: registration.status,
          };
        });

        return {
          isRegistered: registrations.length > 0,
          registrations: registrationSummaries,
        };
      }),
'events.registerForEvent': ({ eventId, registrationOptionId }, options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensureAuthenticated();
        const { tenant } = yield* RpcAccess.current();
        const user = yield* RpcAccess.requireUser();

        return yield* EventRegistrationService.registerForEvent({
          eventId,
          headers: options.headers,
          registrationOptionId,
          tenant: {
            currency: tenant.currency,
            id: tenant.id,
            stripeAccountId: tenant.stripeAccountId,
          },
          user: {
            email: user.email,
            id: user.id,
          },
        });
      }),
'events.registrationScanned': ({ registrationId }, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensureAuthenticated();
        const { tenant } = yield* RpcAccess.current();
        const user = yield* RpcAccess.requireUser();

        const registration = yield* databaseEffect((database) =>
          database.query.eventRegistrations.findFirst({
            columns: {
              appliedDiscountedPrice: true,
              appliedDiscountType: true,
              status: true,
              userId: true,
            },
            where: { id: registrationId, tenantId: tenant.id },
            with: {
              event: {
                columns: {
                  start: true,
                  title: true,
                },
              },
              registrationOption: {
                columns: {
                  price: true,
                  title: true,
                },
              },
              transactions: {
                columns: {
                  amount: true,
                },
                where: {
                  type: 'registration',
                },
              },
              user: {
                columns: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          }),
        );
        if (
          !registration ||
          !registration.user ||
          !registration.event ||
          !registration.registrationOption
        ) {
          return yield* Effect.fail(
            new EventRegistrationNotFoundError({
              message: 'Registration not found',
            }),
          );
        }

        const sameUserIssue = registration.userId === user.id;
        const registrationStatusIssue = registration.status !== 'CONFIRMED';
        const allowCheckin = !registrationStatusIssue && !sameUserIssue;
        const discountedTransaction = registration.transactions.find(
          (transaction) =>
            transaction.amount < registration.registrationOption.price,
        );
        const appliedDiscountedPrice =
          registration.appliedDiscountedPrice ??
          discountedTransaction?.amount ??
          null;
        const appliedDiscountType =
          registration.appliedDiscountType ??
          (appliedDiscountedPrice === null ? null : ('esnCard' as const));

        return {
          allowCheckin,
          appliedDiscountType,
          event: {
            start: registration.event.start.toISOString(),
            title: registration.event.title,
          },
          registrationOption: {
            title: registration.registrationOption.title,
          },
          registrationStatusIssue,
          sameUserIssue,
          user: {
            firstName: registration.user.firstName,
            lastName: registration.user.lastName,
          },
        };
      }),
} satisfies Partial<AppRpcHandlers>;
