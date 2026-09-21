import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  type EventCheckInTimingIssue,
  eventCheckInTimingIssue,
  eventCheckInTimingMessage,
} from '@shared/event-check-in';
import {
  includesPermission,
  type Permission,
} from '@shared/permissions/permissions';
import { registrationCancellationKind } from '@shared/registration-cancellation';
import { registrationSpotCount } from '@shared/registration-spots';
import {
  activeRegistrationTransferStatuses,
  isActiveRegistrationTransferStatus,
} from '@shared/registration-transfer';
import {
  EventCheckInUnavailableError,
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  type EventsCancellableRegistrationStatus,
  type EventsOutgoingRegistrationTransferRecord,
  type EventsRegistrationStatusRecord,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';
import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { Effect, Option, Result } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationAddonFulfillmentEvents,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchaseOrders,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  registrationAcquisitionRefundAllocations,
  registrationTransferRefundPlanItems,
  registrationTransfers,
  tenants,
  tenantStripeTaxRates,
  transactions,
} from '../../../../../db/schema';
import { type Tenant } from '../../../../../types/custom/tenant';
import { getServerNow } from '../../../../clock';
import { formatConfigError } from '../../../../config/config-error';
import { serverClockConfig } from '../../../../config/server-config';
import {
  enqueueRegistrationCancelledEmail,
  enqueueWaitlistSpotAvailableEmail,
} from '../../../../notifications/email-delivery';
import { type RegistrationCancellationActor } from '../../../../notifications/email-templates';
import { resolveAddonTaxAmounts } from '../../../../payments/addon-payment-allocation';
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
import { purchaseRegistrationAddon } from '../../../../registrations/addon-purchase.service';
import { allocateAcquisitionComponentQuantity } from '../../../../registrations/registration-acquisition-refund';
import {
  lockCurrentRegistrationAcquisition,
  RegistrationAcquisitionWriteError,
} from '../../../../registrations/registration-acquisition-write';
import { readRegistrationPriceSnapshot } from '../../../../registrations/registration-price-snapshot';
import {
  ensureRegistrationMutationHasNoActiveTransfer,
  registrationTransferMutationBlockingStatuses,
  RegistrationTransferMutationConflict,
  registrationTransferOpenDeadlinePredicate,
} from '../../../../registrations/registration-transfer-mutation-guard';
import { resolveRegistrationTransferRefundLifecycle } from '../../../../registrations/registration-transfer-refund-lifecycle';
import { StripeClient } from '../../../../stripe-client';
import { tenantOutboundUrl } from '../../../../tenant-outbound-url';
import { safeServerErrorSummary } from '../../../../utils/safe-server-error-summary';
import { RpcAccess } from '../shared/rpc-access.service';
import { EventRegistrationService } from './event-registration.service';
import { databaseEffect } from './events.shared';

type RegistrationScanRpcError =
  | EventRegistrationConflictError
  | EventRegistrationInternalError
  | EventRegistrationNotFoundError
  | RpcForbiddenError
  | RpcUnauthorizedError;

const isRegistrationScanRpcError = (
  error: unknown,
): error is RegistrationScanRpcError =>
  error instanceof EventRegistrationConflictError ||
  error instanceof EventRegistrationInternalError ||
  error instanceof EventRegistrationNotFoundError ||
  error instanceof RpcForbiddenError ||
  error instanceof RpcUnauthorizedError;

const failRegistrationInternalError = (
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

const mapRegistrationInternalError =
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

const mapRegistrationScanInternalError = (error: unknown) =>
  isRegistrationScanRpcError(error)
    ? Effect.fail(error)
    : failRegistrationInternalError(
        'eventRegistration.scan',
        'The ticket could not be loaded. Try again.',
        error,
      );

const mapCheckInMutationInternalError = (
  error: unknown,
): Effect.Effect<
  never,
  EventCheckInUnavailableError | RegistrationScanRpcError
> =>
  error instanceof EventCheckInUnavailableError
    ? Effect.fail(error)
    : mapRegistrationScanInternalError(error);

const isRegistrationMutationRpcError = (
  error: unknown,
): error is
  | EventRegistrationConflictError
  | EventRegistrationInternalError
  | EventRegistrationNotFoundError
  | RpcUnauthorizedError =>
  error instanceof EventRegistrationConflictError ||
  error instanceof EventRegistrationInternalError ||
  error instanceof EventRegistrationNotFoundError ||
  error instanceof RpcUnauthorizedError;

export const mapRegistrationMutationInternalError = (error: unknown) => {
  if (error instanceof EventRegistrationInternalError) {
    return Effect.logError(
      'Event registration mutation failed internally',
    ).pipe(
      Effect.annotateLogs({ cause: error.cause ?? error }),
      Effect.andThen(Effect.fail(withoutRegistrationInternalErrorCause(error))),
    );
  }
  return isRegistrationMutationRpcError(error)
    ? Effect.fail(error)
    : Effect.logError('Event registration mutation failed internally').pipe(
        Effect.annotateLogs({ cause: error }),
        Effect.andThen(
          Effect.fail(
            new EventRegistrationInternalError({
              message:
                'The result of this request could not be confirmed. Open the event again and review your ticket and payment status before taking another action.',
            }),
          ),
        ),
      );
};

export const withoutRegistrationInternalErrorCause = (
  error: EventRegistrationInternalError,
): EventRegistrationInternalError =>
  new EventRegistrationInternalError({ message: error.message });

const registrationHandlerNow = serverClockConfig.pipe(
  Effect.tapError((error) =>
    Effect.logError('Event registration clock configuration failed').pipe(
      Effect.annotateLogs({
        cause: new Error(formatConfigError(error)),
        operation: 'eventRegistration.handlerClock.config',
      }),
    ),
  ),
  Effect.mapError(
    () =>
      new EventRegistrationInternalError({
        message:
          'The event time could not be checked. Open the event again and review its current sign-ups and payment status before continuing.',
      }),
  ),
  Effect.flatMap(({ E2E_NOW_ISO }) =>
    Effect.try({
      catch: (cause) => cause,
      try: () => getServerNow(Option.getOrUndefined(E2E_NOW_ISO)).toJSDate(),
    }).pipe(
      Effect.tapError((cause) =>
        Effect.logError('Event registration clock value failed').pipe(
          Effect.annotateLogs({
            cause,
            operation: 'eventRegistration.handlerClock',
          }),
        ),
      ),
      Effect.mapError(
        () =>
          new EventRegistrationInternalError({
            message:
              'The event time could not be checked. Open the event again and review its current sign-ups and payment status before continuing.',
          }),
      ),
    ),
  ),
);

// Stripe payment deadlines use the real clock, independent of the pinned event clock.
const registrationPaymentDeadlineNow = Effect.sync(() =>
  getServerNow(undefined).toJSDate(),
);

const registrationNotificationEventUrl = (tenant: Tenant, eventId: string) =>
  tenantOutboundUrl(tenant, `/events/${encodeURIComponent(eventId)}`).pipe(
    mapRegistrationInternalError(
      'eventRegistration.notification.eventUrl',
      'The event link could not be prepared. Contact an organizer.',
    ),
  );

const registrationNotificationEmail = (user: {
  communicationEmail?: null | string;
  email: string;
}): string => user.communicationEmail?.trim() || user.email;

const checkInUnavailableError = (reason: EventCheckInTimingIssue) =>
  new EventCheckInUnavailableError({
    message: eventCheckInTimingMessage(reason),
    reason,
  });

const guestCheckInLimitMessage = (remainingGuestCount: number) =>
  `Enter no more than ${remainingGuestCount} additional ${remainingGuestCount === 1 ? 'guest' : 'guests'}.`;

export type RegistrationAddonPurchaseBlockedReason =
  | 'activeTransfer'
  | 'beforeEventDisabled'
  | 'duringEventDisabled'
  | 'eventEnded'
  | 'eventUnavailable'
  | 'multipleNotAllowed'
  | 'none'
  | 'optionLimitReached'
  | 'outOfStock'
  | 'paymentPending'
  | 'paymentUnavailable'
  | 'registrationStatus'
  | 'taxUnavailable'
  | 'userLimitReached';

export type RegistrationAddonPurchaseWindow =
  'afterEvent' | 'beforeEvent' | 'duringEvent';

export const registrationAddonPurchaseAvailability = (input: {
  readonly activeTransfer: boolean;
  readonly allowMultiple: boolean;
  readonly allowPurchaseBeforeEvent: boolean;
  readonly allowPurchaseDuringEvent: boolean;
  readonly eventEnd: Date;
  readonly eventStart: Date;
  readonly eventStatus: string;
  readonly maxQuantityPerUser: number;
  readonly now: Date;
  readonly optionalPurchaseQuantity: number;
  readonly paymentConfigured: boolean;
  readonly pendingOptionalQuantity: number;
  readonly pendingOrder: boolean;
  readonly purchasedOptionalQuantity: number;
  readonly registrationStatus: string;
  readonly stockAvailableQuantity: number;
  readonly taxConfigured: boolean;
}): {
  readonly currentPurchaseWindow: RegistrationAddonPurchaseWindow;
  readonly maxPurchasableQuantity: number;
  readonly purchaseAvailable: boolean;
  readonly purchaseBlockedReason: RegistrationAddonPurchaseBlockedReason;
  readonly purchaseStatus: 'available' | 'blocked' | 'paymentPending';
} => {
  const currentPurchaseWindow: RegistrationAddonPurchaseWindow =
    input.now < input.eventStart
      ? 'beforeEvent'
      : input.now < input.eventEnd
        ? 'duringEvent'
        : 'afterEvent';
  const existingOptionalQuantity =
    input.purchasedOptionalQuantity + input.pendingOptionalQuantity;
  const optionRemaining = Math.max(
    0,
    input.optionalPurchaseQuantity - existingOptionalQuantity,
  );
  const userRemaining = Math.max(
    0,
    input.maxQuantityPerUser - existingOptionalQuantity,
  );
  const multipleRemaining = input.allowMultiple
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, 1 - existingOptionalQuantity);

  let purchaseBlockedReason: RegistrationAddonPurchaseBlockedReason = 'none';
  if (input.registrationStatus !== 'CONFIRMED') {
    purchaseBlockedReason = 'registrationStatus';
  } else if (input.eventStatus !== 'APPROVED') {
    purchaseBlockedReason = 'eventUnavailable';
  } else if (input.activeTransfer) {
    purchaseBlockedReason = 'activeTransfer';
  } else if (input.pendingOrder) {
    purchaseBlockedReason = 'paymentPending';
  } else if (
    currentPurchaseWindow === 'beforeEvent' &&
    !input.allowPurchaseBeforeEvent
  ) {
    purchaseBlockedReason = 'beforeEventDisabled';
  } else if (
    currentPurchaseWindow === 'duringEvent' &&
    !input.allowPurchaseDuringEvent
  ) {
    purchaseBlockedReason = 'duringEventDisabled';
  } else if (currentPurchaseWindow === 'afterEvent') {
    purchaseBlockedReason = 'eventEnded';
  } else if (!input.paymentConfigured) {
    purchaseBlockedReason = 'paymentUnavailable';
  } else if (!input.taxConfigured) {
    purchaseBlockedReason = 'taxUnavailable';
  } else if (!input.allowMultiple && existingOptionalQuantity >= 1) {
    purchaseBlockedReason = 'multipleNotAllowed';
  } else if (optionRemaining === 0) {
    purchaseBlockedReason = 'optionLimitReached';
  } else if (userRemaining === 0) {
    purchaseBlockedReason = 'userLimitReached';
  } else if (input.stockAvailableQuantity === 0) {
    purchaseBlockedReason = 'outOfStock';
  }

  const purchaseAvailable = purchaseBlockedReason === 'none';
  return {
    currentPurchaseWindow,
    maxPurchasableQuantity: purchaseAvailable
      ? Math.min(
          optionRemaining,
          userRemaining,
          multipleRemaining,
          input.stockAvailableQuantity,
        )
      : 0,
    purchaseAvailable,
    purchaseBlockedReason,
    purchaseStatus:
      purchaseBlockedReason === 'paymentPending'
        ? 'paymentPending'
        : purchaseAvailable
          ? 'available'
          : 'blocked',
  };
};

export const registrationAddonCheckoutExpired = (
  expiresAt: Date | null | undefined,
  now: Date,
): boolean => expiresAt !== null && expiresAt !== undefined && expiresAt <= now;

export type RegistrationTransferBlockedReason =
  | 'activeTransfer'
  | 'addonPaymentPending'
  | 'deadlinePassed'
  | 'eventUnavailable'
  | 'none'
  | 'registrationStatus';

export const registrationTransferBlockedReason = (input: {
  readonly activeTransfer: boolean;
  readonly eventStart: Date | null;
  readonly eventStatus: null | string;
  readonly hasPendingAddonOrder: boolean;
  readonly now: Date;
  readonly registrationStatus: string;
  readonly transferDeadlineHoursBeforeStart: number;
}): RegistrationTransferBlockedReason => {
  if (input.registrationStatus !== 'CONFIRMED') return 'registrationStatus';
  if (!input.eventStart || input.eventStatus !== 'APPROVED') {
    return 'eventUnavailable';
  }
  if (input.activeTransfer) return 'activeTransfer';
  if (input.hasPendingAddonOrder) return 'addonPaymentPending';
  return input.now.getTime() >=
    input.eventStart.getTime() -
      input.transferDeadlineHoursBeforeStart * 60 * 60 * 1000
    ? 'deadlinePassed'
    : 'none';
};

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

export const registrationCancellationAvailability = (input: {
  readonly checkInTime: Date | null;
  readonly deadlineHoursBeforeStart: number;
  readonly eventStart: Date;
  readonly now: Date;
}): {
  readonly cancellationAvailable: boolean;
  readonly cancellationBlockedReason:
    'checkedIn' | 'deadlinePassed' | 'eventStarted' | 'none';
} => {
  if (input.checkInTime !== null) {
    return {
      cancellationAvailable: false,
      cancellationBlockedReason: 'checkedIn',
    };
  }

  if (input.eventStart.getTime() <= input.now.getTime()) {
    return {
      cancellationAvailable: false,
      cancellationBlockedReason: 'eventStarted',
    };
  }

  if (
    hasReachedRegistrationCancellationDeadline({
      deadlineHoursBeforeStart: input.deadlineHoursBeforeStart,
      eventStart: input.eventStart,
      now: input.now,
    })
  ) {
    return {
      cancellationAvailable: false,
      cancellationBlockedReason: 'deadlinePassed',
    };
  }

  return {
    cancellationAvailable: true,
    cancellationBlockedReason: 'none',
  };
};

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
  if (amount === null || !Number.isInteger(amount) || amount < 0) {
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

export const mapRegistrationTransferGuardError = Effect.fn(
  'mapRegistrationTransferGuardError',
)((error: unknown) =>
  error instanceof RegistrationTransferMutationConflict
    ? Effect.fail(activeRegistrationTransferConflict())
    : Effect.die(error),
);

export const mapRegistrationAcquisitionGuardError = Effect.fn(
  'mapRegistrationAcquisitionGuardError',
)((error: unknown, conflictMessage: string) =>
  error instanceof RegistrationAcquisitionWriteError
    ? Effect.fail(
        new EventRegistrationConflictError({ message: conflictMessage }),
      )
    : Effect.die(error),
);

const registrationCancellationStateChangedConflict = () =>
  new EventRegistrationConflictError({
    message:
      'The sign-up or payment changed after you confirmed. Nothing was cancelled, no refund was started, and no places or add-ons were released. Review the current sign-up, then confirm again.',
  });

const registrationCancellationStateChanged = ({
  expectedPaymentPending,
  expectedStatus,
  paymentPending,
  status,
}: {
  readonly expectedPaymentPending: boolean | undefined;
  readonly expectedStatus: EventsCancellableRegistrationStatus | undefined;
  readonly paymentPending: boolean;
  readonly status: 'CANCELLED' | EventsCancellableRegistrationStatus;
}): boolean =>
  status !== 'CANCELLED' &&
  ((expectedStatus !== undefined && status !== expectedStatus) ||
    (expectedPaymentPending !== undefined &&
      paymentPending !== expectedPaymentPending));

const findActiveRegistrationTransfer = (
  database: DatabaseClient,
  input: { readonly registrationId: string; readonly tenantId: string },
) =>
  database.query.registrationTransfers.findFirst({
    columns: { id: true },
    where: {
      RAW: registrationTransferOpenDeadlinePredicate,
      sourceRegistrationId: input.registrationId,
      status: { in: [...activeRegistrationTransferStatuses] },
      tenantId: input.tenantId,
    },
  });

const findCheckInBlockingRegistrationTransfer = (
  database: DatabaseClient,
  input: { readonly registrationId: string; readonly tenantId: string },
) =>
  database.query.registrationTransfers.findFirst({
    columns: { id: true },
    where: {
      RAW: registrationTransferOpenDeadlinePredicate,
      sourceRegistrationId: input.registrationId,
      status: { in: [...registrationTransferMutationBlockingStatuses] },
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
  readonly expectedPaymentPending?: boolean;
  readonly expectedStatus?: EventsCancellableRegistrationStatus;
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

export interface RegistrationCancellationOutcome {
  readonly refundClaimId: null | string;
  readonly refundTransactionId: null | string;
  readonly status: 'alreadyCancelled' | 'cancelled';
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

type CancelRegistrationForTenantError =
  | EventRegistrationConflictError
  | EventRegistrationInternalError
  | EventRegistrationNotFoundError;

export const cancelRegistrationForTenant = Effect.fn(
  'cancelRegistrationForTenant',
)(function* ({
  cancelledBy,
  enforceParticipantDeadline,
  executiveUserId,
  expectedEventId,
  expectedPaymentPending,
  expectedStatus,
  expectedUserId,
  expiredCheckout,
  onCancelled = () => Effect.void,
  registrationId,
  targetTenant: tenant,
}: CancelRegistrationForTenantArguments): Effect.fn.Return<
  RegistrationCancellationOutcome,
  CancelRegistrationForTenantError,
  Database | StripeClient
> {
  const stripe = yield* StripeClient;
  const now = yield* registrationHandlerNow;

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

  // This fast-fail is intentionally non-authoritative: it prevents an already
  // stale confirmation from starting reconciliation work, while the row-locked
  // check below remains the concurrency authority.
  const preflightPaymentPending = registration.transactions.some(
    (transaction) =>
      transaction.status === 'pending' && transaction.type === 'registration',
  );
  if (
    registrationCancellationStateChanged({
      expectedPaymentPending,
      expectedStatus,
      paymentPending: preflightPaymentPending,
      status: registration.status,
    })
  ) {
    return yield* Effect.fail(registrationCancellationStateChangedConflict());
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
          'The attendee cancellation deadline has passed, so this sign-up was not cancelled, no refund was started, and no places were released.',
      }),
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
          'Payment setup needs review, so this request did not cancel the registration or release its reserved place. Keep this sign-up and contact the event organizer or Evorto support before starting another payment.',
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

  if (!registration.user) {
    return yield* Effect.fail(
      new EventRegistrationInternalError({
        message:
          'The ticket owner could not be verified. Nothing was cancelled, no refund was started, and no places or add-ons were released. Reopen the ticket and try again.',
      }),
    );
  }
  const cancellationRecipient = registrationNotificationEmail(
    registration.user,
  );
  const waitlistRecipients: {
    registrationId: string;
    to: string;
  }[] = [];
  if (registration.status !== 'WAITLIST') {
    for (const waitlistRegistration of registration.registrationOption
      ?.eventRegistrations ?? []) {
      if (!waitlistRegistration.user) {
        return yield* Effect.fail(
          new EventRegistrationInternalError({
            message:
              'A person on the waitlist could not be verified. Nothing was cancelled, no refund was started, and no places or add-ons were released. Reopen the ticket and try again.',
          }),
        );
      }
      waitlistRecipients.push({
        registrationId: waitlistRegistration.id,
        to: registrationNotificationEmail(waitlistRegistration.user),
      });
    }
  }
  const notificationEventUrl = yield* registrationNotificationEventUrl(
    tenant,
    registration.eventId,
  );

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
          }).pipe(Effect.catch(mapRegistrationTransferGuardError));

          const lockedRegistrationTransactions = yield* tx
            .select({
              amount: transactions.amount,
              appFee: transactions.appFee,
              currency: transactions.currency,
              eventId: transactions.eventId,
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
              targetUserId: transactions.targetUserId,
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
          const paymentPending = lockedRegistrationTransactions.some(
            (currentTransaction) =>
              currentTransaction.status === 'pending' &&
              currentTransaction.type === 'registration',
          );
          if (
            registrationCancellationStateChanged({
              expectedPaymentPending,
              expectedStatus,
              paymentPending,
              status: lockedRegistration.status,
            })
          ) {
            return yield* Effect.fail(
              registrationCancellationStateChangedConflict(),
            );
          }
          const pendingAddonTransaction = lockedRegistrationTransactions.find(
            (currentTransaction) =>
              currentTransaction.status === 'pending' &&
              currentTransaction.method === 'stripe' &&
              currentTransaction.type === 'addon',
          );
          if (pendingAddonTransaction) {
            const pendingAddonOrders = yield* tx
              .select({ id: eventRegistrationAddonPurchaseOrders.id })
              .from(eventRegistrationAddonPurchaseOrders)
              .where(
                and(
                  eq(
                    eventRegistrationAddonPurchaseOrders.registrationId,
                    lockedRegistration.id,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseOrders.status,
                    'pending_payment',
                  ),
                  eq(eventRegistrationAddonPurchaseOrders.tenantId, tenant.id),
                  eq(
                    eventRegistrationAddonPurchaseOrders.transactionId,
                    pendingAddonTransaction.id,
                  ),
                ),
              )
              .for('update');
            if (pendingAddonOrders.length !== 1) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'Pending add-on payment ownership is inconsistent, so this request did not cancel the registration or release inventory.',
                }),
              );
            }
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message:
                  'An add-on payment is still in progress. Finish or let that Checkout expire before cancelling the registration.',
              }),
            );
          }
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
                    'The payment setup changed while cancellation was starting. Nothing was cancelled and no places were released. Review the current sign-up, then try again.',
                }),
              );
            }
            if (!pendingStripeTransaction.stripeAccountId) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'The payment account could not be found. Nothing was cancelled.',
                }),
              );
            }
            if (!pendingStripeTransaction.stripeCheckoutSessionId) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'Payment setup needs review, so this request did not cancel the registration or release its reserved place. Keep this sign-up and contact the event organizer or Evorto support before starting another payment.',
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
                      'The pending payment changed while cancellation was starting. Nothing was cancelled and no places were released. Review the current sign-up, then try again.',
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

          const currentAcquisitionState =
            lockedRegistration.status === 'CONFIRMED'
              ? yield* lockCurrentRegistrationAcquisition(tx, {
                  ownerUserId: lockedRegistration.userId,
                  registrationId: lockedRegistration.id,
                  tenantId: tenant.id,
                }).pipe(
                  Effect.catch((error) =>
                    mapRegistrationAcquisitionGuardError(
                      error,
                      'Registration acquisition ownership is inconsistent, so this request did not cancel the registration, create a refund, or release inventory.',
                    ),
                  ),
                )
              : null;
          const transactionById = new Map(
            lockedRegistrationTransactions.map((transaction) => [
              transaction.id,
              transaction,
            ]),
          );
          const successfulPaymentSources =
            currentAcquisitionState?.payments.flatMap((payment) => {
              const transaction = transactionById.get(payment.transactionId);
              return transaction ? [transaction] : [];
            }) ?? [];
          if (
            currentAcquisitionState &&
            successfulPaymentSources.length !==
              currentAcquisitionState.payments.length
          ) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message:
                  'Registration acquisition payment ownership is incomplete, so this request did not cancel the registration, create a refund, or release inventory.',
              }),
            );
          }
          const stripePaymentSources = successfulPaymentSources.filter(
            (
              transaction,
            ): transaction is typeof transaction & { method: 'stripe' } =>
              transaction.method === 'stripe',
          );
          const shouldRefundPaidSources =
            lockedRegistration.status === 'CONFIRMED' &&
            successfulPaymentSources.length > 0;

          const lockedAddonPurchases = yield* tx
            .select({ id: eventRegistrationAddonPurchases.id })
            .from(eventRegistrationAddonPurchases)
            .where(
              and(
                eq(
                  eventRegistrationAddonPurchases.registrationId,
                  lockedRegistration.id,
                ),
                eq(eventRegistrationAddonPurchases.tenantId, tenant.id),
              ),
            )
            .orderBy(eventRegistrationAddonPurchases.id)
            .for('update');
          const lockedAddonLots =
            lockedAddonPurchases.length === 0
              ? []
              : yield* tx
                  .select()
                  .from(eventRegistrationAddonPurchaseLots)
                  .where(
                    and(
                      inArray(
                        eventRegistrationAddonPurchaseLots.purchaseId,
                        lockedAddonPurchases.map(({ id }) => id),
                      ),
                      eq(
                        eventRegistrationAddonPurchaseLots.tenantId,
                        tenant.id,
                      ),
                    ),
                  )
                  .orderBy(eventRegistrationAddonPurchaseLots.id)
                  .for('update');
          if (lockedRegistration.status === 'CONFIRMED') {
            if (!currentAcquisitionState) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'Registration acquisition ownership is missing, so the registration was not cancelled, no refund was created, and no inventory or spots were released.',
                }),
              );
            }
            const registrationComponents =
              currentAcquisitionState.components.filter(
                ({ kind }) => kind === 'registration',
              );
            const addonComponents = currentAcquisitionState.components.filter(
              ({ kind }) => kind === 'addon_lot',
            );
            const componentByLotId = new Map(
              addonComponents.flatMap((component) =>
                component.purchaseLotId
                  ? [[component.purchaseLotId, component]]
                  : [],
              ),
            );
            const paymentById = new Map(
              currentAcquisitionState.payments.map((payment) => [
                payment.id,
                payment,
              ]),
            );
            const invalidComponentShape =
              currentAcquisitionState.acquisition.eventId !==
                lockedRegistration.eventId ||
              currentAcquisitionState.acquisition.spotCount !==
                registrationSpotCount(lockedRegistration.guestCount) ||
              registrationComponents.length !== 1 ||
              registrationComponents[0]?.quantity !==
                registrationSpotCount(lockedRegistration.guestCount) ||
              addonComponents.length !== lockedAddonLots.length ||
              lockedAddonLots.some((lot) => {
                const component = componentByLotId.get(lot.id);
                return (
                  !component ||
                  component.purchaseId !== lot.purchaseId ||
                  component.quantity !== lot.quantity
                );
              });
            const invalidPaymentShape = successfulPaymentSources.some(
              (source) => {
                const acquisitionPayment =
                  currentAcquisitionState.payments.find(
                    ({ transactionId }) => transactionId === source.id,
                  );
                const components = acquisitionPayment
                  ? currentAcquisitionState.components.filter(
                      ({ acquisitionPaymentId }) =>
                        acquisitionPaymentId === acquisitionPayment.id,
                    )
                  : [];
                return (
                  !acquisitionPayment ||
                  source.amount <= 0 ||
                  source.appFee === null ||
                  source.eventId !== lockedRegistration.eventId ||
                  source.status !== 'successful' ||
                  source.method !== 'stripe' ||
                  !source.stripeAccountId ||
                  !hasStripeRefundReference(source) ||
                  source.stripeFee === null ||
                  source.stripeNetAmount === null ||
                  source.targetUserId !== lockedRegistration.userId ||
                  (source.type !== 'registration' && source.type !== 'addon') ||
                  components.length === 0 ||
                  components.some(
                    (component) => component.currency !== source.currency,
                  ) ||
                  components.reduce(
                    (sum, component) => sum + component.grossAmount,
                    0,
                  ) !== source.amount ||
                  components.reduce(
                    (sum, component) => sum + component.applicationFeeAmount,
                    0,
                  ) !== source.appFee ||
                  components.reduce(
                    (sum, component) => sum + component.stripeFeeAmount,
                    0,
                  ) !== source.stripeFee ||
                  components.reduce(
                    (sum, component) => sum + component.netAmount,
                    0,
                  ) !== source.stripeNetAmount
                );
              },
            );
            const invalidComponentPayment =
              currentAcquisitionState.components.some((component) =>
                component.grossAmount > 0
                  ? !component.acquisitionPaymentId ||
                    !paymentById.has(component.acquisitionPaymentId)
                  : component.acquisitionPaymentId !== null,
              );
            if (
              invalidComponentShape ||
              invalidPaymentShape ||
              invalidComponentPayment ||
              stripePaymentSources.length !== successfulPaymentSources.length
            ) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'Stripe payment ownership or acquisition settlement is inconsistent, so the registration was not cancelled, no refund was created, and no inventory or spots were released. Reconcile the payment and retry cancellation.',
                }),
              );
            }
          }

          const lockedTenants = yield* tx
            .select({
              cancellationDeadlineHoursBeforeStart:
                tenants.cancellationDeadlineHoursBeforeStart,
              refundFeesOnCancellation: tenants.refundFeesOnCancellation,
            })
            .from(tenants)
            .where(eq(tenants.id, tenant.id))
            .for('update');
          const lockedTenant = lockedTenants[0];
          if (!lockedTenant) {
            return yield* Effect.fail(
              new EventRegistrationInternalError({
                message:
                  'The organization for this sign-up could not be found. No changes were made.',
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
                  'The attendee cancellation deadline has passed, so this sign-up was not cancelled, no refund was started, and no places were released.',
              }),
            );
          }

          const refundFeesOnCancellation = resolveRefundFeesOnCancellation(
            lockedRegistrationOption.refundFeesOnCancellation,
            lockedTenant.refundFeesOnCancellation,
          );
          const invalidStripeSource = stripePaymentSources.find(
            (source) =>
              source.appFee === null ||
              source.stripeFee === null ||
              source.stripeNetAmount === null ||
              !hasStripeRefundReference(source) ||
              !registrationCancellationStripeRefundTerms({
                grossAmount: source.amount,
                refundFeesOnCancellation,
                stripeNetAmount: source.stripeNetAmount,
              }),
          );
          if (shouldRefundPaidSources && invalidStripeSource) {
            return yield* Effect.fail(
              new EventRegistrationConflictError({
                message:
                  'Payment fees or historical Stripe source ownership changed for a registration or add-on source, so this request did not cancel the registration, create a refund, or release inventory. Reconcile the payment and retry cancellation.',
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
              reason:
                cancelledBy === 'participant'
                  ? 'Sign-up ended by attendee'
                  : 'Sign-up ended by organizer',
              refundRequested: lockedRegistration.status === 'CONFIRMED',
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
          if (shouldRefundPaidSources) {
            if (!currentAcquisitionState) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'Current registration acquisition disappeared before refund allocation.',
                }),
              );
            }
            const cancellationEventIds = new Set(
              addonCancellationAllocations.map(
                ({ fulfillmentEventId }) => fulfillmentEventId,
              ),
            );
            const monetaryCancellationEventIds = new Set<string>();
            const priorAllocations = yield* tx
              .select({
                componentId:
                  registrationAcquisitionRefundAllocations.componentId,
                quantity: registrationAcquisitionRefundAllocations.quantity,
              })
              .from(registrationAcquisitionRefundAllocations)
              .where(
                and(
                  eq(
                    registrationAcquisitionRefundAllocations.acquisitionId,
                    currentAcquisitionState.acquisition.id,
                  ),
                  eq(
                    registrationAcquisitionRefundAllocations.tenantId,
                    tenant.id,
                  ),
                ),
              )
              .orderBy(registrationAcquisitionRefundAllocations.id)
              .for('update');
            const priorQuantityByComponent = new Map<string, number>();
            for (const allocation of priorAllocations) {
              priorQuantityByComponent.set(
                allocation.componentId,
                (priorQuantityByComponent.get(allocation.componentId) ?? 0) +
                  allocation.quantity,
              );
            }
            const registrationComponent =
              currentAcquisitionState.components.find(
                ({ kind }) => kind === 'registration',
              );
            if (!registrationComponent) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'Registration acquisition component disappeared before cancellation.',
                }),
              );
            }
            const componentByLotId = new Map(
              currentAcquisitionState.components.flatMap((component) =>
                component.kind === 'addon_lot' && component.purchaseLotId
                  ? [[component.purchaseLotId, component] as const]
                  : [],
              ),
            );
            const registrationAlreadyAllocated =
              priorQuantityByComponent.get(registrationComponent.id) ?? 0;
            if (registrationAlreadyAllocated !== 0) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'Registration refund entitlement is inconsistent with its acquisition component.',
                }),
              );
            }
            type CancellationComponent =
              (typeof currentAcquisitionState.components)[number];
            const componentAllocations: {
              applicationFeeAmount: number;
              component: CancellationComponent;
              fulfillmentEventId: null | string;
              grossAmount: number;
              netAmount: number;
              operationKey: string;
              purchaseId: null | string;
              quantity: number;
              stripeFeeAmount: number;
            }[] = [];
            if (registrationComponent.grossAmount > 0) {
              const registrationAmounts = allocateAcquisitionComponentQuantity({
                alreadyAllocatedQuantity: 0,
                component: registrationComponent,
                quantity: registrationComponent.quantity,
              });
              if (
                !registrationAmounts ||
                !registrationComponent.acquisitionPaymentId
              ) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message:
                      'Paid registration component has no immutable refund entitlement.',
                  }),
                );
              }
              componentAllocations.push({
                ...registrationAmounts,
                component: registrationComponent,
                fulfillmentEventId: null,
                operationKey: `registration-cancellation:${lockedRegistration.id}:${registrationComponent.id}`,
                purchaseId: null,
                quantity: registrationComponent.quantity,
              });
            }
            for (const cancellationAllocation of addonCancellationAllocations) {
              const component = componentByLotId.get(
                cancellationAllocation.lot.id,
              );
              const priorMonetaryQuantity = component
                ? (priorQuantityByComponent.get(component.id) ?? 0)
                : 0;
              if (
                !component ||
                component.purchaseId !== cancellationAllocation.purchaseId ||
                component.quantity !== cancellationAllocation.lot.quantity ||
                priorMonetaryQuantity >
                  cancellationAllocation.lot.cancelledQuantity
              ) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message:
                      'Add-on cancellation no longer matches its immutable acquisition component.',
                  }),
                );
              }
              if (component.grossAmount === 0) continue;
              if (!component.acquisitionPaymentId) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message:
                      'Paid add-on acquisition component has no payment owner.',
                  }),
                );
              }
              const amounts = allocateAcquisitionComponentQuantity({
                alreadyAllocatedQuantity:
                  cancellationAllocation.lot.cancelledQuantity +
                  cancellationAllocation.lot.redeemedQuantity,
                component,
                quantity: cancellationAllocation.quantity,
              });
              if (!amounts) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message:
                      'Add-on cancellation exceeds its immutable acquisition entitlement.',
                  }),
                );
              }
              componentAllocations.push({
                ...amounts,
                component,
                fulfillmentEventId: cancellationAllocation.fulfillmentEventId,
                operationKey: `registration-cancellation:${lockedRegistration.id}:${component.id}`,
                purchaseId: cancellationAllocation.purchaseId,
                quantity: cancellationAllocation.quantity,
              });
            }
            for (const acquisitionPayment of currentAcquisitionState.payments) {
              const source = stripePaymentSources.find(
                ({ id }) => id === acquisitionPayment.transactionId,
              );
              if (!source?.stripeAccountId || source.stripeNetAmount === null) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message:
                      'A paid acquisition source is missing its historical Stripe settlement, so cancellation did not continue.',
                  }),
                );
              }
              const paymentAllocations = componentAllocations.filter(
                ({ component }) =>
                  component.acquisitionPaymentId === acquisitionPayment.id,
              );
              const monetaryAllocations = paymentAllocations.filter(
                (allocation) =>
                  (refundFeesOnCancellation
                    ? allocation.grossAmount
                    : allocation.netAmount) > 0,
              );
              const amount = monetaryAllocations.reduce(
                (sum, allocation) =>
                  sum +
                  (refundFeesOnCancellation
                    ? allocation.grossAmount
                    : allocation.netAmount),
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
              for (const allocation of monetaryAllocations) {
                if (allocation.fulfillmentEventId) {
                  monetaryCancellationEventIds.add(
                    allocation.fulfillmentEventId,
                  );
                }
                if (!refundClaim) {
                  return yield* Effect.fail(
                    new EventRegistrationInternalError({
                      message:
                        'Monetary acquisition allocation has no refund claim.',
                    }),
                  );
                }
                yield* tx
                  .insert(registrationAcquisitionRefundAllocations)
                  .values({
                    acquisitionId: currentAcquisitionState.acquisition.id,
                    acquisitionPaymentId: acquisitionPayment.id,
                    applicationFeeAmount: allocation.applicationFeeAmount,
                    applicationFeeRefunded: refundFeesOnCancellation,
                    componentId: allocation.component.id,
                    eventId: lockedRegistration.eventId,
                    fulfillmentEventId: allocation.fulfillmentEventId,
                    grossEntitlementAmount: allocation.grossAmount,
                    netEntitlementAmount: allocation.netAmount,
                    operationKey: allocation.operationKey,
                    operationKind: allocation.fulfillmentEventId
                      ? 'addon_cancellation'
                      : 'registration_cancellation',
                    purchaseId: allocation.purchaseId,
                    quantity: allocation.quantity,
                    refundAmount: refundFeesOnCancellation
                      ? allocation.grossAmount
                      : allocation.netAmount,
                    refundTransactionId: refundClaim.id,
                    registrationId: lockedRegistration.id,
                    stripeFeeAmount: allocation.stripeFeeAmount,
                    tenantId: tenant.id,
                  });
              }
            }
            if (monetaryCancellationEventIds.size > 0) {
              yield* tx
                .update(eventRegistrationAddonFulfillmentEvents)
                .set({ refundDisposition: 'claims_created' })
                .where(
                  inArray(eventRegistrationAddonFulfillmentEvents.id, [
                    ...monetaryCancellationEventIds,
                  ]),
                );
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
          }

          yield* enqueueRegistrationCancelledEmail(tx, {
            cancellationKind: registrationCancellationKind({
              paymentPending,
              status: lockedRegistration.status,
            }),
            cancelledBy,
            eventTitle: registration.event.title,
            eventUrl: notificationEventUrl,
            refundOutcome: refundTransactionId ? 'pending' : 'notStarted',
            registrationId: lockedRegistration.id,
            tenant,
            to: cancellationRecipient,
          });
          if (
            releasesReservedResources &&
            lockedRegistration.status !== 'WAITLIST'
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
            : failRegistrationInternalError(
                'eventRegistration.cancel.persist',
                'The sign-up could not be ended. Nothing was changed. Try again.',
                error,
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
        catch: (cause) => cause,
        try: () =>
          Promise.race([
            stripe.checkout.sessions.expire(
              stripeCheckoutSessionId,
              undefined,
              {
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
      }).pipe(
        mapRegistrationInternalError(
          'eventRegistration.cancel.checkout.expire',
          'The pending sign-up could not be cancelled. Nothing was changed and no places were released. Reopen it and review the current payment before selecting Cancel sign-up again.',
        ),
      ),
    );
    const confirmedExpired = Result.isFailure(expirationResult)
      ? yield* Effect.tryPromise({
          catch: (cause) => cause,
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
          mapRegistrationInternalError(
            'eventRegistration.cancel.checkout.retrieve',
            'The pending sign-up could not be cancelled. Nothing was changed and no places were released. Reopen it and review the current payment before selecting Cancel sign-up again.',
          ),
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
            'The pending payment could not be cancelled, so the sign-up and its reserved places were left unchanged. Review the sign-up before trying again.',
        }),
      );
    }
    return yield* cancelRegistrationForTenant({
      cancelledBy,
      enforceParticipantDeadline,
      executiveUserId,
      ...(expectedEventId && { expectedEventId }),
      ...(expectedPaymentPending !== undefined && {
        expectedPaymentPending,
      }),
      ...(expectedStatus && { expectedStatus }),
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
  expectedPaymentPending,
  expectedStatus,
  registrationId,
  requireOrganizerAccess = false,
}: {
  eventId?: string;
  expectedPaymentPending: boolean;
  expectedStatus: EventsCancellableRegistrationStatus;
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
    expectedPaymentPending,
    expectedStatus,
    ...(!requireOrganizerAccess && { expectedUserId: user.id }),
    registrationId,
    targetTenant: tenant,
  });
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
        executiveUserId: user.id,
        expectedEventId: eventId,
        registrationId,
        targetTenant: {
          currency: tenant.currency,
          domain: tenant.domain,
          emailSenderEmail: tenant.emailSenderEmail,
          emailSenderName: tenant.emailSenderName,
          id: tenant.id,
          name: tenant.name,
          stripeAccountId: tenant.stripeAccountId,
          timezone: tenant.timezone,
        },
      });
    }).pipe(Effect.catch(mapRegistrationScanInternalError)),
  'events.cancelEventRegistration': (
    { eventId, expectedPaymentPending, expectedStatus, registrationId },
    _options,
  ) =>
    cancelRegistration({
      eventId,
      expectedPaymentPending,
      expectedStatus,
      registrationId,
      requireOrganizerAccess: true,
    }),
  'events.cancelPendingRegistration': ({ registrationId }, _options) =>
    cancelRegistration({
      expectedPaymentPending: false,
      expectedStatus: 'PENDING',
      registrationId,
    }),
  'events.cancelRegistration': (
    { expectedPaymentPending, expectedStatus, registrationId },
    _options,
  ) =>
    cancelRegistration({
      expectedPaymentPending,
      expectedStatus,
      registrationId,
    }),
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
            message: 'Enter a whole number of guests, starting at zero.',
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
        }),
      );

      if (!registration) {
        return yield* Effect.fail(
          new EventRegistrationNotFoundError({
            message:
              'This ticket is no longer available. No change was made. Reopen the event and review its current sign-ups.',
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
            message: 'Ask another organizer to check in this ticket.',
          }),
        );
      }

      const activeTransfer = yield* databaseEffect((database) =>
        findCheckInBlockingRegistrationTransfer(database, {
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
            message: 'This ticket is not ready for check-in.',
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
            message: guestCheckInLimitMessage(remainingGuestCount),
          }),
        );
      }

      const checkedInRegistration = yield* Database.use((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            const lockedRegistrations = yield* tx
              .select({
                checkedInGuestCount: eventRegistrations.checkedInGuestCount,
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
                ),
              )
              .for('update');
            const lockedRegistration = lockedRegistrations[0];
            if (!lockedRegistration) {
              return yield* Effect.fail(
                new EventRegistrationNotFoundError({
                  message:
                    'This ticket is no longer available. No change was made. Reopen the event and review its current sign-ups.',
                }),
              );
            }
            if (lockedRegistration.userId === user.id) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message: 'Ask another organizer to check in this ticket.',
                }),
              );
            }
            if (lockedRegistration.status !== 'CONFIRMED') {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message: 'This ticket is not ready for check-in.',
                }),
              );
            }
            yield* ensureRegistrationMutationHasNoActiveTransfer(tx, {
              registrationId: lockedRegistration.id,
              tenantId: tenant.id,
            }).pipe(Effect.catch(mapRegistrationTransferGuardError));

            const lockedEvents = yield* tx
              .select({
                end: eventInstances.end,
                start: eventInstances.start,
              })
              .from(eventInstances)
              .where(
                and(
                  eq(eventInstances.id, lockedRegistration.eventId),
                  eq(eventInstances.tenantId, tenant.id),
                ),
              )
              .for('share');
            const lockedEvent = lockedEvents[0];
            if (!lockedEvent) {
              yield* Effect.logError(
                'Registration event was missing during check-in',
              ).pipe(
                Effect.annotateLogs({
                  eventId: lockedRegistration.eventId,
                  registrationId: lockedRegistration.id,
                  tenantId: tenant.id,
                }),
              );
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'The event details are unavailable, so no check-in was recorded. Contact an Evorto administrator.',
                }),
              );
            }

            if (
              lockedRegistration.checkedInGuestCount < 0 ||
              lockedRegistration.guestCount < 0 ||
              lockedRegistration.checkedInGuestCount >
                lockedRegistration.guestCount
            ) {
              yield* Effect.logError(
                'Registration guest counts were invalid during check-in',
              ).pipe(
                Effect.annotateLogs({
                  checkedInGuestCount: lockedRegistration.checkedInGuestCount,
                  guestCount: lockedRegistration.guestCount,
                  registrationId: lockedRegistration.id,
                  tenantId: tenant.id,
                }),
              );
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'The guest details need Evorto administrator review, so no check-in was recorded.',
                }),
              );
            }
            const lockedRemainingGuestCount =
              lockedRegistration.guestCount -
              lockedRegistration.checkedInGuestCount;
            if (guestCheckInCount > lockedRemainingGuestCount) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message: guestCheckInLimitMessage(lockedRemainingGuestCount),
                }),
              );
            }
            const now = yield* registrationHandlerNow;
            const timingIssue = eventCheckInTimingIssue({
              end: lockedEvent.end,
              now,
              start: lockedEvent.start,
            });
            if (timingIssue) {
              return {
                _tag: 'TimingIssue' as const,
                reason: timingIssue,
              };
            }
            if (lockedRegistration.checkInTime && guestCheckInCount === 0) {
              return {
                _tag: 'CheckedIn' as const,
                alreadyCheckedIn: true,
                checkInTime: lockedRegistration.checkInTime,
              };
            }
            const checkedInSpotCount =
              (lockedRegistration.checkInTime ? 0 : 1) + guestCheckInCount;

            const updatedRegistrations = yield* tx
              .update(eventRegistrations)
              .set({
                ...(!lockedRegistration.checkInTime && { checkInTime: now }),
                checkedInGuestCount: sql`${eventRegistrations.checkedInGuestCount} + ${guestCheckInCount}`,
              })
              .where(
                and(
                  eq(eventRegistrations.id, lockedRegistration.id),
                  eq(eventRegistrations.tenantId, tenant.id),
                  eq(eventRegistrations.status, 'CONFIRMED'),
                  eq(eventRegistrations.userId, lockedRegistration.userId),
                ),
              )
              .returning({
                checkedInGuestCount: eventRegistrations.checkedInGuestCount,
                checkInTime: eventRegistrations.checkInTime,
                id: eventRegistrations.id,
              });

            const updatedRegistration = updatedRegistrations[0];
            if (!updatedRegistration?.checkInTime) {
              yield* Effect.logError(
                'Locked registration check-in update did not persist',
              ).pipe(
                Effect.annotateLogs({
                  registrationId: lockedRegistration.id,
                  tenantId: tenant.id,
                }),
              );
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'The check-in could not be saved. Nothing was changed. Try again.',
                }),
              );
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
                    lockedRegistration.registrationOptionId,
                  ),
                  eq(
                    eventRegistrationOptions.eventId,
                    lockedRegistration.eventId,
                  ),
                ),
              )
              .returning({
                id: eventRegistrationOptions.id,
              });

            if (updatedOptions.length === 0) {
              yield* Effect.logError(
                'Registration option was missing during check-in',
              ).pipe(
                Effect.annotateLogs({
                  eventId: lockedRegistration.eventId,
                  registrationId: lockedRegistration.id,
                  registrationOptionId: lockedRegistration.registrationOptionId,
                  tenantId: tenant.id,
                }),
              );
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'The sign-up choice is unavailable, so no check-in was recorded. Contact an Evorto administrator.',
                }),
              );
            }

            return {
              _tag: 'CheckedIn' as const,
              alreadyCheckedIn: false,
              checkInTime: updatedRegistration.checkInTime,
            };
          }),
        ),
      );

      if (checkedInRegistration._tag === 'TimingIssue') {
        return yield* Effect.fail(
          checkInUnavailableError(checkedInRegistration.reason),
        );
      }
      return {
        alreadyCheckedIn: checkedInRegistration.alreadyCheckedIn,
        checkInTime: checkedInRegistration.checkInTime.toISOString(),
      };
    }).pipe(Effect.catch(mapCheckInMutationInternalError)),
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
          outgoingTransfers: [],
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
            addonPurchaseOrders: {
              columns: {
                addonId: true,
                expiresAt: true,
                operationKey: true,
                quantity: true,
              },
              where: {
                requestedByUserId: user.id,
                status: 'pending_payment',
                tenantId: tenant.id,
              },
              with: {
                transaction: {
                  columns: {
                    stripeCheckoutUrl: true,
                  },
                  where: {
                    method: 'stripe',
                    status: 'pending',
                    tenantId: tenant.id,
                    type: 'addon',
                  },
                },
              },
            },
            addonPurchases: {
              columns: {
                addonId: true,
                cancelledQuantity: true,
                includedQuantity: true,
                purchasedQuantity: true,
                quantity: true,
                redeemedQuantity: true,
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
                end: true,
                start: true,
                status: true,
              },
            },
            registrationOption: {
              columns: {
                cancellationDeadlineHoursBeforeStart: true,
                organizingRegistration: true,
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

      const registrationOptionIds = [
        ...new Set(
          registrations.map(
            (registration) => registration.registrationOptionId,
          ),
        ),
      ];
      const registrationAddOnOptions =
        registrationOptionIds.length === 0
          ? []
          : yield* databaseEffect((database) =>
              database
                .select({
                  addOnId: eventAddons.id,
                  allowMultiple: eventAddons.allowMultiple,
                  allowPurchaseBeforeEvent:
                    eventAddons.allowPurchaseBeforeEvent,
                  allowPurchaseDuringEvent:
                    eventAddons.allowPurchaseDuringEvent,
                  description: eventAddons.description,
                  isPaid: eventAddons.isPaid,
                  maxQuantityPerUser: eventAddons.maxQuantityPerUser,
                  nextPurchaseTaxRateDisplayName:
                    tenantStripeTaxRates.displayName,
                  nextPurchaseTaxRateInclusive: tenantStripeTaxRates.inclusive,
                  nextPurchaseTaxRatePercentage:
                    tenantStripeTaxRates.percentage,
                  nextPurchaseUnitPrice: eventAddons.price,
                  optionalPurchaseQuantity:
                    addonToEventRegistrationOptions.optionalPurchaseQuantity,
                  registrationOptionId:
                    addonToEventRegistrationOptions.registrationOptionId,
                  stockAvailableQuantity: eventAddons.totalAvailableQuantity,
                  stripeTaxRateId: eventAddons.stripeTaxRateId,
                  title: eventAddons.title,
                })
                .from(addonToEventRegistrationOptions)
                .innerJoin(
                  eventAddons,
                  and(
                    eq(eventAddons.id, addonToEventRegistrationOptions.addonId),
                    eq(
                      eventAddons.eventId,
                      addonToEventRegistrationOptions.eventId,
                    ),
                  ),
                )
                .innerJoin(
                  eventInstances,
                  and(
                    eq(
                      eventInstances.id,
                      addonToEventRegistrationOptions.eventId,
                    ),
                    eq(eventInstances.tenantId, tenant.id),
                  ),
                )
                .leftJoin(
                  tenantStripeTaxRates,
                  and(
                    eq(tenantStripeTaxRates.tenantId, tenant.id),
                    eq(
                      tenantStripeTaxRates.stripeAccountId,
                      tenant.stripeAccountId ?? '',
                    ),
                    eq(
                      tenantStripeTaxRates.stripeTaxRateId,
                      eventAddons.stripeTaxRateId,
                    ),
                    eq(tenantStripeTaxRates.active, true),
                  ),
                )
                .where(
                  and(
                    eq(addonToEventRegistrationOptions.eventId, eventId),
                    inArray(
                      addonToEventRegistrationOptions.registrationOptionId,
                      registrationOptionIds,
                    ),
                  ),
                )
                .orderBy(
                  addonToEventRegistrationOptions.registrationOptionId,
                  eventAddons.id,
                ),
            );

      const ownedRegistrationIds = registrations.map(
        (registration) => registration.id,
      );
      const transferVisibility =
        ownedRegistrationIds.length === 0
          ? eq(registrationTransfers.sourceUserId, user.id)
          : or(
              eq(registrationTransfers.sourceUserId, user.id),
              inArray(
                registrationTransfers.sourceRegistrationId,
                ownedRegistrationIds,
              ),
            );
      const visibleTransfers = yield* databaseEffect((database) =>
        database
          .select({
            expiresAt: registrationTransfers.expiresAt,
            ownershipTransferredAt:
              registrationTransfers.ownershipTransferredAt,
            registrationOptionId: registrationTransfers.registrationOptionId,
            sourceRegistrationId: registrationTransfers.sourceRegistrationId,
            sourceUserId: registrationTransfers.sourceUserId,
            status: registrationTransfers.status,
            transferId: registrationTransfers.id,
          })
          .from(registrationTransfers)
          .where(
            and(
              eq(registrationTransfers.eventId, eventId),
              eq(registrationTransfers.tenantId, tenant.id),
              inArray(registrationTransfers.status, [
                ...activeRegistrationTransferStatuses,
                'completed',
              ]),
              registrationTransferOpenDeadlinePredicate(registrationTransfers),
              transferVisibility,
            ),
          ),
      );
      const outgoingTransferRows = visibleTransfers.flatMap((transfer) => {
        const ownershipTransferredAt = transfer.ownershipTransferredAt;
        if (
          transfer.sourceUserId !== user.id ||
          ownershipTransferredAt === null
        ) {
          return [];
        }
        switch (transfer.status) {
          case 'completed':
          case 'refund_failed':
          case 'refund_pending': {
            return [{ ...transfer, ownershipTransferredAt }];
          }
          default: {
            return [];
          }
        }
      });
      const currentRegistrationIdRows =
        outgoingTransferRows.length === 0 || ownedRegistrationIds.length === 0
          ? ownedRegistrationIds.map((id) => ({ id }))
          : yield* databaseEffect((database) =>
              database.query.eventRegistrations.findMany({
                columns: { id: true },
                where: {
                  eventId,
                  id: { in: ownedRegistrationIds },
                  status: { NOT: 'CANCELLED' },
                  tenantId: tenant.id,
                  userId: user.id,
                },
              }),
            );
      const currentRegistrationIds = new Set(
        currentRegistrationIdRows.map((registration) => registration.id),
      );
      const currentlyOwnedRegistrations = registrations.filter((registration) =>
        currentRegistrationIds.has(registration.id),
      );
      const visibleTransferRefundRows =
        visibleTransfers.length === 0
          ? []
          : yield* databaseEffect((database) =>
              database
                .select({
                  currency: registrationTransferRefundPlanItems.currency,
                  refund: {
                    manuallyCreated: transactions.manuallyCreated,
                    method: transactions.method,
                    status: transactions.status,
                    stripeRefundAttempts: transactions.stripeRefundAttempts,
                    stripeRefundClaimLeaseExpiresAt:
                      transactions.stripeRefundClaimLeaseExpiresAt,
                    stripeRefundClaimLeaseId:
                      transactions.stripeRefundClaimLeaseId,
                    stripeRefundMaxAttempts:
                      transactions.stripeRefundMaxAttempts,
                    stripeRefundNextAttemptAt:
                      transactions.stripeRefundNextAttemptAt,
                    stripeRefundStatus: transactions.stripeRefundStatus,
                  },
                  refundAmountDue:
                    registrationTransferRefundPlanItems.refundAmountDue,
                  transferId: registrationTransferRefundPlanItems.transferId,
                })
                .from(registrationTransferRefundPlanItems)
                .leftJoin(
                  transactions,
                  and(
                    eq(
                      transactions.id,
                      registrationTransferRefundPlanItems.refundTransactionId,
                    ),
                    eq(
                      transactions.tenantId,
                      registrationTransferRefundPlanItems.tenantId,
                    ),
                    eq(transactions.type, 'refund'),
                  ),
                )
                .where(
                  and(
                    inArray(
                      registrationTransferRefundPlanItems.transferId,
                      visibleTransfers.map((transfer) => transfer.transferId),
                    ),
                    eq(registrationTransferRefundPlanItems.tenantId, tenant.id),
                    gt(registrationTransferRefundPlanItems.refundAmountDue, 0),
                  ),
                ),
            );
      const refundRowsByTransferId = new Map<
        string,
        (typeof visibleTransferRefundRows)[number][]
      >();
      for (const row of visibleTransferRefundRows) {
        const refundRows = refundRowsByTransferId.get(row.transferId) ?? [];
        refundRows.push(row);
        refundRowsByTransferId.set(row.transferId, refundRows);
      }
      const outgoingRegistrationOptionIds = [
        ...new Set(
          outgoingTransferRows.map((transfer) => transfer.registrationOptionId),
        ),
      ];
      const outgoingRegistrationOptions =
        outgoingRegistrationOptionIds.length === 0
          ? []
          : yield* databaseEffect((database) =>
              database
                .select({
                  id: eventRegistrationOptions.id,
                  title: eventRegistrationOptions.title,
                })
                .from(eventRegistrationOptions)
                .where(
                  and(
                    eq(eventRegistrationOptions.eventId, eventId),
                    inArray(
                      eventRegistrationOptions.id,
                      outgoingRegistrationOptionIds,
                    ),
                  ),
                ),
            );
      const outgoingRegistrationOptionTitleById = new Map(
        outgoingRegistrationOptions.map((option) => [option.id, option.title]),
      );
      const outgoingTransfers = outgoingTransferRows
        .map((transfer) => {
          const refundRows =
            refundRowsByTransferId.get(transfer.transferId) ?? [];
          const refundAmount = refundRows.reduce(
            (total, row) => total + row.refundAmountDue,
            0,
          );
          const refundLifecycle = resolveRegistrationTransferRefundLifecycle({
            refunds: refundRows.map((row) => row.refund),
            transferStatus: transfer.status,
          });
          const refundStatus: EventsOutgoingRegistrationTransferRecord['refundStatus'] =
            transfer.status === 'completed'
              ? refundAmount === 0
                ? 'notRequired'
                : 'completed'
              : refundLifecycle?.state === 'processing'
                ? 'processing'
                : refundLifecycle?.state === 'succeeded'
                  ? 'completed'
                  : 'needsAttention';
          const registrationOptionTitle =
            outgoingRegistrationOptionTitleById.get(
              transfer.registrationOptionId,
            );
          if (!registrationOptionTitle) {
            throw new Error(
              `Registration option missing for transfer ${transfer.transferId}`,
            );
          }
          return {
            currency: refundRows[0]?.currency ?? tenant.currency,
            refundAmount,
            refundStatus,
            registrationOptionTitle,
            transferId: transfer.transferId,
            transferredAt: transfer.ownershipTransferredAt.toISOString(),
          };
        })
        .toSorted((left, right) =>
          right.transferredAt.localeCompare(left.transferredAt),
        );
      const registrationIds = new Set(
        currentlyOwnedRegistrations.map((registration) => registration.id),
      );
      const activeTransferByRegistrationId = new Map<
        string,
        NonNullable<EventsRegistrationStatusRecord['activeTransfer']>
      >();
      for (const transfer of visibleTransfers) {
        if (!isActiveRegistrationTransferStatus(transfer.status)) continue;
        const refundLifecycle = resolveRegistrationTransferRefundLifecycle({
          refunds: (refundRowsByTransferId.get(transfer.transferId) ?? []).map(
            (row) => row.refund,
          ),
          transferStatus: transfer.status,
        });
        if (registrationIds.has(transfer.sourceRegistrationId)) {
          activeTransferByRegistrationId.set(transfer.sourceRegistrationId, {
            expiresAt: transfer.expiresAt.toISOString(),
            refundLifecycle,
            registrationSide: transfer.ownershipTransferredAt
              ? 'recipient'
              : 'source',
            status: transfer.status,
            transferId: transfer.transferId,
          });
        }
      }

      const addOnOptionsByRegistrationOptionId = new Map<
        string,
        (typeof registrationAddOnOptions)[number][]
      >();
      for (const addOnOption of registrationAddOnOptions) {
        const addOns =
          addOnOptionsByRegistrationOptionId.get(
            addOnOption.registrationOptionId,
          ) ?? [];
        addOns.push(addOnOption);
        addOnOptionsByRegistrationOptionId.set(
          addOnOption.registrationOptionId,
          addOns,
        );
      }
      const now = yield* registrationHandlerNow.pipe(Effect.orDie);
      const paymentDeadlineNow = yield* registrationPaymentDeadlineNow;

      const registrationSummaries = currentlyOwnedRegistrations.map(
        (registration) => {
          const registrationOption = registration.registrationOption;
          if (!registrationOption) {
            throw new Error(
              `Registration option missing for registration ${registration.id}`,
            );
          }
          const event = registration.event;
          if (!event) {
            throw new Error(
              `Event missing for registration ${registration.id}`,
            );
          }

          const paymentPending = registration.transactions.some(
            (transaction) =>
              transaction.status === 'pending' &&
              transaction.type === 'registration',
          );
          const priceSnapshot = readRegistrationPriceSnapshot({
            appliedDiscountedPrice: registration.appliedDiscountedPrice,
            appliedDiscountType: registration.appliedDiscountType,
            basePriceAtRegistration: registration.basePriceAtRegistration,
            discountAmount: registration.discountAmount,
            paymentPending,
            registrationId: registration.id,
            status: registration.status,
          });

          const activeTransfer =
            activeTransferByRegistrationId.get(registration.id) ?? null;
          const pendingOrder = registration.addonPurchaseOrders[0];
          const purchaseByAddOnId = new Map(
            registration.addonPurchases.map((purchase) => [
              purchase.addonId,
              purchase,
            ]),
          );
          const registrationAddOns = (
            addOnOptionsByRegistrationOptionId.get(
              registration.registrationOptionId,
            ) ?? []
          ).flatMap((addOnOption) => {
            const event = registration.event;
            if (!event) return [];
            const purchase = purchaseByAddOnId.get(addOnOption.addOnId);
            const matchingPendingOrder =
              pendingOrder?.addonId === addOnOption.addOnId
                ? pendingOrder
                : undefined;
            const pendingQuantity = matchingPendingOrder?.quantity ?? 0;
            const settledPurchasedQuantity = purchase?.purchasedQuantity ?? 0;
            const taxConfigured =
              addOnOption.stripeTaxRateId === null ||
              (addOnOption.nextPurchaseTaxRateInclusive !== null &&
                addOnOption.nextPurchaseTaxRatePercentage !== null);
            const hasPaidPrice = addOnOption.nextPurchaseUnitPrice > 0;
            const paymentConfigured =
              addOnOption.isPaid === hasPaidPrice &&
              (!hasPaidPrice || tenant.stripeAccountId !== null);
            const availability = registrationAddonPurchaseAvailability({
              activeTransfer: activeTransfer !== null,
              allowMultiple: addOnOption.allowMultiple,
              allowPurchaseBeforeEvent: addOnOption.allowPurchaseBeforeEvent,
              allowPurchaseDuringEvent: addOnOption.allowPurchaseDuringEvent,
              eventEnd: event.end,
              eventStart: event.start,
              eventStatus: event.status,
              maxQuantityPerUser: addOnOption.maxQuantityPerUser,
              now,
              optionalPurchaseQuantity: addOnOption.optionalPurchaseQuantity,
              paymentConfigured,
              pendingOptionalQuantity: pendingQuantity,
              pendingOrder: pendingOrder !== undefined,
              purchasedOptionalQuantity: settledPurchasedQuantity,
              registrationStatus: registration.status,
              stockAvailableQuantity: addOnOption.stockAvailableQuantity,
              taxConfigured,
            });
            const nextPurchaseUnitAmounts = taxConfigured
              ? resolveAddonTaxAmounts({
                  baseAmount: addOnOption.nextPurchaseUnitPrice,
                  taxRateInclusive: addOnOption.nextPurchaseTaxRateInclusive,
                  taxRatePercentage: addOnOption.nextPurchaseTaxRatePercentage,
                })
              : undefined;
            const redeemedQuantity = purchase?.redeemedQuantity ?? 0;
            const cancelledQuantity = purchase?.cancelledQuantity ?? 0;
            const totalQuantity = purchase?.quantity ?? 0;

            return [
              {
                addOnId: addOnOption.addOnId,
                allowMultiple: addOnOption.allowMultiple,
                allowPurchaseBeforeEvent: addOnOption.allowPurchaseBeforeEvent,
                allowPurchaseDuringEvent: addOnOption.allowPurchaseDuringEvent,
                cancelledQuantity,
                currency: tenant.currency,
                description: addOnOption.description,
                includedQuantity: purchase?.includedQuantity ?? 0,
                isPaid: addOnOption.isPaid,
                maxQuantityPerUser: addOnOption.maxQuantityPerUser,
                nextPurchaseTaxRateDisplayName:
                  addOnOption.nextPurchaseTaxRateDisplayName,
                nextPurchaseTaxRateInclusive:
                  addOnOption.nextPurchaseTaxRateInclusive,
                nextPurchaseTaxRatePercentage:
                  addOnOption.nextPurchaseTaxRatePercentage,
                nextPurchaseUnitGrossAmount:
                  nextPurchaseUnitAmounts?.expectedGrossAmount ?? null,
                nextPurchaseUnitPrice: addOnOption.nextPurchaseUnitPrice,
                nextPurchaseUnitTaxAmount:
                  nextPurchaseUnitAmounts?.taxAmount ?? null,
                optionalPurchaseQuantity: addOnOption.optionalPurchaseQuantity,
                pendingCheckoutExpired: registrationAddonCheckoutExpired(
                  matchingPendingOrder?.expiresAt,
                  paymentDeadlineNow,
                ),
                pendingCheckoutExpiresAt:
                  matchingPendingOrder?.expiresAt?.toISOString() ?? null,
                pendingCheckoutUrl:
                  matchingPendingOrder?.transaction?.stripeCheckoutUrl ?? null,
                pendingOperationKey: matchingPendingOrder?.operationKey ?? null,
                pendingQuantity,
                redeemedQuantity,
                remainingQuantity: Math.max(
                  0,
                  totalQuantity - redeemedQuantity - cancelledQuantity,
                ),
                settledPurchasedQuantity,
                title: addOnOption.title,
                totalAvailableQuantity: addOnOption.stockAvailableQuantity,
                totalQuantity,
                ...availability,
              },
            ];
          });
          const transferBlockedReason = registrationTransferBlockedReason({
            activeTransfer: activeTransfer !== null,
            eventStart: registration.event?.start ?? null,
            eventStatus: registration.event?.status ?? null,
            hasPendingAddonOrder: pendingOrder !== undefined,
            now,
            registrationStatus: registration.status,
            transferDeadlineHoursBeforeStart:
              registrationOption.transferDeadlineHoursBeforeStart ??
              tenant.transferDeadlineHoursBeforeStart ??
              0,
          });
          const cancellationAvailability = registrationCancellationAvailability(
            {
              checkInTime: registration.checkInTime,
              deadlineHoursBeforeStart:
                resolveCancellationDeadlineHoursBeforeStart(
                  registrationOption.cancellationDeadlineHoursBeforeStart,
                  tenant.cancellationDeadlineHoursBeforeStart,
                ),
              eventStart: event.start,
              now,
            },
          );

          return {
            activeTransfer,
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
            ...priceSnapshot,
            ...cancellationAvailability,
            checkoutUrl: registration.transactions.find(
              (transaction) =>
                transaction.method === 'stripe' &&
                transaction.type === 'registration',
            )?.stripeCheckoutUrl,
            guestCount: registration.guestCount,
            id: registration.id,
            organizingRegistration: registrationOption.organizingRegistration,
            paymentPending,
            registeredDescription: registrationOption.registeredDescription,
            registrationAddOns,
            registrationOptionId: registration.registrationOptionId,
            registrationOptionTitle: registrationOption.title,
            status: registration.status,
            transferAvailable: transferBlockedReason === 'none',
            transferBlockedReason,
          };
        },
      );

      return {
        isRegistered: currentlyOwnedRegistrations.length > 0,
        outgoingTransfers,
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
        tenant: { id: tenant.id },
        user: {
          id: user.id,
          roleIds: user.roleIds,
        },
      });
    }),
  'events.purchaseRegistrationAddon': (
    { addOnId, operationKey, quantity, registrationId },
    _options,
  ) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const result = yield* purchaseRegistrationAddon({
        addonId: addOnId,
        operationKey,
        quantity,
        registrationId,
        tenantId: tenant.id,
        userId: user.id,
      });
      return result.status === 'completed'
        ? result
        : {
            checkoutUrl: result.checkoutUrl,
            expiresAt: result.expiresAt.toISOString(),
            orderId: result.orderId,
            status: 'checkoutRequired' as const,
          };
    }).pipe(
      Effect.tapError((error) =>
        error instanceof EventRegistrationInternalError &&
        error.cause !== undefined
          ? Effect.logError(
              'Post-registration add-on purchase failed internally',
            ).pipe(Effect.annotateLogs({ cause: error.cause }))
          : Effect.void,
      ),
      Effect.mapError((error) =>
        error instanceof EventRegistrationInternalError
          ? withoutRegistrationInternalErrorCause(error)
          : error,
      ),
    ),
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
          currency: tenant.currency,
          domain: tenant.domain,
          emailSenderEmail: tenant.emailSenderEmail,
          emailSenderName: tenant.emailSenderName,
          id: tenant.id,
          maxActiveRegistrationsPerUser: tenant.maxActiveRegistrationsPerUser,
          name: tenant.name,
          stripeAccountId: tenant.stripeAccountId,
        },
        user: {
          communicationEmail: user.communicationEmail,
          email: user.email,
          id: user.id,
          roleIds: user.roleIds,
        },
      });
    }).pipe(Effect.catch(mapRegistrationMutationInternalError)),
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
            basePriceAtRegistration: true,
            checkedInGuestCount: true,
            checkInTime: true,
            discountAmount: true,
            eventId: true,
            guestCount: true,
            status: true,
            userId: true,
          },
          where: { id: registrationId, tenantId: tenant.id },
          with: {
            event: {
              columns: {
                end: true,
                start: true,
                title: true,
              },
            },
            registrationOption: {
              columns: {
                title: true,
              },
            },
            transactions: {
              columns: {
                status: true,
                type: true,
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
            message:
              'Ticket not found. Check the QR code or ask an organizer for help.',
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
      const timingIssue = eventCheckInTimingIssue({
        end: registration.event.end,
        now,
        start: registration.event.start,
      });
      const isAllowCheckin =
        !isRegistrationStatusIssue &&
        !isSameUserIssue &&
        timingIssue === null &&
        !isAlreadyCheckedInIssue;
      const priceSnapshot = readRegistrationPriceSnapshot({
        appliedDiscountedPrice: registration.appliedDiscountedPrice,
        appliedDiscountType: registration.appliedDiscountType,
        basePriceAtRegistration: registration.basePriceAtRegistration,
        discountAmount: registration.discountAmount,
        paymentPending: registration.transactions.some(
          (transaction) =>
            transaction.status === 'pending' &&
            transaction.type === 'registration',
        ),
        registrationId,
        status: registration.status,
      });

      return {
        allowCheckin: isAllowCheckin,
        alreadyCheckedInIssue: isAlreadyCheckedInIssue,
        appliedDiscountType: priceSnapshot.appliedDiscountType,
        attendeeCheckedIn: registration.checkInTime !== null,
        checkedInGuestCount: registration.checkedInGuestCount,
        checkInTimingIssue: timingIssue,
        event: {
          start: registration.event.start.toISOString(),
          title: registration.event.title,
        },
        guestCount: registration.guestCount,
        registrationOption: {
          title: registration.registrationOption.title,
        },
        registrationStatus: registration.status,
        registrationStatusIssue: isRegistrationStatusIssue,
        remainingGuestCount,
        sameUserIssue: isSameUserIssue,
        user: {
          firstName: registration.user.firstName,
          lastName: registration.user.lastName,
        },
      };
    }).pipe(Effect.catch(mapRegistrationScanInternalError)),
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
