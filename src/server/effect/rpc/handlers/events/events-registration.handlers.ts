import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  includesPermission,
  type Permission,
} from '@shared/permissions/permissions';
import { registrationSpotCount } from '@shared/registration-spots';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
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

const isRegistrationScanRpcError = (
  error: unknown,
): error is
  | EventRegistrationConflictError
  | EventRegistrationInternalError
  | EventRegistrationNotFoundError
  | RpcForbiddenError
  | RpcUnauthorizedError =>
  error instanceof EventRegistrationConflictError ||
  error instanceof EventRegistrationInternalError ||
  error instanceof EventRegistrationNotFoundError ||
  error instanceof RpcForbiddenError ||
  error instanceof RpcUnauthorizedError;

const mapRegistrationScanInternalError = (error: unknown) =>
  isRegistrationScanRpcError(error)
    ? Effect.fail(error)
    : Effect.fail(
        new EventRegistrationInternalError({
          cause: error,
          message: 'Internal server error',
        }),
      );

const CHECK_IN_PRE_START_WINDOW_MS = 60 * 60 * 1000;

const isWithinCheckInWindow = (eventStart: Date, now = new Date()): boolean =>
  eventStart.getTime() - now.getTime() <= CHECK_IN_PRE_START_WINDOW_MS;

const ensureCanScanEventRegistration = ({
  eventId,
  tenantId,
  user,
}: {
  eventId: string;
  tenantId: string;
  user: {
    id: string;
    permissions: readonly Permission[];
  };
}) =>
  Effect.gen(function* () {
    if (includesPermission('events:organizeAll', user.permissions)) {
      return;
    }

    const organizerRegistrations = yield* databaseEffect((database) =>
      database.query.eventRegistrations.findMany({
        columns: {
          id: true,
        },
        where: {
          eventId,
          status: 'CONFIRMED',
          tenantId,
          userId: user.id,
        },
        with: {
          registrationOption: {
            columns: {
              organizingRegistration: true,
            },
          },
        },
      }),
    );

    if (
      organizerRegistrations.some(
        (registration) =>
          registration.registrationOption?.organizingRegistration === true,
      )
    ) {
      return;
    }

    return yield* Effect.fail(
      new RpcForbiddenError({
        message: 'Missing required event check-in access',
        permission: 'events:organizeAll',
      }),
    );
  });

const cancelRegistration = ({
  eventId,
  registrationId,
  requireOrganizerAccess = false,
}: {
  eventId?: string;
  registrationId: string;
  requireOrganizerAccess?: boolean;
}) =>
  Effect.gen(function* () {
    yield* RpcAccess.ensureAuthenticated();
    const stripe = yield* StripeClient;
    const { tenant } = yield* RpcAccess.current();
    const user = yield* RpcAccess.requireUser();
    const now = new Date();

    const registration = yield* databaseEffect((database) =>
      database.query.eventRegistrations.findFirst({
        columns: {
          checkInTime: true,
          eventId: true,
          guestCount: true,
          id: true,
          registrationOptionId: true,
          status: true,
        },
        where: {
          ...(eventId ? { eventId } : {}),
          id: registrationId,
          status: { NOT: 'CANCELLED' },
          tenantId: tenant.id,
          ...(requireOrganizerAccess ? {} : { userId: user.id }),
        },
        with: {
          event: {
            columns: {
              start: true,
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

    if (requireOrganizerAccess) {
      yield* ensureCanScanEventRegistration({
        eventId: registration.eventId,
        tenantId: tenant.id,
        user,
      });
    }

    if (
      registration.status !== 'PENDING' &&
      registration.status !== 'CONFIRMED' &&
      registration.status !== 'WAITLIST'
    ) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message:
            'Only pending, confirmed, or waitlisted registrations can be cancelled',
        }),
      );
    }

    if (!registration.event) {
      return yield* Effect.fail(
        new EventRegistrationInternalError({
          message: 'Registration event relation missing',
        }),
      );
    }

    if (registration.checkInTime) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message: 'Checked-in registrations cannot be cancelled',
        }),
      );
    }

    if (registration.event.start <= now) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message: 'Registration can no longer be cancelled',
        }),
      );
    }
    const registeredSpotCount = registrationSpotCount(registration.guestCount);

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

    const cancelledStripeTransaction = yield* Database.use((database) =>
      database
        .transaction((tx) =>
          Effect.gen(function* () {
            const cancelledRegistrations = yield* tx
              .update(eventRegistrations)
              .set({
                status: 'CANCELLED',
              })
              .where(
                and(
                  eq(eventRegistrations.id, registration.id),
                  eq(eventRegistrations.status, registration.status),
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
              .set(
                registration.status === 'PENDING'
                  ? {
                      reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${registeredSpotCount}`,
                    }
                  : registration.status === 'CONFIRMED'
                    ? {
                        confirmedSpots: sql`${eventRegistrationOptions.confirmedSpots} - ${registeredSpotCount}`,
                      }
                    : {
                        waitlistSpots: sql`${eventRegistrationOptions.waitlistSpots} - ${registeredSpotCount}`,
                      },
              )
              .where(
                and(
                  eq(
                    eventRegistrationOptions.id,
                    registration.registrationOptionId,
                  ),
                  registration.status === 'PENDING'
                    ? gte(
                        eventRegistrationOptions.reservedSpots,
                        registeredSpotCount,
                      )
                    : registration.status === 'CONFIRMED'
                      ? gte(
                          eventRegistrationOptions.confirmedSpots,
                          registeredSpotCount,
                        )
                      : gte(
                          eventRegistrationOptions.waitlistSpots,
                          registeredSpotCount,
                        ),
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
                    message: 'Internal server error',
                  }),
                ),
          ),
        ),
    );

    if (
      !cancelledStripeTransaction ||
      !stripeCheckoutSessionId ||
      !stripeAccount
    ) {
      return;
    }

    yield* Effect.tryPromise(() =>
      Promise.race([
        stripe.checkout.sessions.expire(stripeCheckoutSessionId, undefined, {
          stripeAccount,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('Stripe checkout expiry timed out')),
            5000,
          );
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
      Effect.catch(() => Effect.void),
    );
  });

export const eventRegistrationHandlers = {
  'events.cancelEventRegistration': ({ eventId, registrationId }, _options) =>
    cancelRegistration({
      eventId,
      registrationId,
      requireOrganizerAccess: true,
    }),
  'events.cancelPendingRegistration': ({ registrationId }, _options) =>
    cancelRegistration({ registrationId }),
  'events.cancelRegistration': ({ registrationId }, _options) =>
    cancelRegistration({ registrationId }),
  'events.checkInRegistration': (
    { guestCheckInCount, registrationId },
    _options,
  ) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      if (!Number.isInteger(guestCheckInCount) || guestCheckInCount < 0) {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Guest check-in count must be a non-negative integer',
          }),
        );
      }

      const registration = yield* databaseEffect((database) =>
        database.query.eventRegistrations.findFirst({
          columns: {
            checkedInGuestCount: true,
            checkInTime: true,
            eventId: true,
            guestCount: true,
            id: true,
            registrationOptionId: true,
            status: true,
            userId: true,
          },
          where: {
            id: registrationId,
            tenantId: tenant.id,
          },
          with: {
            event: {
              columns: {
                start: true,
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

      yield* ensureCanScanEventRegistration({
        eventId: registration.eventId,
        tenantId: tenant.id,
        user,
      });

      if (registration.userId === user.id) {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Users cannot check in their own registration',
          }),
        );
      }

      if (registration.status !== 'CONFIRMED') {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Only confirmed registrations can be checked in',
          }),
        );
      }

      const remainingGuestCount = Math.max(
        0,
        registration.guestCount - registration.checkedInGuestCount,
      );
      if (guestCheckInCount > remainingGuestCount) {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Guest check-in count exceeds remaining guests',
          }),
        );
      }

      if (registration.checkInTime && remainingGuestCount === 0) {
        return {
          alreadyCheckedIn: true,
          checkInTime: registration.checkInTime.toISOString(),
        };
      }
      if (registration.checkInTime && guestCheckInCount === 0) {
        return {
          alreadyCheckedIn: true,
          checkInTime: registration.checkInTime.toISOString(),
        };
      }
      if (
        !registration.event ||
        !isWithinCheckInWindow(registration.event.start)
      ) {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Check-in is not open for this event yet',
          }),
        );
      }

      const checkInTime = new Date();
      const checkedInSpotCount =
        (registration.checkInTime ? 0 : 1) + guestCheckInCount;
      const checkedInRegistration = yield* Database.use((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            const updatedRegistrations = yield* tx
              .update(eventRegistrations)
              .set({
                ...(registration.checkInTime ? {} : { checkInTime }),
                checkedInGuestCount: sql`${eventRegistrations.checkedInGuestCount} + ${guestCheckInCount}`,
              })
              .where(
                and(
                  eq(eventRegistrations.id, registration.id),
                  eq(eventRegistrations.tenantId, tenant.id),
                  eq(eventRegistrations.status, 'CONFIRMED'),
                  registration.checkInTime
                    ? sql`${eventRegistrations.checkedInGuestCount} + ${guestCheckInCount} <= ${eventRegistrations.guestCount}`
                    : isNull(eventRegistrations.checkInTime),
                ),
              )
              .returning({
                checkedInGuestCount: eventRegistrations.checkedInGuestCount,
                checkInTime: eventRegistrations.checkInTime,
                id: eventRegistrations.id,
              });

            if (updatedRegistrations.length === 0) {
              return {
                alreadyCheckedIn: true,
                checkInTime,
              };
            }

            const updatedOptions = yield* tx
              .update(eventRegistrationOptions)
              .set({
                checkedInSpots: sql`${eventRegistrationOptions.checkedInSpots} + ${checkedInSpotCount}`,
              })
              .where(
                and(
                  eq(
                    eventRegistrationOptions.id,
                    registration.registrationOptionId,
                  ),
                  eq(eventRegistrationOptions.eventId, registration.eventId),
                ),
              )
              .returning({
                id: eventRegistrationOptions.id,
              });

            if (updatedOptions.length === 0) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message: 'Registration option not found for check-in',
                }),
              );
            }

            return {
              alreadyCheckedIn: false,
              checkInTime: updatedRegistrations[0].checkInTime ?? checkInTime,
            };
          }),
        ),
      );

      return {
        alreadyCheckedIn: checkedInRegistration.alreadyCheckedIn,
        checkInTime: checkedInRegistration.checkInTime.toISOString(),
      };
    }).pipe(Effect.catch(mapRegistrationScanInternalError)),
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
            guestCount: true,
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
          guestCount: registration.guestCount,
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
  'events.joinWaitlist': ({ eventId, registrationOptionId }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

      return yield* EventRegistrationService.joinWaitlist({
        eventId,
        registrationOptionId,
        tenant: {
          id: tenant.id,
        },
        user: {
          id: user.id,
          roleIds: user.roleIds,
        },
      });
    }),
  'events.registerForEvent': (
    { eventId, guestCount, registrationOptionId },
    options,
  ) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

      return yield* EventRegistrationService.registerForEvent({
        eventId,
        guestCount,
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
          roleIds: user.roleIds,
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
            checkedInGuestCount: true,
            checkInTime: true,
            eventId: true,
            guestCount: true,
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

      yield* ensureCanScanEventRegistration({
        eventId: registration.eventId,
        tenantId: tenant.id,
        user,
      });

      const sameUserIssue = registration.userId === user.id;
      const registrationStatusIssue = registration.status !== 'CONFIRMED';
      const remainingGuestCount = Math.max(
        0,
        registration.guestCount - registration.checkedInGuestCount,
      );
      const alreadyCheckedInIssue =
        registration.checkInTime !== null && remainingGuestCount === 0;
      const timingIssue = !isWithinCheckInWindow(registration.event.start);
      const allowCheckin =
        !registrationStatusIssue &&
        !sameUserIssue &&
        !timingIssue &&
        !alreadyCheckedInIssue;
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
        alreadyCheckedInIssue,
        appliedDiscountType,
        attendeeCheckedIn: registration.checkInTime !== null,
        checkedInGuestCount: registration.checkedInGuestCount,
        event: {
          start: registration.event.start.toISOString(),
          title: registration.event.title,
        },
        guestCount: registration.guestCount,
        registrationOption: {
          title: registration.registrationOption.title,
        },
        registrationStatusIssue,
        remainingGuestCount,
        sameUserIssue,
        user: {
          firstName: registration.user.firstName,
          lastName: registration.user.lastName,
        },
      };
    }).pipe(Effect.catch(mapRegistrationScanInternalError)),
} satisfies Partial<AppRpcHandlers>;
