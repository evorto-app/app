import { eq } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import {
  eventRegistrationOptions,
  eventRegistrations,
  transactions,
} from '../../../../../db/schema';
import { stripe } from '../../../../stripe-client';
import { RpcAccess } from '../shared/rpc-access.service';
import { mapEventRegistrationErrorToRpc } from '../shared/rpc-error-mappers';
import { EventRegistrationService } from './event-registration.service';
import { databaseEffect } from './events.shared';

export const eventRegistrationHandlers = {
'events.cancelPendingRegistration': ({ registrationId }, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensureAuthenticated();
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
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        yield* databaseEffect((database) =>
          database.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(eventRegistrations)
                .set({
                  status: 'CANCELLED',
                })
                .where(eq(eventRegistrations.id, registration.id));

              const reservedSpots =
                registration.registrationOption?.reservedSpots;
              if (reservedSpots === undefined) {
                return yield* Effect.fail(
                  new Error('Registration option missing'),
                );
              }

              yield* tx
                .update(eventRegistrationOptions)
                .set({
                  reservedSpots: reservedSpots - 1,
                })
                .where(
                  eq(
                    eventRegistrationOptions.id,
                    registration.registrationOptionId,
                  ),
                );

              const transaction = registration.transactions.find(
                (currentTransaction) =>
                  currentTransaction.status === 'pending' &&
                  currentTransaction.method === 'stripe',
              );

              if (!transaction) {
                return;
              }

              yield* tx
                .update(transactions)
                .set({
                  status: 'cancelled',
                })
                .where(eq(transactions.id, transaction.id));

              const stripeCheckoutSessionId = transaction.stripeCheckoutSessionId;
              if (!stripeCheckoutSessionId) {
                return;
              }

              const stripeAccount = tenant.stripeAccountId;
              if (!stripeAccount) {
                return yield* Effect.fail(new Error('Stripe account not found'));
              }
              yield* Effect.tryPromise(() =>
                stripe.checkout.sessions.expire(
                  stripeCheckoutSessionId,
                  undefined,
                  {
                    stripeAccount,
                  },
                ),
              ).pipe(
                Effect.tapError((error) =>
                  Effect.logError(
                    'Failed to expire Stripe checkout session on registration cancellation',
                  ).pipe(
                    Effect.annotateLogs({
                      error,
                      registrationId: registration.id,
                      stripeCheckoutSessionId,
                      transactionId: transaction.id,
                    }),
                  ),
                ),
              );
            }),
          ),
        ).pipe(Effect.mapError(() => 'INTERNAL_SERVER_ERROR' as const));
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
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(mapEventRegistrationErrorToRpc(error)),
          ),
        );
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
        if (!registration || !registration.user || !registration.event) {
          return yield* Effect.fail('NOT_FOUND' as const);
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
