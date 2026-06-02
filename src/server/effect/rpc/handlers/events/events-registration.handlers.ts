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
import {
  and,
  asc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  not,
  notExists,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Effect } from 'effect';
import { randomBytes } from 'node:crypto';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database } from '../../../../../db';
import {
  emailNotificationOutbox,
  eventAddons,
  eventRegistrationOptions,
  eventRegistrations,
  registrationTransferIntents,
  rolesToTenantUsers,
  transactions,
  users,
  usersToTenants,
} from '../../../../../db/schema';
import { StripeClient } from '../../../../stripe-client';
import { RpcAccess } from '../shared/rpc-access.service';
import { EventRegistrationService } from './event-registration.service';
import { databaseEffect } from './events.shared';
import {
  buildRegistrationCancelledEmailNotification,
  buildRegistrationTransferredEmailNotification,
  buildWaitlistSpotAvailableEmailNotification,
  notificationEmailForUser,
} from './registration-email-notifications';

export { buildRegistrationTransferredEmailNotification } from './registration-email-notifications';

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

const normalizeTransferTargetSearch = (search: string | undefined) =>
  search?.trim().toLowerCase() ?? '';

const hasSuccessfulPaidRegistrationTransaction = (
  transactionsToCheck: readonly {
    amount: number;
    status: string;
    type: string;
  }[],
) =>
  transactionsToCheck.some(
    (transaction) =>
      transaction.type === 'registration' &&
      transaction.status === 'successful' &&
      transaction.amount > 0,
  );

const REGISTRATION_TRANSFER_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

const createRegistrationTransferCode = (): string =>
  randomBytes(24).toString('base64url');

const hasStripeRefundReference = (transaction: {
  stripeChargeId: null | string;
  stripePaymentIntentId: null | string;
}) => Boolean(transaction.stripeChargeId || transaction.stripePaymentIntentId);

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
          userId: true,
        },
        where: {
          ...(eventId ? { eventId } : {}),
          id: registrationId,
          status: { NOT: 'CANCELLED' },
          tenantId: tenant.id,
          ...(requireOrganizerAccess ? {} : { userId: user.id }),
        },
        with: {
          addonPurchases: {
            columns: {
              addonId: true,
              quantity: true,
            },
          },
          event: {
            columns: {
              start: true,
              title: true,
            },
          },
          transactions: {
            columns: {
              amount: true,
              id: true,
              method: true,
              status: true,
              stripeChargeId: true,
              stripeCheckoutSessionId: true,
              stripePaymentIntentId: true,
              type: true,
            },
          },
          user: {
            columns: {
              communicationEmail: true,
              email: true,
              firstName: true,
              id: true,
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
    const successfulPaidRegistrationTransaction =
      registration.transactions.find(
        (currentTransaction) =>
          currentTransaction.status === 'successful' &&
          currentTransaction.type === 'registration' &&
          currentTransaction.amount > 0,
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

    const cancellationOutcome = yield* Database.use((database) =>
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

            for (const addOnPurchase of registration.addonPurchases ?? []) {
              yield* tx
                .update(eventAddons)
                .set({
                  totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${addOnPurchase.quantity}`,
                })
                .where(eq(eventAddons.id, addOnPurchase.addonId));
            }

            if (registration.user) {
              const notification = buildRegistrationCancelledEmailNotification({
                eventTitle: registration.event.title,
                recipientFirstName: registration.user.firstName,
                registrationId: registration.id,
                tenantName: tenant.name,
              });

              yield* tx.insert(emailNotificationOutbox).values({
                kind: 'registrationCancelled',
                payload: {
                  ...notification.payload,
                  eventId: registration.eventId,
                },
                recipientEmail: notificationEmailForUser(registration.user),
                recipientUserId: registration.user.id,
                subject: notification.subject,
                tenantId: tenant.id,
                textBody: notification.textBody,
              });
            }

            if (registration.status === 'CONFIRMED') {
              const waitlistRegistrations = yield* tx
                .select({
                  id: eventRegistrations.id,
                  recipientCommunicationEmail: users.communicationEmail,
                  recipientEmail: users.email,
                  recipientFirstName: users.firstName,
                  recipientUserId: users.id,
                })
                .from(eventRegistrations)
                .innerJoin(users, eq(users.id, eventRegistrations.userId))
                .where(
                  and(
                    eq(eventRegistrations.eventId, registration.eventId),
                    eq(
                      eventRegistrations.registrationOptionId,
                      registration.registrationOptionId,
                    ),
                    eq(eventRegistrations.status, 'WAITLIST'),
                    eq(eventRegistrations.tenantId, tenant.id),
                  ),
                )
                .orderBy(asc(eventRegistrations.createdAt))
                .limit(1);
              const waitlistRegistration = waitlistRegistrations[0];
              if (waitlistRegistration) {
                const notification =
                  buildWaitlistSpotAvailableEmailNotification({
                    eventTitle: registration.event.title,
                    recipientFirstName: waitlistRegistration.recipientFirstName,
                    registrationId: waitlistRegistration.id,
                    tenantName: tenant.name,
                  });

                yield* tx.insert(emailNotificationOutbox).values({
                  kind: 'waitlistSpotAvailable',
                  payload: {
                    ...notification.payload,
                    eventId: registration.eventId,
                  },
                  recipientEmail: notificationEmailForUser({
                    communicationEmail:
                      waitlistRegistration.recipientCommunicationEmail,
                    email: waitlistRegistration.recipientEmail,
                  }),
                  recipientUserId: waitlistRegistration.recipientUserId,
                  subject: notification.subject,
                  tenantId: tenant.id,
                  textBody: notification.textBody,
                });
              }
            }

            if (
              registration.status === 'CONFIRMED' &&
              successfulPaidRegistrationTransaction &&
              (!stripeAccount ||
                !hasStripeRefundReference(
                  successfulPaidRegistrationTransaction,
                ))
            ) {
              yield* tx.insert(transactions).values({
                amount: -Math.abs(successfulPaidRegistrationTransaction.amount),
                comment: `Pending registration refund record for cancelled registration ${registration.id}. Stripe refund could not be created automatically from the stored transaction reference.`,
                currency: tenant.currency,
                eventId: registration.eventId,
                eventRegistrationId: registration.id,
                executiveUserId: user.id,
                manuallyCreated: true,
                method: successfulPaidRegistrationTransaction.method,
                status: 'pending',
                targetUserId: registration.userId,
                tenantId: tenant.id,
                type: 'refund',
              });
            }

            if (!pendingStripeTransaction) {
              return {
                pendingStripeTransaction: null,
                refundTransaction:
                  registration.status === 'CONFIRMED' &&
                  successfulPaidRegistrationTransaction &&
                  stripeAccount &&
                  hasStripeRefundReference(
                    successfulPaidRegistrationTransaction,
                  )
                    ? successfulPaidRegistrationTransaction
                    : null,
              };
            }

            yield* tx
              .update(transactions)
              .set({
                status: 'cancelled',
              })
              .where(eq(transactions.id, pendingStripeTransaction.id));

            return {
              pendingStripeTransaction: {
                stripeCheckoutSessionId,
                transactionId: pendingStripeTransaction.id,
              },
              refundTransaction:
                registration.status === 'CONFIRMED' &&
                successfulPaidRegistrationTransaction &&
                stripeAccount &&
                hasStripeRefundReference(successfulPaidRegistrationTransaction)
                  ? successfulPaidRegistrationTransaction
                  : null,
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

    if (cancellationOutcome.refundTransaction && stripeAccount) {
      const refundTransaction = cancellationOutcome.refundTransaction;
      const stripeRefundParameters = refundTransaction.stripeChargeId
        ? {
            amount: Math.abs(refundTransaction.amount),
            charge: refundTransaction.stripeChargeId,
          }
        : refundTransaction.stripePaymentIntentId
          ? {
              amount: Math.abs(refundTransaction.amount),
              payment_intent: refundTransaction.stripePaymentIntentId,
            }
          : null;
      if (!stripeRefundParameters) {
        return;
      }

      yield* Effect.tryPromise(() =>
        Promise.race([
          stripe.refunds.create(stripeRefundParameters, {
            stripeAccount,
          }),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error('Stripe refund creation timed out')),
              5000,
            );
          }),
        ]),
      ).pipe(
        Effect.flatMap((stripeRefund) =>
          databaseEffect((database) =>
            database.insert(transactions).values({
              amount: -Math.abs(refundTransaction.amount),
              comment: `Stripe refund ${stripeRefund.id} recorded for cancelled registration ${registration.id} with status ${stripeRefund.status}.`,
              currency: tenant.currency,
              eventId: registration.eventId,
              eventRegistrationId: registration.id,
              executiveUserId: user.id,
              manuallyCreated: false,
              method: refundTransaction.method,
              status:
                stripeRefund.status === 'succeeded' ? 'successful' : 'pending',
              targetUserId: registration.userId,
              tenantId: tenant.id,
              type: 'refund',
            }),
          ),
        ),
        Effect.catch((error) =>
          Effect.logError(
            'Failed to create Stripe refund for cancelled registration',
          ).pipe(
            Effect.annotateLogs({
              error,
              registrationId: registration.id,
              transactionId: refundTransaction.id,
            }),
            Effect.andThen(
              databaseEffect((database) =>
                database.insert(transactions).values({
                  amount: -Math.abs(refundTransaction.amount),
                  comment: `Pending registration refund record for cancelled registration ${registration.id}. Automatic Stripe refund failed and must be followed up manually.`,
                  currency: tenant.currency,
                  eventId: registration.eventId,
                  eventRegistrationId: registration.id,
                  executiveUserId: user.id,
                  manuallyCreated: true,
                  method: refundTransaction.method,
                  status: 'pending',
                  targetUserId: registration.userId,
                  tenantId: tenant.id,
                  type: 'refund',
                }),
              ),
            ),
          ),
        ),
      );
    }

    if (
      !cancellationOutcome.pendingStripeTransaction ||
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
            transactionId:
              cancellationOutcome.pendingStripeTransaction.transactionId,
          }),
        ),
      ),
      Effect.catch(() => Effect.void),
    );
  });

const transferEventRegistration = ({
  eventId,
  registrationId,
  requireOrganizerAccess = true,
  targetUserId,
}: {
  eventId?: string;
  registrationId: string;
  requireOrganizerAccess?: boolean;
  targetUserId: string;
}) =>
  Effect.gen(function* () {
    yield* RpcAccess.ensureAuthenticated();
    const { tenant } = yield* RpcAccess.current();
    const user = yield* RpcAccess.requireUser();
    const now = new Date();

    const registration = yield* databaseEffect((database) =>
      database.query.eventRegistrations.findFirst({
        columns: {
          checkInTime: true,
          eventId: true,
          id: true,
          registrationOptionId: true,
          status: true,
          userId: true,
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
              title: true,
            },
          },
          transactions: {
            columns: {
              amount: true,
              status: true,
              type: true,
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

    if (registration.status !== 'CONFIRMED') {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message: 'Only confirmed registrations can be transferred',
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
          message: 'Checked-in registrations cannot be transferred',
        }),
      );
    }

    if (registration.event.start <= now) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message: 'Registration can no longer be transferred',
        }),
      );
    }

    if (registration.userId === targetUserId) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message: 'Registration is already assigned to this user',
        }),
      );
    }

    if (hasSuccessfulPaidRegistrationTransaction(registration.transactions)) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message:
            'Paid registration transfer is not available until the Stripe Checkout replacement and refund flow is implemented',
        }),
      );
    }

    const targetTenantUser = yield* databaseEffect((database) =>
      database.query.usersToTenants.findFirst({
        columns: {
          id: true,
        },
        where: {
          tenantId: tenant.id,
          userId: targetUserId,
        },
        with: {
          roles: {
            columns: {
              id: true,
            },
          },
        },
      }),
    );

    if (!targetTenantUser) {
      return yield* Effect.fail(
        new EventRegistrationNotFoundError({
          message: 'Target tenant user not found',
        }),
      );
    }

    const targetRoleIds = new Set(
      targetTenantUser.roles.map((role) => role.id),
    );
    const registrationOption = yield* databaseEffect((database) =>
      database.query.eventRegistrationOptions.findFirst({
        columns: {
          roleIds: true,
        },
        where: {
          eventId: registration.eventId,
          id: registration.registrationOptionId,
        },
      }),
    );
    if (!registrationOption) {
      return yield* Effect.fail(
        new EventRegistrationInternalError({
          message: 'Registration option missing',
        }),
      );
    }

    const targetEligible =
      registrationOption.roleIds.length === 0 ||
      registrationOption.roleIds.some((roleId) => targetRoleIds.has(roleId));
    if (!targetEligible) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message: 'Target user is not eligible for this registration option',
        }),
      );
    }

    const existingTargetRegistration = yield* databaseEffect((database) =>
      database.query.eventRegistrations.findFirst({
        columns: {
          id: true,
        },
        where: {
          eventId: registration.eventId,
          status: { NOT: 'CANCELLED' },
          tenantId: tenant.id,
          userId: targetUserId,
        },
      }),
    );

    if (existingTargetRegistration) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message: 'Target user already has an active registration',
        }),
      );
    }

    const targetUser = yield* databaseEffect((database) =>
      database.query.users.findFirst({
        columns: {
          communicationEmail: true,
          email: true,
          firstName: true,
          id: true,
        },
        where: {
          id: targetUserId,
        },
      }),
    );
    if (!targetUser) {
      return yield* Effect.fail(
        new EventRegistrationNotFoundError({
          message: 'Target user not found',
        }),
      );
    }

    const transferredRegistration = yield* databaseEffect((database) =>
      database.transaction((tx) =>
        Effect.gen(function* () {
          const targetRegistrations = alias(
            eventRegistrations,
            'target_registrations',
          );
          const transferredRegistrations = yield* tx
            .update(eventRegistrations)
            .set({
              userId: targetUserId,
            })
            .where(
              and(
                eq(eventRegistrations.id, registration.id),
                eq(eventRegistrations.tenantId, tenant.id),
                eq(eventRegistrations.status, 'CONFIRMED'),
                not(eq(eventRegistrations.userId, targetUserId)),
                notExists(
                  tx
                    .select({ id: targetRegistrations.id })
                    .from(targetRegistrations)
                    .where(
                      and(
                        eq(targetRegistrations.tenantId, tenant.id),
                        eq(targetRegistrations.eventId, registration.eventId),
                        eq(targetRegistrations.userId, targetUserId),
                        not(eq(targetRegistrations.status, 'CANCELLED')),
                      ),
                    ),
                ),
                ...(requireOrganizerAccess
                  ? []
                  : [eq(eventRegistrations.userId, user.id)]),
              ),
            )
            .returning({
              eventId: eventRegistrations.eventId,
              id: eventRegistrations.id,
            });
          const transferred = transferredRegistrations[0];
          if (!transferred) {
            return null;
          }

          const notification = buildRegistrationTransferredEmailNotification({
            eventTitle: registration.event.title,
            recipientFirstName: targetUser.firstName,
            registrationId: transferred.id,
            tenantName: tenant.name,
          });

          yield* tx.insert(emailNotificationOutbox).values({
            kind: 'registrationTransferred',
            payload: {
              ...notification.payload,
              eventId: transferred.eventId,
            },
            recipientEmail: notificationEmailForUser(targetUser),
            recipientUserId: targetUser.id,
            subject: notification.subject,
            tenantId: tenant.id,
            textBody: notification.textBody,
          });

          return transferred;
        }),
      ),
    );

    if (!transferredRegistration) {
      return yield* Effect.fail(
        new EventRegistrationNotFoundError({
          message: 'Registration not found',
        }),
      );
    }
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
  'events.createRegistrationTransferIntent': ({ registrationId }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const now = new Date();

      const registration = yield* databaseEffect((database) =>
        database.query.eventRegistrations.findFirst({
          columns: {
            checkInTime: true,
            id: true,
            status: true,
            userId: true,
          },
          where: {
            id: registrationId,
            tenantId: tenant.id,
            userId: user.id,
          },
          with: {
            event: {
              columns: {
                start: true,
              },
            },
            transactions: {
              columns: {
                amount: true,
                status: true,
                type: true,
              },
              where: {
                type: 'registration',
              },
            },
          },
        }),
      );
      if (!registration || !registration.event) {
        return yield* Effect.fail(
          new EventRegistrationNotFoundError({
            message: 'Registration not found',
          }),
        );
      }
      if (
        registration.status !== 'CONFIRMED' ||
        registration.checkInTime !== null ||
        registration.event.start <= now
      ) {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Registration is not eligible for paid transfer',
          }),
        );
      }
      if (
        !hasSuccessfulPaidRegistrationTransaction(
          registration.transactions ?? [],
        )
      ) {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Only paid registrations can create transfer codes',
          }),
        );
      }

      const activeIntent = yield* databaseEffect((database) =>
        database.query.registrationTransferIntents.findFirst({
          columns: {
            code: true,
            expiresAt: true,
            id: true,
          },
          where: {
            sourceRegistrationId: registration.id,
            status: 'pending',
            tenantId: tenant.id,
          },
        }),
      );
      if (activeIntent && activeIntent.expiresAt > now) {
        return {
          code: activeIntent.code,
          expiresAt: activeIntent.expiresAt.toISOString(),
        };
      }
      if (activeIntent) {
        yield* databaseEffect((database) =>
          database
            .update(registrationTransferIntents)
            .set({ status: 'expired' })
            .where(eq(registrationTransferIntents.id, activeIntent.id)),
        );
      }

      const expiresAt = new Date(
        now.getTime() + REGISTRATION_TRANSFER_INTENT_TTL_MS,
      );
      const transferCode = createRegistrationTransferCode();
      const insertedIntents = yield* databaseEffect((database) =>
        database
          .insert(registrationTransferIntents)
          .values({
            code: transferCode,
            createdByUserId: user.id,
            expiresAt,
            sourceRegistrationId: registration.id,
            status: 'pending',
            tenantId: tenant.id,
          })
          .returning({
            code: registrationTransferIntents.code,
            expiresAt: registrationTransferIntents.expiresAt,
          }),
      );
      const insertedIntent = insertedIntents[0];
      if (!insertedIntent) {
        return yield* Effect.fail(
          new EventRegistrationInternalError({
            message: 'Transfer intent creation failed',
          }),
        );
      }

      return {
        code: insertedIntent.code,
        expiresAt: insertedIntent.expiresAt.toISOString(),
      };
    }),
  'events.findTransferTargets': (
    { eventId, registrationId, search },
    _options,
  ) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const now = new Date();
      const normalizedSearch = normalizeTransferTargetSearch(search);

      const registration = yield* databaseEffect((database) =>
        database.query.eventRegistrations.findFirst({
          columns: {
            checkInTime: true,
            eventId: true,
            id: true,
            registrationOptionId: true,
            status: true,
            userId: true,
          },
          where: {
            eventId,
            id: registrationId,
            status: { NOT: 'CANCELLED' },
            tenantId: tenant.id,
          },
          with: {
            event: {
              columns: {
                start: true,
              },
            },
            transactions: {
              columns: {
                amount: true,
                status: true,
                type: true,
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

      if (registration.status !== 'CONFIRMED') {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Only confirmed registrations can be transferred',
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
            message: 'Checked-in registrations cannot be transferred',
          }),
        );
      }

      if (registration.event.start <= now) {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Registration can no longer be transferred',
          }),
        );
      }

      if (
        registration.transactions.some(
          (transaction) =>
            transaction.type === 'registration' &&
            transaction.status === 'successful' &&
            transaction.amount > 0,
        )
      ) {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message:
              'Paid registration transfer is not available until the Stripe Checkout replacement and refund flow is implemented',
          }),
        );
      }

      const registrationOption = yield* databaseEffect((database) =>
        database.query.eventRegistrationOptions.findFirst({
          columns: {
            roleIds: true,
          },
          where: {
            eventId: registration.eventId,
            id: registration.registrationOptionId,
          },
        }),
      );
      if (!registrationOption) {
        return yield* Effect.fail(
          new EventRegistrationInternalError({
            message: 'Registration option missing',
          }),
        );
      }

      const activeRegistrations = yield* databaseEffect((database) =>
        database.query.eventRegistrations.findMany({
          columns: {
            userId: true,
          },
          where: {
            eventId: registration.eventId,
            status: { NOT: 'CANCELLED' },
            tenantId: tenant.id,
          },
        }),
      );
      const activeUserIds = new Set(
        activeRegistrations.map(
          (activeRegistration) => activeRegistration.userId,
        ),
      );

      const tenantUsers = yield* databaseEffect((database) =>
        database
          .select({
            email: users.email,
            firstName: users.firstName,
            id: usersToTenants.id,
            lastName: users.lastName,
            userId: usersToTenants.userId,
          })
          .from(usersToTenants)
          .innerJoin(users, eq(usersToTenants.userId, users.id))
          .where(
            normalizedSearch
              ? and(
                  eq(usersToTenants.tenantId, tenant.id),
                  ilike(users.searchableInfo, `%${normalizedSearch}%`),
                )
              : eq(usersToTenants.tenantId, tenant.id),
          )
          .limit(100),
      );
      const tenantUserIds = tenantUsers.map((tenantUser) => tenantUser.id);
      const tenantUserRoles =
        tenantUserIds.length > 0
          ? yield* databaseEffect((database) =>
              database
                .select({
                  roleId: rolesToTenantUsers.roleId,
                  userTenantId: rolesToTenantUsers.userTenantId,
                })
                .from(rolesToTenantUsers)
                .where(inArray(rolesToTenantUsers.userTenantId, tenantUserIds)),
            )
          : [];
      const roleIdsByTenantUserId = new Map<string, Set<string>>();
      for (const tenantUserRole of tenantUserRoles) {
        const roleIds =
          roleIdsByTenantUserId.get(tenantUserRole.userTenantId) ?? new Set();
        roleIds.add(tenantUserRole.roleId);
        roleIdsByTenantUserId.set(tenantUserRole.userTenantId, roleIds);
      }

      return tenantUsers
        .filter((tenantUser) => {
          if (tenantUser.userId === registration.userId) {
            return false;
          }
          if (activeUserIds.has(tenantUser.userId)) {
            return false;
          }

          const roleIds = roleIdsByTenantUserId.get(tenantUser.id) ?? new Set();
          const roleEligible =
            registrationOption.roleIds.length === 0 ||
            registrationOption.roleIds.some((roleId) => roleIds.has(roleId));
          if (!roleEligible) {
            return false;
          }
          return true;
        })
        .map((tenantUser) => ({
          email: tenantUser.email,
          firstName: tenantUser.firstName,
          id: tenantUser.userId,
          lastName: tenantUser.lastName,
        }))
        .toSorted((userA, userB) => {
          const lastNameCompare = userA.lastName.localeCompare(userB.lastName);
          return lastNameCompare === 0
            ? userA.firstName.localeCompare(userB.firstName)
            : lastNameCompare;
        })
        .slice(0, 25);
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
            checkInTime: true,
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
            addonPurchases: {
              columns: {
                quantity: true,
                unitPrice: true,
              },
              with: {
                addOn: {
                  columns: {
                    title: true,
                  },
                },
              },
            },
            event: {
              columns: {
                start: true,
              },
            },
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
          addonPurchases: registration.addonPurchases.flatMap((purchase) =>
            purchase.addOn
              ? [
                  {
                    quantity: purchase.quantity,
                    title: purchase.addOn.title,
                    unitPrice: purchase.unitPrice,
                  },
                ]
              : [],
          ),
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
          transferAvailable:
            registration.status === 'CONFIRMED' &&
            registration.checkInTime === null &&
            !!registration.event &&
            registration.event.start > new Date() &&
            !hasSuccessfulPaidRegistrationTransaction(
              registration.transactions,
            ),
        };
      });

      return {
        isRegistered: registrations.length > 0,
        registrations: registrationSummaries,
      };
    }),
  'events.joinWaitlist': (
    { answers, eventId, registrationOptionId },
    _options,
  ) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

      return yield* EventRegistrationService.joinWaitlist({
        answers,
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
    { addOns, answers, eventId, guestCount, registrationOptionId },
    options,
  ) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

      return yield* EventRegistrationService.registerForEvent({
        addOns,
        answers,
        eventId,
        guestCount,
        headers: options.headers,
        registrationOptionId,
        tenant: {
          currency: tenant.currency,
          id: tenant.id,
          name: tenant.name,
          registrationLimitCount: tenant.registrationLimitCount,
          registrationLimitWindowDays: tenant.registrationLimitWindowDays,
          stripeAccountId: tenant.stripeAccountId,
        },
        user: {
          communicationEmail: user.communicationEmail,
          email: user.email,
          firstName: user.firstName,
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
  'events.transferEventRegistration': (
    { eventId, registrationId, targetUserId },
    _options,
  ) =>
    transferEventRegistration({
      eventId,
      registrationId,
      targetUserId,
    }),
  'events.transferMyRegistration': (
    { registrationId, targetEmail },
    _options,
  ) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const normalizedTargetEmail = targetEmail.trim().toLowerCase();

      if (!normalizedTargetEmail) {
        return yield* Effect.fail(
          new EventRegistrationNotFoundError({
            message: 'Target user not found',
          }),
        );
      }

      const targetUsers = yield* databaseEffect((database) =>
        database
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${normalizedTargetEmail}`)
          .limit(1),
      );
      const targetUser = targetUsers[0];

      if (!targetUser) {
        return yield* Effect.fail(
          new EventRegistrationNotFoundError({
            message: 'Target user not found',
          }),
        );
      }

      return yield* transferEventRegistration({
        registrationId,
        requireOrganizerAccess: false,
        targetUserId: targetUser.id,
      }).pipe(
        Effect.catchTag('EventRegistrationNotFoundError', (error) =>
          error.message === 'Target tenant user not found'
            ? Effect.fail(
                new EventRegistrationNotFoundError({
                  message: 'Target user not found',
                }),
              )
            : Effect.fail(error),
        ),
      );
    }),
} satisfies Partial<AppRpcHandlers>;
