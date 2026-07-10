import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  includesPermission,
  type Permission,
} from '@shared/permissions/permissions';
import { registrationSpotCount } from '@shared/registration-spots';
import { activeRegistrationTransferStatuses } from '@shared/registration-transfer';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  and,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  not,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Effect, Option, Result } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database, type DatabaseClient } from '../../../../../db';
import { createId } from '../../../../../db/create-id';
import {
  eventInstances,
  eventRegistrationAddonFulfillmentEvents,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationAddonRefundAllocations,
  eventRegistrationOptions,
  eventRegistrations,
  registrationTransfers,
  rolesToTenantUsers,
  tenants,
  transactions,
  users,
  usersToTenants,
} from '../../../../../db/schema';
import { type Tenant } from '../../../../../types/custom/tenant';
import { getServerNow } from '../../../../clock';
import { formatConfigError } from '../../../../config/config-error';
import { serverClockConfig } from '../../../../config/server-config';
import {
  enqueueRegistrationCancelledEmail,
  enqueueRegistrationTransferredEmail,
  enqueueWaitlistSpotAvailableEmail,
} from '../../../../notifications/email-delivery';
import { type RegistrationCancellationActor } from '../../../../notifications/email-templates';
import { allocateCumulativeQuantityAmount } from '../../../../payments/addon-payment-allocation';
import { ensureAddonPaymentAllocations } from '../../../../payments/addon-payment-allocation.service';
import { ensureRegistrationPaymentFeeSnapshot } from '../../../../payments/registration-payment-fee-snapshot';
import {
  createRegistrationRefundClaim,
  processRegistrationRefundClaim,
} from '../../../../payments/registration-refund';
import {
  cancelRegistrationAddon,
  cancelRemainingRegistrationAddons,
  getRegistrationAddonFulfillment,
  redeemRegistrationAddon,
  undoRegistrationAddonRedemption,
} from '../../../../registrations/addon-fulfillment.service';
import { ensureRegistrationMutationHasNoActiveTransfer } from '../../../../registrations/registration-transfer-mutation-guard';
import { StripeClient } from '../../../../stripe-client';
import { tenantOutboundUrl } from '../../../../tenant-outbound-url';
import { RpcAccess } from '../shared/rpc-access.service';
import { isActiveRegistrationUniqueViolation } from './active-registration-constraint';
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

const registrationHandlerNow = serverClockConfig.pipe(
  Effect.mapError(
    (error) =>
      new EventRegistrationInternalError({
        message: `Invalid server clock configuration:\n${formatConfigError(error)}`,
      }),
  ),
  Effect.flatMap(({ E2E_NOW_ISO }) =>
    Effect.try({
      catch: (cause) =>
        new EventRegistrationInternalError({
          cause,
          message: 'Invalid E2E_NOW_ISO server clock value',
        }),
      try: () => getServerNow(Option.getOrUndefined(E2E_NOW_ISO)).toJSDate(),
    }),
  ),
);

const registrationNotificationEventUrl = (tenant: Tenant, eventId: string) =>
  tenantOutboundUrl(tenant, `/events/${encodeURIComponent(eventId)}`).pipe(
    Effect.mapError(
      (cause) =>
        new EventRegistrationInternalError({
          cause,
          message: 'Tenant event URL is invalid for registration notifications',
        }),
    ),
  );

const registrationNotificationEmail = (user: {
  communicationEmail?: null | string;
  email: string;
}): string => user.communicationEmail?.trim() || user.email;

const CHECK_IN_PRE_START_WINDOW_MS = 60 * 60 * 1000;

const isWithinCheckInWindow = (eventStart: Date, now: Date): boolean =>
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

const hasAppliedRegistrationDiscount = (registration: {
  appliedDiscountedPrice: null | number;
  appliedDiscountType: null | string;
}) =>
  registration.appliedDiscountedPrice !== null ||
  registration.appliedDiscountType !== null;

const hasStripeRefundReference = (transaction: {
  stripeChargeId: null | string;
  stripePaymentIntentId: null | string;
}) => Boolean(transaction.stripeChargeId || transaction.stripePaymentIntentId);

export const resolveCancellationDeadlineHoursBeforeStart = (
  registrationOptionOverride: null | number | undefined,
  tenantDefault: number,
): number => registrationOptionOverride ?? tenantDefault;

export const resolveRefundFeesOnCancellation = (
  registrationOptionOverride: boolean | null | undefined,
  tenantDefault: boolean,
): boolean => registrationOptionOverride ?? tenantDefault;

export const hasReachedRegistrationCancellationDeadline = ({
  deadlineHoursBeforeStart,
  eventStart,
  now,
}: {
  deadlineHoursBeforeStart: number;
  eventStart: Date;
  now: Date;
}): boolean =>
  now.getTime() >=
  eventStart.getTime() - deadlineHoursBeforeStart * 60 * 60 * 1000;

export const registrationCancellationStripeRefundTerms = ({
  grossAmount,
  refundFeesOnCancellation,
  stripeNetAmount,
}: {
  grossAmount: number;
  refundFeesOnCancellation: boolean;
  stripeNetAmount: null | number;
}):
  | undefined
  | { readonly amount: number; readonly applicationFeeRefunded: boolean } => {
  const amount = refundFeesOnCancellation ? grossAmount : stripeNetAmount;
  if (amount === null || !Number.isInteger(amount) || amount <= 0) {
    return;
  }
  return {
    amount,
    applicationFeeRefunded: refundFeesOnCancellation,
  };
};

const activeRegistrationTransferConflict = () =>
  new EventRegistrationConflictError({
    message:
      'This registration has an active transfer. Resolve or cancel the transfer before changing the registration.',
  });

const findActiveRegistrationTransfer = (
  database: DatabaseClient,
  input: { readonly registrationId: string; readonly tenantId: string },
) =>
  database.query.registrationTransfers.findFirst({
    columns: { id: true },
    where: {
      OR: [
        {
          sourceRegistrationId: input.registrationId,
          status: { in: [...activeRegistrationTransferStatuses] },
        },
        {
          recipientRegistrationId: input.registrationId,
          status: 'checkout_pending',
        },
      ],
      tenantId: input.tenantId,
    },
  });

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

const ensureRegistrationAddonFulfillmentAccess = Effect.fn(
  'ensureRegistrationAddonFulfillmentAccess',
)(function* (input: {
  readonly registrationId: string;
  readonly tenantId: string;
  readonly user: {
    readonly id: string;
    readonly permissions: readonly Permission[];
  };
}) {
  const registration = yield* databaseEffect((database) =>
    database.query.eventRegistrations.findFirst({
      columns: { eventId: true },
      where: { id: input.registrationId, tenantId: input.tenantId },
    }),
  );
  if (!registration) {
    return yield* new EventRegistrationNotFoundError({
      message: 'Registration not found',
    });
  }
  yield* ensureCanScanEventRegistration({
    eventId: registration.eventId,
    tenantId: input.tenantId,
    user: input.user,
  });
});

export interface CancelRegistrationForTenantArguments {
  readonly cancelledBy: RegistrationCancellationActor;
  readonly enforceParticipantDeadline: boolean;
  readonly executiveUserId: null | string;
  readonly expectedEventId?: string;
  readonly expectedUserId?: string;
  readonly expiredCheckout?: {
    readonly sessionId: string;
    readonly stripeAccountId: string;
    readonly transactionId: string;
  };
  readonly onCancelled?: (
    tx: Pick<DatabaseClient, 'insert' | 'select' | 'update'>,
    transition: RegistrationCancellationTransition,
  ) => Effect.Effect<void, unknown, never>;
  readonly registrationId: string;
  readonly targetTenant: Tenant;
}

export interface RegistrationCancellationTransition {
  readonly checkInTime: Date | null;
  readonly eventId: string;
  readonly guestCount: number;
  readonly refundTransactionId: null | string;
  readonly refundTransactionStatus: 'pending' | null;
  readonly registrationId: string;
  readonly registrationOptionId: string;
  readonly statusAfter: 'CANCELLED';
  readonly statusBefore: 'CONFIRMED' | 'PENDING' | 'WAITLIST';
  readonly userId: string;
}

export const cancelRegistrationForTenant = Effect.fn(
  'cancelRegistrationForTenant',
)(function* ({
  cancelledBy,
  enforceParticipantDeadline,
  executiveUserId,
  expectedEventId,
  expectedUserId,
  expiredCheckout,
  onCancelled = () => Effect.void,
  registrationId,
  targetTenant: tenant,
}: CancelRegistrationForTenantArguments) {
  const stripe = yield* StripeClient;
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
        ...(expectedEventId && { eventId: expectedEventId }),
        id: registrationId,
        ...(!expiredCheckout && { status: { NOT: 'CANCELLED' as const } }),
        tenantId: tenant.id,
        ...(expectedUserId && { userId: expectedUserId }),
      },
      with: {
        addonPurchases: {
          columns: {
            addonId: true,
            purchasedQuantity: true,
            quantity: true,
          },
        },
        event: {
          columns: {
            start: true,
            title: true,
          },
        },
        registrationOption: {
          columns: {
            cancellationDeadlineHoursBeforeStart: true,
            id: true,
            refundFeesOnCancellation: true,
          },
          with: {
            eventRegistrations: {
              columns: {
                id: true,
                status: true,
              },
              where: {
                status: 'WAITLIST',
                tenantId: tenant.id,
              },
              with: {
                user: {
                  columns: {
                    communicationEmail: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        transactions: {
          columns: {
            amount: true,
            appFee: true,
            id: true,
            method: true,
            status: true,
            stripeAccountId: true,
            stripeChargeId: true,
            stripeCheckoutCancellationRequestedAt: true,
            stripeCheckoutSessionId: true,
            stripeFee: true,
            stripeNetAmount: true,
            stripePaymentIntentId: true,
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

  if (expiredCheckout && registration.status === 'CANCELLED') {
    const checkoutCancellationAlreadyFinalized = registration.transactions.some(
      (transaction) =>
        transaction.id === expiredCheckout.transactionId &&
        transaction.method === 'stripe' &&
        transaction.status === 'cancelled' &&
        transaction.stripeAccountId === expiredCheckout.stripeAccountId &&
        transaction.stripeCheckoutSessionId === expiredCheckout.sessionId &&
        transaction.type === 'registration',
    );
    if (checkoutCancellationAlreadyFinalized) {
      return {
        refundClaimId: null,
        refundTransactionId: null,
        status: 'alreadyCancelled' as const,
      };
    }
    return yield* Effect.fail(
      new EventRegistrationConflictError({
        message: 'Registration cancellation state changed unexpectedly',
      }),
    );
  }

  const activeTransfer = yield* databaseEffect((database) =>
    findActiveRegistrationTransfer(database, {
      registrationId: registration.id,
      tenantId: tenant.id,
    }),
  );
  if (activeTransfer) {
    return yield* Effect.fail(activeRegistrationTransferConflict());
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

  if (!expiredCheckout && registration.event.start <= now) {
    return yield* Effect.fail(
      new EventRegistrationConflictError({
        message: 'Registration can no longer be cancelled',
      }),
    );
  }
  if (
    !expiredCheckout &&
    enforceParticipantDeadline &&
    hasReachedRegistrationCancellationDeadline({
      deadlineHoursBeforeStart: resolveCancellationDeadlineHoursBeforeStart(
        registration.registrationOption?.cancellationDeadlineHoursBeforeStart,
        tenant.cancellationDeadlineHoursBeforeStart,
      ),
      eventStart: registration.event.start,
      now,
    })
  ) {
    return yield* Effect.fail(
      new EventRegistrationConflictError({
        message:
          'The participant cancellation deadline has passed, so this request did not cancel the registration, create a refund, or release its spots.',
      }),
    );
  }
  const cancellationRecipient = registration.user
    ? registrationNotificationEmail(registration.user)
    : null;
  const waitlistRecipients =
    registration.status === 'WAITLIST'
      ? []
      : (registration.registrationOption?.eventRegistrations ?? []).flatMap(
          (waitlistRegistration) =>
            waitlistRegistration.user
              ? [
                  {
                    registrationId: waitlistRegistration.id,
                    to: registrationNotificationEmail(
                      waitlistRegistration.user,
                    ),
                  },
                ]
              : [],
        );
  const notificationEventUrl =
    (cancellationRecipient || waitlistRecipients.length > 0) &&
    registration.event.title
      ? yield* registrationNotificationEventUrl(tenant, registration.eventId)
      : null;
  const preflightSuccessfulPaidStripeTransaction =
    registration.status === 'CONFIRMED'
      ? registration.transactions.find(
          (currentTransaction) =>
            currentTransaction.status === 'successful' &&
            currentTransaction.method === 'stripe' &&
            currentTransaction.type === 'registration' &&
            currentTransaction.amount > 0,
        )
      : undefined;
  if (preflightSuccessfulPaidStripeTransaction) {
    yield* ensureRegistrationPaymentFeeSnapshot(
      preflightSuccessfulPaidStripeTransaction.id,
    ).pipe(
      Effect.mapError(
        () =>
          new EventRegistrationConflictError({
            message:
              'Payment fees are still being reconciled, so this request did not cancel the registration, create a refund, or release its spots. Retry cancellation shortly.',
          }),
      ),
    );
  }
  if (
    registration.status === 'CONFIRMED' &&
    (registration.addonPurchases ?? []).some(
      ({ purchasedQuantity }) => purchasedQuantity > 0,
    )
  ) {
    const addOnSourceRows = yield* databaseEffect((database) =>
      database
        .select({
          sourceTransactionId:
            eventRegistrationAddonPurchaseLots.sourceTransactionId,
        })
        .from(eventRegistrationAddonPurchaseLots)
        .where(
          and(
            eq(
              eventRegistrationAddonPurchaseLots.registrationId,
              registration.id,
            ),
            eq(eventRegistrationAddonPurchaseLots.tenantId, tenant.id),
            isNotNull(eventRegistrationAddonPurchaseLots.sourceTransactionId),
          ),
        ),
    );
    const addOnSourceIds = [
      ...new Set(
        addOnSourceRows.flatMap(({ sourceTransactionId }) =>
          sourceTransactionId ? [sourceTransactionId] : [],
        ),
      ),
    ];
    yield* Effect.forEach(
      addOnSourceIds,
      (sourceTransactionId) =>
        ensureAddonPaymentAllocations(sourceTransactionId).pipe(
          Effect.mapError(
            () =>
              new EventRegistrationConflictError({
                message:
                  'Add-on payment allocations are still being reconciled, so this request did not cancel the registration or release add-on inventory. Retry cancellation shortly.',
              }),
          ),
        ),
      { discard: true },
    );
  }
  const preflightPendingStripeTransaction = registration.transactions.find(
    (currentTransaction) =>
      currentTransaction.status === 'pending' &&
      currentTransaction.method === 'stripe' &&
      currentTransaction.type === 'registration',
  );
  if (
    preflightPendingStripeTransaction &&
    !preflightPendingStripeTransaction.stripeCheckoutSessionId
  ) {
    return yield* Effect.fail(
      new EventRegistrationConflictError({
        message:
          'Payment setup is still being reconciled, so this request did not cancel the registration or release its reserved spots. Retry payment setup, then retry cancellation.',
      }),
    );
  }

  if (
    preflightPendingStripeTransaction?.stripeCheckoutSessionId &&
    !preflightPendingStripeTransaction.stripeAccountId
  ) {
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
          const lockedRegistrations = yield* tx
            .select({
              checkInTime: eventRegistrations.checkInTime,
              eventId: eventRegistrations.eventId,
              guestCount: eventRegistrations.guestCount,
              id: eventRegistrations.id,
              registrationOptionId: eventRegistrations.registrationOptionId,
              status: eventRegistrations.status,
              userId: eventRegistrations.userId,
            })
            .from(eventRegistrations)
            .where(
              and(
                eq(eventRegistrations.id, registration.id),
                eq(eventRegistrations.tenantId, tenant.id),
                ...(expectedEventId
                  ? [eq(eventRegistrations.eventId, expectedEventId)]
                  : []),
                ...(expectedUserId
                  ? [eq(eventRegistrations.userId, expectedUserId)]
                  : []),
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
          if (lockedRegistration.checkInTime) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message: 'Checked-in registrations cannot be cancelled',
              }),
            );
          }

          yield* ensureRegistrationMutationHasNoActiveTransfer(tx, {
            registrationId: lockedRegistration.id,
            tenantId: tenant.id,
          }).pipe(Effect.mapError(() => activeRegistrationTransferConflict()));

          const lockedRegistrationTransactions = yield* tx
            .select({
              amount: transactions.amount,
              appFee: transactions.appFee,
              currency: transactions.currency,
              id: transactions.id,
              method: transactions.method,
              status: transactions.status,
              stripeAccountId: transactions.stripeAccountId,
              stripeChargeId: transactions.stripeChargeId,
              stripeCheckoutCancellationRequestedAt:
                transactions.stripeCheckoutCancellationRequestedAt,
              stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
              stripeFee: transactions.stripeFee,
              stripeNetAmount: transactions.stripeNetAmount,
              stripePaymentIntentId: transactions.stripePaymentIntentId,
              type: transactions.type,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.tenantId, tenant.id),
                eq(transactions.eventRegistrationId, lockedRegistration.id),
                inArray(transactions.type, ['addon', 'registration']),
              ),
            )
            .orderBy(transactions.id)
            .for('update');
          const pendingStripeTransaction = lockedRegistrationTransactions.find(
            (currentTransaction) =>
              currentTransaction.status === 'pending' &&
              currentTransaction.method === 'stripe' &&
              currentTransaction.type === 'registration',
          );
          const successfulPaidRegistrationTransaction =
            lockedRegistrationTransactions.find(
              (currentTransaction) =>
                currentTransaction.type === 'registration' &&
                currentTransaction.status === 'successful' &&
                currentTransaction.amount > 0,
            );
          if (lockedRegistration.status === 'CANCELLED') {
            if (expiredCheckout) {
              const checkoutCancellationAlreadyFinalized =
                lockedRegistrationTransactions.some(
                  (currentTransaction) =>
                    currentTransaction.id === expiredCheckout.transactionId &&
                    currentTransaction.method === 'stripe' &&
                    currentTransaction.status === 'cancelled' &&
                    currentTransaction.stripeAccountId ===
                      expiredCheckout.stripeAccountId &&
                    currentTransaction.stripeCheckoutSessionId ===
                      expiredCheckout.sessionId &&
                    currentTransaction.type === 'registration',
                );
              if (!checkoutCancellationAlreadyFinalized) {
                return yield* Effect.fail(
                  new EventRegistrationConflictError({
                    message:
                      'Registration cancellation state changed unexpectedly',
                  }),
                );
              }
            }
            return {
              refundClaimId: null,
              refundTransactionId: null,
              status: 'alreadyCancelled' as const,
            };
          }
          if (
            lockedRegistration.status !== 'PENDING' &&
            lockedRegistration.status !== 'CONFIRMED' &&
            lockedRegistration.status !== 'WAITLIST'
          ) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message:
                  'Only pending, confirmed, or waitlisted registrations can be cancelled',
              }),
            );
          }
          if (expiredCheckout && !pendingStripeTransaction) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message:
                  'Registration payment state changed while cancellation was being processed',
              }),
            );
          }
          if (pendingStripeTransaction) {
            if (
              !expiredCheckout &&
              (!preflightPendingStripeTransaction ||
                preflightPendingStripeTransaction.id !==
                  pendingStripeTransaction.id ||
                preflightPendingStripeTransaction.stripeAccountId !==
                  pendingStripeTransaction.stripeAccountId ||
                preflightPendingStripeTransaction.stripeCheckoutSessionId !==
                  pendingStripeTransaction.stripeCheckoutSessionId)
            ) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'Payment setup changed while cancellation was starting, so this request did not cancel the registration or release its reserved spots. Refresh, then retry cancellation.',
                }),
              );
            }
            if (!pendingStripeTransaction.stripeAccountId) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message: 'Stripe account not found',
                }),
              );
            }
            if (!pendingStripeTransaction.stripeCheckoutSessionId) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'Payment setup is still being reconciled, so this request did not cancel the registration or release its reserved spots. Retry payment setup, then retry cancellation.',
                }),
              );
            }
            if (expiredCheckout) {
              if (
                pendingStripeTransaction.id !== expiredCheckout.transactionId ||
                pendingStripeTransaction.stripeAccountId !==
                  expiredCheckout.stripeAccountId ||
                pendingStripeTransaction.stripeCheckoutSessionId !==
                  expiredCheckout.sessionId ||
                !pendingStripeTransaction.stripeCheckoutCancellationRequestedAt
              ) {
                return yield* Effect.fail(
                  new EventRegistrationConflictError({
                    message:
                      'The pending Checkout changed while cancellation was starting, so this request did not cancel the registration or release its reserved spots. Refresh, then retry cancellation.',
                  }),
                );
              }
            } else {
              if (
                !pendingStripeTransaction.stripeCheckoutCancellationRequestedAt
              ) {
                const markedTransactions = yield* tx
                  .update(transactions)
                  .set({
                    stripeCheckoutCancellationRequestedAt: now,
                  })
                  .where(
                    and(
                      eq(transactions.id, pendingStripeTransaction.id),
                      eq(transactions.tenantId, tenant.id),
                      eq(
                        transactions.eventRegistrationId,
                        lockedRegistration.id,
                      ),
                      eq(transactions.method, 'stripe'),
                      eq(transactions.status, 'pending'),
                      isNull(
                        transactions.stripeCheckoutCancellationRequestedAt,
                      ),
                      eq(
                        transactions.stripeCheckoutSessionId,
                        pendingStripeTransaction.stripeCheckoutSessionId,
                      ),
                      eq(transactions.type, 'registration'),
                    ),
                  )
                  .returning({ id: transactions.id });
                if (markedTransactions.length !== 1) {
                  return yield* Effect.fail(
                    new EventRegistrationConflictError({
                      message: 'Registration payment state changed',
                    }),
                  );
                }
              }
              return {
                refundClaimId: null,
                refundTransactionId: null,
                sessionId: pendingStripeTransaction.stripeCheckoutSessionId,
                status: 'expireCheckout' as const,
                stripeAccountId: pendingStripeTransaction.stripeAccountId,
                transactionId: pendingStripeTransaction.id,
              };
            }
          }

          const lockedTenants = yield* tx
            .select({
              cancellationDeadlineHoursBeforeStart:
                tenants.cancellationDeadlineHoursBeforeStart,
              refundFeesOnCancellation: tenants.refundFeesOnCancellation,
              stripeAccountId: tenants.stripeAccountId,
            })
            .from(tenants)
            .where(eq(tenants.id, tenant.id))
            .for('update');
          const lockedTenant = lockedTenants[0];
          if (!lockedTenant) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message: 'Registration tenant missing',
              }),
            );
          }

          const lockedRegistrationOptions = yield* tx
            .select({
              cancellationDeadlineHoursBeforeStart:
                eventRegistrationOptions.cancellationDeadlineHoursBeforeStart,
              refundFeesOnCancellation:
                eventRegistrationOptions.refundFeesOnCancellation,
            })
            .from(eventRegistrationOptions)
            .where(
              and(
                eq(
                  eventRegistrationOptions.id,
                  lockedRegistration.registrationOptionId,
                ),
                eq(
                  eventRegistrationOptions.eventId,
                  lockedRegistration.eventId,
                ),
              ),
            )
            .for('update');
          const lockedRegistrationOption = lockedRegistrationOptions[0];
          if (!lockedRegistrationOption) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message: 'Registration option missing',
              }),
            );
          }

          if (
            !expiredCheckout &&
            enforceParticipantDeadline &&
            hasReachedRegistrationCancellationDeadline({
              deadlineHoursBeforeStart:
                resolveCancellationDeadlineHoursBeforeStart(
                  lockedRegistrationOption.cancellationDeadlineHoursBeforeStart,
                  lockedTenant.cancellationDeadlineHoursBeforeStart,
                ),
              eventStart: registration.event.start,
              now,
            })
          ) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message:
                  'The participant cancellation deadline has passed, so this request did not cancel the registration, create a refund, or release its spots.',
              }),
            );
          }

          const refundFeesOnCancellation = resolveRefundFeesOnCancellation(
            lockedRegistrationOption.refundFeesOnCancellation,
            lockedTenant.refundFeesOnCancellation,
          );
          const stripeRefundTerms =
            successfulPaidRegistrationTransaction?.method === 'stripe'
              ? registrationCancellationStripeRefundTerms({
                  grossAmount: successfulPaidRegistrationTransaction.amount,
                  refundFeesOnCancellation,
                  stripeNetAmount:
                    successfulPaidRegistrationTransaction.stripeNetAmount,
                })
              : undefined;
          if (
            successfulPaidRegistrationTransaction?.method === 'stripe' &&
            (successfulPaidRegistrationTransaction.stripeAccountId !==
              lockedTenant.stripeAccountId ||
              successfulPaidRegistrationTransaction.appFee === null ||
              successfulPaidRegistrationTransaction.stripeFee === null ||
              successfulPaidRegistrationTransaction.stripeNetAmount === null ||
              !successfulPaidRegistrationTransaction.stripeChargeId ||
              !stripeRefundTerms)
          ) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message:
                  'Payment fees or Stripe account ownership changed during cancellation, so this request did not cancel the registration, create a refund, or release its spots. Reconcile the payment and retry cancellation.',
              }),
            );
          }

          const addonCancellationAllocations =
            yield* cancelRemainingRegistrationAddons(tx, {
              actor: executiveUserId
                ? { kind: 'user', userId: executiveUserId }
                : {
                    kind: 'platform',
                    subject: 'platform-registration-cancellation',
                  },
              eventId: lockedRegistration.eventId,
              reason: `Registration cancelled by ${cancelledBy}`,
              refundRequested: Boolean(
                lockedRegistration.status === 'CONFIRMED' &&
                successfulPaidRegistrationTransaction,
              ),
              registrationId: lockedRegistration.id,
              tenantId: tenant.id,
            });

          const cancelledRegistrations = yield* tx
            .update(eventRegistrations)
            .set({
              status: 'CANCELLED',
            })
            .where(
              and(
                eq(eventRegistrations.id, lockedRegistration.id),
                eq(eventRegistrations.tenantId, tenant.id),
                eq(eventRegistrations.status, lockedRegistration.status),
                eq(eventRegistrations.userId, registration.userId),
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

          const registeredSpotCount = registrationSpotCount(
            lockedRegistration.guestCount,
          );
          const releasesReservedResources =
            lockedRegistration.status !== 'PENDING' ||
            !!pendingStripeTransaction;

          if (releasesReservedResources) {
            const updatedOptions = yield* tx
              .update(eventRegistrationOptions)
              .set(
                lockedRegistration.status === 'PENDING'
                  ? {
                      reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${registeredSpotCount}`,
                    }
                  : lockedRegistration.status === 'CONFIRMED'
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
                    lockedRegistration.registrationOptionId,
                  ),
                  lockedRegistration.status === 'PENDING'
                    ? gte(
                        eventRegistrationOptions.reservedSpots,
                        registeredSpotCount,
                      )
                    : lockedRegistration.status === 'CONFIRMED'
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
          }

          let refundTransactionId: null | string = null;
          let stripeRefundClaimId: null | string = null;
          if (
            lockedRegistration.status === 'CONFIRMED' &&
            successfulPaidRegistrationTransaction
          ) {
            if (successfulPaidRegistrationTransaction.method === 'stripe') {
              if (
                !successfulPaidRegistrationTransaction.stripeAccountId ||
                !hasStripeRefundReference(
                  successfulPaidRegistrationTransaction,
                ) ||
                !stripeRefundTerms
              ) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message:
                      'The paid registration is missing its persisted Stripe refund ownership, so this request did not cancel the registration or release its spot. Reconcile the payment and retry cancellation.',
                  }),
                );
              }

              const lockedAddonLots = yield* tx
                .select()
                .from(eventRegistrationAddonPurchaseLots)
                .where(
                  and(
                    eq(
                      eventRegistrationAddonPurchaseLots.registrationId,
                      lockedRegistration.id,
                    ),
                    eq(eventRegistrationAddonPurchaseLots.tenantId, tenant.id),
                  ),
                )
                .orderBy(eventRegistrationAddonPurchaseLots.id)
                .for('update');
              const stripeSources = lockedRegistrationTransactions.filter(
                (transaction) =>
                  transaction.method === 'stripe' &&
                  transaction.status === 'successful' &&
                  transaction.amount > 0 &&
                  (transaction.type === 'registration' ||
                    transaction.type === 'addon'),
              );
              const cancellationEventIds = new Set(
                addonCancellationAllocations.map(
                  ({ fulfillmentEventId }) => fulfillmentEventId,
                ),
              );
              const monetaryCancellationEventIds = new Set<string>();
              for (const source of stripeSources) {
                if (
                  !source.stripeAccountId ||
                  source.stripeNetAmount === null
                ) {
                  return yield* Effect.fail(
                    new EventRegistrationInternalError({
                      message:
                        'A paid add-on source is missing its Stripe fee allocation, so cancellation did not continue.',
                    }),
                  );
                }
                const sourceLots = lockedAddonLots.filter(
                  (lot) => lot.sourceTransactionId === source.id,
                );
                const sourcePolicyAmount = refundFeesOnCancellation
                  ? source.amount
                  : source.stripeNetAmount;
                const fullAddonPolicyAmount = sourceLots.reduce(
                  (sum, lot) =>
                    sum +
                    (refundFeesOnCancellation
                      ? (lot.grossAmount ?? 0)
                      : (lot.netAmount ?? 0)),
                  0,
                );
                const registrationRefundAmount =
                  source.type === 'registration'
                    ? sourcePolicyAmount - fullAddonPolicyAmount
                    : 0;
                if (registrationRefundAmount < 0) {
                  return yield* Effect.fail(
                    new EventRegistrationInternalError({
                      message:
                        'Add-on refund allocations exceed their source payment.',
                    }),
                  );
                }
                const sourceCancellationAllocations =
                  addonCancellationAllocations.filter(
                    (allocation) =>
                      allocation.lot.sourceTransactionId === source.id,
                  );
                const lotRefunds = sourceCancellationAllocations.map(
                  (allocation) => {
                    const grossAmount = allocateCumulativeQuantityAmount({
                      alreadyAllocatedQuantity:
                        allocation.lot.refundAllocatedQuantity,
                      amount: allocation.lot.grossAmount ?? 0,
                      quantity: allocation.quantity,
                      totalQuantity: allocation.lot.quantity,
                    });
                    const netAmount = allocateCumulativeQuantityAmount({
                      alreadyAllocatedQuantity:
                        allocation.lot.refundAllocatedQuantity,
                      amount: allocation.lot.netAmount ?? 0,
                      quantity: allocation.quantity,
                      totalQuantity: allocation.lot.quantity,
                    });
                    const applicationFeeAmount =
                      allocateCumulativeQuantityAmount({
                        alreadyAllocatedQuantity:
                          allocation.lot.refundAllocatedQuantity,
                        amount: allocation.lot.applicationFeeAmount ?? 0,
                        quantity: allocation.quantity,
                        totalQuantity: allocation.lot.quantity,
                      });
                    return {
                      ...allocation,
                      applicationFeeAmount,
                      grossAmount,
                      netAmount,
                      refundAmount: refundFeesOnCancellation
                        ? grossAmount
                        : netAmount,
                    };
                  },
                );
                const amount =
                  registrationRefundAmount +
                  lotRefunds.reduce(
                    (sum, allocation) => sum + allocation.refundAmount,
                    0,
                  );
                const refundClaim =
                  amount > 0
                    ? yield* createRegistrationRefundClaim(tx, {
                        amount,
                        applicationFeeRefunded: refundFeesOnCancellation,
                        currency: source.currency,
                        eventId: lockedRegistration.eventId,
                        eventRegistrationId: lockedRegistration.id,
                        executiveUserId,
                        operationKey: `registration-cancellation:${lockedRegistration.id}:${source.id}`,
                        sourceTransactionId: source.id,
                        stripeAccountId: source.stripeAccountId,
                        targetUserId: lockedRegistration.userId,
                        tenantId: tenant.id,
                      })
                    : undefined;
                if (refundClaim) {
                  refundTransactionId ??= refundClaim.id;
                  stripeRefundClaimId ??= refundClaim.id;
                }
                for (const allocation of lotRefunds) {
                  yield* tx
                    .update(eventRegistrationAddonPurchaseLots)
                    .set({
                      refundAllocatedApplicationFeeAmount: sql`${eventRegistrationAddonPurchaseLots.refundAllocatedApplicationFeeAmount} + ${allocation.applicationFeeAmount}`,
                      refundAllocatedGrossAmount: sql`${eventRegistrationAddonPurchaseLots.refundAllocatedGrossAmount} + ${allocation.grossAmount}`,
                      refundAllocatedNetAmount: sql`${eventRegistrationAddonPurchaseLots.refundAllocatedNetAmount} + ${allocation.netAmount}`,
                      refundAllocatedQuantity: sql`${eventRegistrationAddonPurchaseLots.refundAllocatedQuantity} + ${allocation.quantity}`,
                    })
                    .where(
                      eq(
                        eventRegistrationAddonPurchaseLots.id,
                        allocation.lot.id,
                      ),
                    );
                  yield* tx
                    .update(eventRegistrationAddonPurchases)
                    .set({
                      refundAllocatedPurchasedQuantity: sql`${eventRegistrationAddonPurchases.refundAllocatedPurchasedQuantity} + ${allocation.quantity}`,
                    })
                    .where(
                      eq(
                        eventRegistrationAddonPurchases.id,
                        allocation.purchaseId,
                      ),
                    );
                  if (allocation.refundAmount > 0 && refundClaim) {
                    monetaryCancellationEventIds.add(
                      allocation.fulfillmentEventId,
                    );
                    yield* tx
                      .insert(eventRegistrationAddonRefundAllocations)
                      .values({
                        applicationFeeAmount: allocation.applicationFeeAmount,
                        applicationFeeRefunded: refundFeesOnCancellation,
                        currency: source.currency,
                        eventId: lockedRegistration.eventId,
                        fulfillmentEventId: allocation.fulfillmentEventId,
                        grossEntitlementAmount: allocation.grossAmount,
                        netEntitlementAmount: allocation.netAmount,
                        purchaseId: allocation.purchaseId,
                        purchaseLotId: allocation.lot.id,
                        quantity: allocation.quantity,
                        refundAmount: allocation.refundAmount,
                        refundTransactionId: refundClaim.id,
                        registrationId: lockedRegistration.id,
                        tenantId: tenant.id,
                      });
                  }
                }
              }
              // eslint-disable-next-line unicorn/prefer-set-methods -- the project TypeScript lib intentionally remains below ES2025
              const noMonetaryRefundEventIds = [...cancellationEventIds].filter(
                (eventId) => !monetaryCancellationEventIds.has(eventId),
              );
              if (noMonetaryRefundEventIds.length > 0) {
                yield* tx
                  .update(eventRegistrationAddonFulfillmentEvents)
                  .set({
                    refundDisposition: 'no_monetary_refund_required',
                  })
                  .where(
                    inArray(
                      eventRegistrationAddonFulfillmentEvents.id,
                      noMonetaryRefundEventIds,
                    ),
                  );
              }
            } else {
              const manualRefundTransactionId = createId();
              yield* tx.insert(transactions).values({
                amount: -Math.abs(successfulPaidRegistrationTransaction.amount),
                comment: `Pending manual refund record for cancelled registration ${lockedRegistration.id}.`,
                currency: successfulPaidRegistrationTransaction.currency,
                eventId: lockedRegistration.eventId,
                eventRegistrationId: lockedRegistration.id,
                executiveUserId,
                id: manualRefundTransactionId,
                manuallyCreated: true,
                method: successfulPaidRegistrationTransaction.method,
                refundOperationKey: `registration-cancellation:${lockedRegistration.id}`,
                sourceTransactionId: successfulPaidRegistrationTransaction.id,
                status: 'pending',
                targetUserId: lockedRegistration.userId,
                tenantId: tenant.id,
                type: 'refund',
              });
              refundTransactionId = manualRefundTransactionId;
            }
          }

          if (
            cancellationRecipient &&
            notificationEventUrl &&
            registration.event.title
          ) {
            yield* enqueueRegistrationCancelledEmail(tx, {
              cancelledBy,
              eventTitle: registration.event.title,
              eventUrl: notificationEventUrl,
              registrationId: lockedRegistration.id,
              tenant,
              to: cancellationRecipient,
            });
          }
          if (
            releasesReservedResources &&
            lockedRegistration.status !== 'WAITLIST' &&
            notificationEventUrl &&
            registration.event.title
          ) {
            for (const waitlistRecipient of waitlistRecipients) {
              yield* enqueueWaitlistSpotAvailableEmail(tx, {
                availabilityKey: `cancellation-${lockedRegistration.id}`,
                eventTitle: registration.event.title,
                eventUrl: notificationEventUrl,
                tenant,
                to: waitlistRecipient.to,
                waitlistRegistrationId: waitlistRecipient.registrationId,
              });
            }
          }

          if (pendingStripeTransaction) {
            if (!expiredCheckout) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'Pending payment cancellation was not confirmed by Stripe',
                }),
              );
            }
            const pendingStripeCheckoutSessionId =
              pendingStripeTransaction.stripeCheckoutSessionId;
            if (!pendingStripeCheckoutSessionId) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'Pending payment claim lost its confirmed Checkout binding',
                }),
              );
            }

            const cancelledTransactions = yield* tx
              .update(transactions)
              .set({
                status: 'cancelled',
              })
              .where(
                and(
                  eq(transactions.id, pendingStripeTransaction.id),
                  eq(transactions.eventRegistrationId, lockedRegistration.id),
                  eq(transactions.method, 'stripe'),
                  eq(
                    transactions.stripeAccountId,
                    expiredCheckout.stripeAccountId,
                  ),
                  isNotNull(transactions.stripeCheckoutCancellationRequestedAt),
                  eq(
                    transactions.stripeCheckoutSessionId,
                    expiredCheckout.sessionId,
                  ),
                  eq(transactions.tenantId, tenant.id),
                  eq(transactions.status, 'pending'),
                  eq(transactions.type, 'registration'),
                ),
              )
              .returning({ id: transactions.id });
            if (cancelledTransactions.length !== 1) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message: 'Failed to cancel pending payment claim',
                }),
              );
            }
          }

          yield* onCancelled(tx, {
            checkInTime: lockedRegistration.checkInTime,
            eventId: lockedRegistration.eventId,
            guestCount: lockedRegistration.guestCount,
            refundTransactionId,
            refundTransactionStatus: refundTransactionId ? 'pending' : null,
            registrationId: lockedRegistration.id,
            registrationOptionId: lockedRegistration.registrationOptionId,
            statusAfter: 'CANCELLED',
            statusBefore: lockedRegistration.status,
            userId: lockedRegistration.userId,
          });
          return {
            refundClaimId: stripeRefundClaimId,
            refundTransactionId,
            status: 'cancelled' as const,
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

  if (cancellationOutcome.status === 'expireCheckout') {
    const {
      sessionId: stripeCheckoutSessionId,
      stripeAccountId,
      transactionId,
    } = cancellationOutcome;
    // The durable cancellation marker is committed before Stripe is called,
    // so no database connection or row lock is held while Stripe responds.
    const expirationResult = yield* Effect.result(
      Effect.tryPromise({
        catch: (cause) =>
          new EventRegistrationInternalError({
            cause,
            message:
              'Checkout cancellation could not be confirmed, so this request did not cancel the registration or release its reserved spots. Refresh before retrying.',
          }),
        try: () =>
          Promise.race([
            stripe.checkout.sessions.expire(
              stripeCheckoutSessionId,
              undefined,
              {
                idempotencyKey: `cancel-registration-checkout-${transactionId}`,
                stripeAccount: stripeAccountId,
              },
            ),
            new Promise<never>((_, reject) => {
              setTimeout(
                () => reject(new Error('Stripe checkout expiry timed out')),
                5000,
              );
            }),
          ]),
      }),
    );
    const confirmedExpired = Result.isFailure(expirationResult)
      ? yield* Effect.tryPromise({
          catch: (cause) =>
            new EventRegistrationInternalError({
              cause: {
                expiryFailure: expirationResult.failure,
                retrievalFailure: cause,
              },
              message:
                'Checkout cancellation could not be confirmed, so this request did not cancel the registration or release its reserved spots. Refresh before retrying.',
            }),
          try: () =>
            Promise.race([
              stripe.checkout.sessions.retrieve(
                stripeCheckoutSessionId,
                undefined,
                { stripeAccount: stripeAccountId },
              ),
              new Promise<never>((_, reject) => {
                setTimeout(
                  () =>
                    reject(new Error('Stripe checkout retrieval timed out')),
                  5000,
                );
              }),
            ]),
        }).pipe(
          Effect.map(
            (session) =>
              session.id === stripeCheckoutSessionId &&
              session.status === 'expired',
          ),
        )
      : expirationResult.success.id === stripeCheckoutSessionId &&
        expirationResult.success.status === 'expired';
    if (!confirmedExpired) {
      return yield* Effect.fail(
        new EventRegistrationInternalError({
          message:
            'Stripe did not confirm Checkout cancellation, so this request did not cancel the registration or release its reserved spots. Refresh before retrying.',
        }),
      );
    }
    return yield* cancelRegistrationForTenant({
      cancelledBy,
      enforceParticipantDeadline,
      executiveUserId,
      ...(expectedEventId && { expectedEventId }),
      ...(expectedUserId && { expectedUserId }),
      expiredCheckout: {
        sessionId: stripeCheckoutSessionId,
        stripeAccountId,
        transactionId,
      },
      onCancelled,
      registrationId,
      targetTenant: tenant,
    });
  }

  if (cancellationOutcome.refundClaimId) {
    yield* processRegistrationRefundClaim(
      cancellationOutcome.refundClaimId,
    ).pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        Effect.logError(
          'Registration was cancelled with a durable refund claim; immediate Stripe processing failed and the retry worker will continue',
        ).pipe(
          Effect.annotateLogs({
            error,
            refundClaimId: cancellationOutcome.refundClaimId,
            registrationId: registration.id,
          }),
        ),
      ),
    );
  }
  return cancellationOutcome;
});

const cancelRegistration = Effect.fn('cancelRegistration')(function* ({
  eventId,
  registrationId,
  requireOrganizerAccess = false,
}: {
  eventId?: string;
  registrationId: string;
  requireOrganizerAccess?: boolean;
}) {
  yield* RpcAccess.ensureAuthenticated();
  const { tenant } = yield* RpcAccess.current();
  const user = yield* RpcAccess.requireUser();
  if (requireOrganizerAccess) {
    if (!eventId) {
      return yield* Effect.fail(
        new EventRegistrationNotFoundError({
          message: 'Registration event not found',
        }),
      );
    }
    yield* ensureCanScanEventRegistration({
      eventId,
      tenantId: tenant.id,
      user,
    });
    if (!includesPermission('events:cancelRegistrations', user.permissions)) {
      return yield* Effect.fail(
        new RpcForbiddenError({
          message: 'Missing required registration cancellation access',
          permission: 'events:cancelRegistrations',
        }),
      );
    }
  }

  yield* cancelRegistrationForTenant({
    cancelledBy: requireOrganizerAccess ? 'organizer' : 'participant',
    enforceParticipantDeadline: !requireOrganizerAccess,
    executiveUserId: user.id,
    ...(eventId && { expectedEventId: eventId }),
    ...(!requireOrganizerAccess && { expectedUserId: user.id }),
    registrationId,
    targetTenant: tenant,
  });
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
          appliedDiscountedPrice: true,
          appliedDiscountType: true,
          checkInTime: true,
          eventId: true,
          id: true,
          registrationOptionId: true,
          status: true,
          userId: true,
        },
        where: {
          ...(eventId && { eventId }),
          id: registrationId,
          status: { NOT: 'CANCELLED' },
          tenantId: tenant.id,
          ...(!requireOrganizerAccess && { userId: user.id }),
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

    if (requireOrganizerAccess) {
      yield* ensureCanScanEventRegistration({
        eventId: registration.eventId,
        tenantId: tenant.id,
        user,
      });
    }

    const activeTransfer = yield* databaseEffect((database) =>
      findActiveRegistrationTransfer(database, {
        registrationId: registration.id,
        tenantId: tenant.id,
      }),
    );
    if (activeTransfer) {
      return yield* Effect.fail(activeRegistrationTransferConflict());
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
            'Paid registration transfer is not available until the refund/resale flow is implemented',
        }),
      );
    }

    if (hasAppliedRegistrationDiscount(registration)) {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message:
            'Discounted registration transfer is not available until transfer discount validation is implemented',
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

    const targetUser = yield* databaseEffect((database) =>
      database.query.users.findFirst({
        columns: {
          communicationEmail: true,
          email: true,
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

    const previousOwnerEmail = registration.user
      ? registrationNotificationEmail(registration.user)
      : null;
    const newOwnerEmail = registrationNotificationEmail(targetUser);
    const transferEventUrl =
      registration.event.title && (previousOwnerEmail || newOwnerEmail)
        ? yield* registrationNotificationEventUrl(tenant, registration.eventId)
        : null;

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

    const transferResult = yield* Database.use((database) =>
      database
        .transaction((tx) =>
          Effect.gen(function* () {
            const membershipUserIds = [
              registration.userId,
              targetUserId,
            ].toSorted();
            const lockedMemberships = yield* tx
              .select({
                id: usersToTenants.id,
                userId: usersToTenants.userId,
              })
              .from(usersToTenants)
              .where(
                and(
                  eq(usersToTenants.tenantId, tenant.id),
                  inArray(usersToTenants.userId, membershipUserIds),
                ),
              )
              .orderBy(usersToTenants.userId)
              .for('update');
            if (
              lockedMemberships.every(
                (membership) => membership.userId !== targetUserId,
              )
            ) {
              return { _tag: 'TargetMembershipMissing' } as const;
            }

            const lockedRegistrations = yield* tx
              .select({
                checkInTime: eventRegistrations.checkInTime,
                status: eventRegistrations.status,
                userId: eventRegistrations.userId,
              })
              .from(eventRegistrations)
              .where(
                and(
                  eq(eventRegistrations.id, registration.id),
                  eq(eventRegistrations.tenantId, tenant.id),
                ),
              )
              .for('update');
            const lockedRegistration = lockedRegistrations[0];
            if (
              !lockedRegistration ||
              lockedRegistration.status !== 'CONFIRMED' ||
              lockedRegistration.checkInTime ||
              (!requireOrganizerAccess && lockedRegistration.userId !== user.id)
            ) {
              return { _tag: 'RegistrationUnavailable' } as const;
            }
            yield* ensureRegistrationMutationHasNoActiveTransfer(tx, {
              registrationId: registration.id,
              tenantId: tenant.id,
            }).pipe(
              Effect.mapError(() => activeRegistrationTransferConflict()),
            );

            const activeTargetRegistrations =
              yield* tx.query.eventRegistrations.findMany({
                columns: { id: true },
                where: {
                  eventId: registration.eventId,
                  status: { NOT: 'CANCELLED' },
                  tenantId: tenant.id,
                  userId: targetUserId,
                },
              });
            if (activeTargetRegistrations.length > 0) {
              return { _tag: 'AlreadyRegistered' } as const;
            }

            const activeRegistrationLimit = Math.max(
              0,
              Math.trunc(tenant.maxActiveRegistrationsPerUser ?? 0),
            );
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
                    eq(eventRegistrations.userId, targetUserId),
                    not(eq(eventRegistrations.id, registration.id)),
                    not(eq(eventRegistrations.status, 'CANCELLED')),
                    sql`${eventInstances.start} > ${now}`,
                  ),
                )
                .limit(activeRegistrationLimit);
              if (activeFutureRegistrations.length >= activeRegistrationLimit) {
                return { _tag: 'TenantLimitReached' as const };
              }
            }

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
                id: eventRegistrations.id,
              });
            if (transferredRegistrations.length !== 1) {
              return { _tag: 'RegistrationUnavailable' } as const;
            }
            if (registration.event.title && transferEventUrl) {
              if (previousOwnerEmail) {
                yield* enqueueRegistrationTransferredEmail(tx, {
                  eventTitle: registration.event.title,
                  eventUrl: transferEventUrl,
                  recipientRole: 'previousOwner',
                  recipientUserId: registration.userId,
                  registrationId: registration.id,
                  tenant,
                  to: previousOwnerEmail,
                });
              }
              if (newOwnerEmail) {
                yield* enqueueRegistrationTransferredEmail(tx, {
                  eventTitle: registration.event.title,
                  eventUrl: transferEventUrl,
                  recipientRole: 'newOwner',
                  recipientUserId: targetUser.id,
                  registrationId: registration.id,
                  tenant,
                  to: newOwnerEmail,
                });
              }
            }
            return { _tag: 'Transferred' } as const;
          }),
        )
        .pipe(
          Effect.catch(
            (
              error,
            ): Effect.Effect<
              never,
              | EventRegistrationConflictError
              | EventRegistrationInternalError
              | EventRegistrationNotFoundError
            > => {
              if (isActiveRegistrationUniqueViolation(error)) {
                return Effect.fail(
                  new EventRegistrationConflictError({
                    message: 'Target user already has an active registration',
                  }),
                );
              }
              if (
                error instanceof EventRegistrationConflictError ||
                error instanceof EventRegistrationInternalError ||
                error instanceof EventRegistrationNotFoundError
              ) {
                return Effect.fail(error);
              }
              return Effect.die(error);
            },
          ),
        ),
    );

    if (transferResult._tag === 'TargetMembershipMissing') {
      return yield* Effect.fail(
        new EventRegistrationNotFoundError({
          message: 'Target tenant user not found',
        }),
      );
    }
    if (transferResult._tag === 'AlreadyRegistered') {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message: 'Target user already has an active registration',
        }),
      );
    }
    if (transferResult._tag === 'TenantLimitReached') {
      return yield* Effect.fail(
        new EventRegistrationConflictError({
          message: 'Active registration limit reached',
        }),
      );
    }
    if (transferResult._tag === 'RegistrationUnavailable') {
      return yield* Effect.fail(
        new EventRegistrationNotFoundError({
          message: 'Registration not found',
        }),
      );
    }
  });

export const eventRegistrationHandlers = {
  'events.approveRegistration': ({ eventId, registrationId }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

      yield* ensureCanScanEventRegistration({
        eventId,
        tenantId: tenant.id,
        user,
      });

      return yield* EventRegistrationService.approveManualRegistration({
        eventId,
        registrationId,
        targetTenant: {
          canonicalRootUrl: tenant.canonicalRootUrl,
          currency: tenant.currency,
          domain: tenant.domain,
          emailSenderEmail: tenant.emailSenderEmail,
          emailSenderName: tenant.emailSenderName,
          id: tenant.id,
          name: tenant.name,
          stripeAccountId: tenant.stripeAccountId,
        },
      });
    }).pipe(Effect.catch(mapRegistrationScanInternalError)),
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
  'events.cancelRegistrationAddon': (
    {
      operationKey,
      quantity,
      reason,
      refundRequested,
      registrationAddonId,
      registrationId,
    },
    _options,
  ) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      yield* ensureRegistrationAddonFulfillmentAccess({
        registrationId,
        tenantId: tenant.id,
        user,
      });
      if (!includesPermission('events:cancelRegistrations', user.permissions)) {
        return yield* new RpcForbiddenError({
          message: 'Missing required add-on cancellation access',
          permission: 'events:cancelRegistrations',
        });
      }
      return yield* cancelRegistrationAddon({
        actorUserId: user.id,
        operationKey,
        quantity,
        reason,
        refundRequested,
        registrationAddonId,
        registrationId,
        tenantId: tenant.id,
      });
    }).pipe(Effect.catch(mapRegistrationScanInternalError)),
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

      const activeTransfer = yield* databaseEffect((database) =>
        findActiveRegistrationTransfer(database, {
          registrationId: registration.id,
          tenantId: tenant.id,
        }),
      );
      if (activeTransfer) {
        return yield* Effect.fail(activeRegistrationTransferConflict());
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
      const now = yield* registrationHandlerNow;
      if (
        !registration.event ||
        !isWithinCheckInWindow(registration.event.start, now)
      ) {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Check-in is not open for this event yet',
          }),
        );
      }

      const checkInTime = now;
      const checkedInSpotCount =
        (registration.checkInTime ? 0 : 1) + guestCheckInCount;
      const checkedInRegistration = yield* Database.use((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            const lockedRegistrations = yield* tx
              .select({ status: eventRegistrations.status })
              .from(eventRegistrations)
              .where(
                and(
                  eq(eventRegistrations.id, registration.id),
                  eq(eventRegistrations.tenantId, tenant.id),
                ),
              )
              .for('update');
            if (lockedRegistrations[0]?.status !== 'CONFIRMED') {
              return {
                alreadyCheckedIn: true,
                checkInTime,
              };
            }
            yield* ensureRegistrationMutationHasNoActiveTransfer(tx, {
              registrationId: registration.id,
              tenantId: tenant.id,
            }).pipe(
              Effect.mapError(() => activeRegistrationTransferConflict()),
            );

            const updatedRegistrations = yield* tx
              .update(eventRegistrations)
              .set({
                ...(!registration.checkInTime && { checkInTime }),
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
            appliedDiscountedPrice: true,
            appliedDiscountType: true,
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
              'Paid registration transfer is not available until the refund/resale flow is implemented',
          }),
        );
      }

      if (hasAppliedRegistrationDiscount(registration)) {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message:
              'Discounted registration transfer is not available until transfer discount validation is implemented',
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
          return !!roleEligible;
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
  'events.getRegistrationAddonFulfillment': ({ registrationId }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      yield* ensureRegistrationAddonFulfillmentAccess({
        registrationId,
        tenantId: tenant.id,
        user,
      });
      return yield* getRegistrationAddonFulfillment({
        canCancel: includesPermission(
          'events:cancelRegistrations',
          user.permissions,
        ),
        registrationId,
        tenantId: tenant.id,
      });
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
                transferDeadlineHoursBeforeStart: true,
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

      const activeTransfers =
        registrations.length === 0
          ? []
          : yield* databaseEffect((database) =>
              database
                .select({
                  expiresAt: registrationTransfers.expiresAt,
                  recipientRegistrationId:
                    registrationTransfers.recipientRegistrationId,
                  sourceRegistrationId:
                    registrationTransfers.sourceRegistrationId,
                  status: registrationTransfers.status,
                  transferId: registrationTransfers.id,
                })
                .from(registrationTransfers)
                .where(
                  and(
                    or(
                      inArray(
                        registrationTransfers.sourceRegistrationId,
                        registrations.map((registration) => registration.id),
                      ),
                      inArray(
                        registrationTransfers.recipientRegistrationId,
                        registrations.map((registration) => registration.id),
                      ),
                    ),
                    inArray(registrationTransfers.status, [
                      'checkout_pending',
                      'open',
                    ]),
                    eq(registrationTransfers.tenantId, tenant.id),
                  ),
                ),
            );
      const registrationIds = new Set(
        registrations.map((registration) => registration.id),
      );
      const activeTransferByRegistrationId = new Map<
        string,
        {
          expiresAt: string;
          registrationSide: 'recipient' | 'source';
          status: 'checkout_pending' | 'open';
          transferId: string;
        }
      >();
      for (const transfer of activeTransfers) {
        const status =
          transfer.status === 'checkout_pending' ? 'checkout_pending' : 'open';
        if (registrationIds.has(transfer.sourceRegistrationId)) {
          activeTransferByRegistrationId.set(transfer.sourceRegistrationId, {
            expiresAt: transfer.expiresAt.toISOString(),
            registrationSide: 'source',
            status,
            transferId: transfer.transferId,
          });
        }
        if (
          transfer.recipientRegistrationId &&
          registrationIds.has(transfer.recipientRegistrationId)
        ) {
          activeTransferByRegistrationId.set(transfer.recipientRegistrationId, {
            expiresAt: transfer.expiresAt.toISOString(),
            registrationSide: 'recipient',
            status,
            transferId: transfer.transferId,
          });
        }
      }

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
          activeTransfer:
            activeTransferByRegistrationId.get(registration.id) ?? null,
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
            Date.now() <
              registration.event.start.getTime() -
                (registrationOption.transferDeadlineHoursBeforeStart ??
                  tenant.transferDeadlineHoursBeforeStart ??
                  0) *
                  60 *
                  60 *
                  1000,
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
          maxActiveRegistrationsPerUser: tenant.maxActiveRegistrationsPerUser,
        },
        user: {
          id: user.id,
          roleIds: user.roleIds,
        },
      });
    }),
  'events.redeemRegistrationAddon': (
    { operationKey, registrationAddonId, registrationId },
    _options,
  ) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      yield* ensureRegistrationAddonFulfillmentAccess({
        registrationId,
        tenantId: tenant.id,
        user,
      });
      return yield* redeemRegistrationAddon({
        actorUserId: user.id,
        operationKey,
        registrationAddonId,
        registrationId,
        tenantId: tenant.id,
      });
    }).pipe(Effect.catch(mapRegistrationScanInternalError)),
  'events.registerForEvent': (
    { addOns, answers, eventId, guestCount, registrationOptionId },
    _options,
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
        registrationOptionId,
        tenant: {
          canonicalRootUrl: tenant.canonicalRootUrl,
          currency: tenant.currency,
          domain: tenant.domain,
          id: tenant.id,
          maxActiveRegistrationsPerUser: tenant.maxActiveRegistrationsPerUser,
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

      const isSameUserIssue = registration.userId === user.id;
      const isRegistrationStatusIssue = registration.status !== 'CONFIRMED';
      const remainingGuestCount = Math.max(
        0,
        registration.guestCount - registration.checkedInGuestCount,
      );
      const isAlreadyCheckedInIssue =
        registration.checkInTime !== null && remainingGuestCount === 0;
      const now = yield* registrationHandlerNow;
      const isTimingIssue = !isWithinCheckInWindow(
        registration.event.start,
        now,
      );
      const isAllowCheckin =
        !isRegistrationStatusIssue &&
        !isSameUserIssue &&
        !isTimingIssue &&
        !isAlreadyCheckedInIssue;
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
        allowCheckin: isAllowCheckin,
        alreadyCheckedInIssue: isAlreadyCheckedInIssue,
        appliedDiscountType,
        attendeeCheckedIn: registration.checkInTime !== null,
        checkedInGuestCount: registration.checkedInGuestCount,
        checkInTimingIssue: isTimingIssue,
        event: {
          start: registration.event.start.toISOString(),
          title: registration.event.title,
        },
        guestCount: registration.guestCount,
        registrationOption: {
          title: registration.registrationOption.title,
        },
        registrationStatusIssue: isRegistrationStatusIssue,
        remainingGuestCount,
        sameUserIssue: isSameUserIssue,
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
  'events.undoRegistrationAddonRedemption': (
    { operationKey, redemptionEventId, registrationAddonId, registrationId },
    _options,
  ) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      yield* ensureRegistrationAddonFulfillmentAccess({
        registrationId,
        tenantId: tenant.id,
        user,
      });
      return yield* undoRegistrationAddonRedemption({
        actorUserId: user.id,
        operationKey,
        redemptionEventId,
        registrationAddonId,
        registrationId,
        tenantId: tenant.id,
      });
    }).pipe(Effect.catch(mapRegistrationScanInternalError)),
} satisfies Partial<AppRpcHandlers>;
