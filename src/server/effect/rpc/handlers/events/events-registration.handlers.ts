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
  activeRegistrationTransferStatuses,
  isActiveRegistrationTransferStatus,
} from '@shared/registration-transfer';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  type EventsCancellableRegistrationStatus,
  type EventsRegistrationStatusRecord,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';
import { resolveTenantDiscountProviders } from '@shared/tenant-config';
import {
  and,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  not,
  notExists,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
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
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrations,
  registrationAcquisitionRefundAllocations,
  registrationTransferRefundPlanItems,
  registrationTransfers,
  rolesToTenantUsers,
  tenants,
  tenantStripeTaxRates,
  transactions,
  userDiscountCards,
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
import { organizerDirectTransferPreviewVersion } from '../../../../registrations/organizer-direct-transfer-preview';
import { allocateAcquisitionComponentQuantity } from '../../../../registrations/registration-acquisition-refund';
import {
  establishRegistrationAcquisition,
  lockCurrentRegistrationAcquisition,
  RegistrationAcquisitionWriteError,
  settleAcquisitionComponentTerms,
} from '../../../../registrations/registration-acquisition-write';
import {
  ensureRegistrationMutationHasNoActiveTransfer,
  RegistrationTransferMutationConflict,
} from '../../../../registrations/registration-transfer-mutation-guard';
import {
  registrationTransferTotalPrice,
  resolveRegistrationTransferPrice,
} from '../../../../registrations/registration-transfer-pricing';
import { resolveRegistrationTransferRefundLifecycle } from '../../../../registrations/registration-transfer-refund-lifecycle';
import { resolveRegistrationTransferDeadline } from '../../../../registrations/registration-transfer-state';
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
              message: 'Internal server error',
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

const privateRegistrationTransferRequiredMessage =
  'This registration bundle cannot be reassigned directly. Create a private transfer offer so the recipient claim can apply current pricing and source refunds atomically.';

const directTransferPreviewStatePart = (value: object): string =>
  JSON.stringify(value) ?? 'null';

const directTransferPreviewResult = <Preview>(
  preview: Preview,
): { readonly _tag: 'Preview'; readonly preview: Preview } => ({
  _tag: 'Preview',
  preview,
});

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
      'Registration status or payment state changed after confirmation, so nothing was cancelled, no refund was created, and no spots or inventory were released. Refresh, review the current registration, then confirm again.',
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
              reason: `Registration cancelled by ${cancelledBy}`,
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

type EventRegistrationTransferMode =
  | {
      readonly _tag: 'OrganizerCommit';
      readonly eventId: string;
      readonly previewVersion: string;
    }
  | { readonly _tag: 'OrganizerPreview'; readonly eventId: string }
  | { readonly _tag: 'ParticipantCommit' };

const transferEventRegistration = Effect.fn('transferEventRegistration')(
  function* ({
    mode,
    registrationId,
    targetUserId,
  }: {
    mode: EventRegistrationTransferMode;
    registrationId: string;
    targetUserId: string;
  }) {
    const requireOrganizerAccess = mode._tag !== 'ParticipantCommit';
    const eventId =
      mode._tag === 'ParticipantCommit' ? undefined : mode.eventId;
    yield* RpcAccess.ensureAuthenticated();
    const { tenant } = yield* RpcAccess.current();
    const user = yield* RpcAccess.requireUser();
    const now = new Date();

    const registration = yield* databaseEffect((database) =>
      database.query.eventRegistrations.findFirst({
        columns: {
          eventId: true,
          guestCount: true,
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
          user: {
            columns: {
              communicationEmail: true,
              email: true,
              firstName: true,
              lastName: true,
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
          firstName: true,
          id: true,
          lastName: true,
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
            const lockedRegistrations = yield* tx
              .select({
                checkedInGuestCount: eventRegistrations.checkedInGuestCount,
                checkInTime: eventRegistrations.checkInTime,
                eventId: eventRegistrations.eventId,
                guestCount: eventRegistrations.guestCount,
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
            if (
              !lockedRegistration ||
              lockedRegistration.status !== 'CONFIRMED' ||
              (!requireOrganizerAccess && lockedRegistration.userId !== user.id)
            ) {
              return { _tag: 'RegistrationUnavailable' } as const;
            }
            if (
              lockedRegistration.eventId !== registration.eventId ||
              lockedRegistration.registrationOptionId !==
                registration.registrationOptionId ||
              lockedRegistration.userId !== registration.userId
            ) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'The registration changed before it could be transferred. Review it again.',
                }),
              );
            }
            const membershipUserIds = [
              lockedRegistration.userId,
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
            const lockedTargetMembership = lockedMemberships.find(
              (membership) => membership.userId === targetUserId,
            );
            if (!lockedTargetMembership) {
              return { _tag: 'TargetMembershipMissing' } as const;
            }
            const lockedTargetRoleAssignments = yield* tx
              .select({ roleId: rolesToTenantUsers.roleId })
              .from(rolesToTenantUsers)
              .where(
                and(
                  eq(rolesToTenantUsers.tenantId, tenant.id),
                  eq(
                    rolesToTenantUsers.userTenantId,
                    lockedTargetMembership.id,
                  ),
                ),
              )
              .orderBy(rolesToTenantUsers.roleId)
              .for('update');
            yield* ensureRegistrationMutationHasNoActiveTransfer(tx, {
              registrationId: registration.id,
              tenantId: tenant.id,
            }).pipe(Effect.catch(mapRegistrationTransferGuardError));
            const currentAcquisitionState =
              yield* lockCurrentRegistrationAcquisition(tx, {
                ownerUserId: lockedRegistration.userId,
                registrationId: registration.id,
                tenantId: tenant.id,
              }).pipe(
                Effect.catch((error) =>
                  mapRegistrationAcquisitionGuardError(
                    error,
                    'Registration acquisition ownership is inconsistent, so this registration was not transferred.',
                  ),
                ),
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

            const pendingAddonOrderCandidates = yield* tx
              .select({
                id: eventRegistrationAddonPurchaseOrders.id,
                transactionId:
                  eventRegistrationAddonPurchaseOrders.transactionId,
              })
              .from(eventRegistrationAddonPurchaseOrders)
              .where(
                and(
                  eq(
                    eventRegistrationAddonPurchaseOrders.registrationId,
                    registration.id,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseOrders.status,
                    'pending_payment',
                  ),
                  eq(eventRegistrationAddonPurchaseOrders.tenantId, tenant.id),
                ),
              )
              .limit(1);
            const pendingAddonOrder = pendingAddonOrderCandidates[0];
            if (pendingAddonOrder?.transactionId) {
              const pendingAddonTransactions = yield* tx
                .select({ id: transactions.id })
                .from(transactions)
                .where(
                  and(
                    eq(transactions.id, pendingAddonOrder.transactionId),
                    eq(transactions.eventRegistrationId, registration.id),
                    eq(transactions.method, 'stripe'),
                    eq(transactions.status, 'pending'),
                    eq(transactions.tenantId, tenant.id),
                    eq(transactions.type, 'addon'),
                  ),
                )
                .for('update');
              const lockedAddonOrders = yield* tx
                .select({ id: eventRegistrationAddonPurchaseOrders.id })
                .from(eventRegistrationAddonPurchaseOrders)
                .where(
                  and(
                    eq(
                      eventRegistrationAddonPurchaseOrders.id,
                      pendingAddonOrder.id,
                    ),
                    eq(
                      eventRegistrationAddonPurchaseOrders.status,
                      'pending_payment',
                    ),
                    eq(
                      eventRegistrationAddonPurchaseOrders.transactionId,
                      pendingAddonOrder.transactionId,
                    ),
                  ),
                )
                .for('update');
              if (
                pendingAddonTransactions.length !== 1 ||
                lockedAddonOrders.length !== 1
              ) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message:
                      'Pending add-on payment ownership changed before the registration transfer could start',
                  }),
                );
              }
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'Finish or let the pending add-on Checkout expire before transferring this registration.',
                }),
              );
            }

            const successfulPaidSourceTransactions =
              currentAcquisitionState.payments.length === 0
                ? []
                : yield* tx
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
                      stripeFee: transactions.stripeFee,
                      stripeNetAmount: transactions.stripeNetAmount,
                      stripePaymentIntentId: transactions.stripePaymentIntentId,
                      targetUserId: transactions.targetUserId,
                      type: transactions.type,
                    })
                    .from(transactions)
                    .where(
                      and(
                        eq(transactions.eventRegistrationId, registration.id),
                        eq(transactions.tenantId, tenant.id),
                        inArray(
                          transactions.id,
                          currentAcquisitionState.payments.map(
                            ({ transactionId }) => transactionId,
                          ),
                        ),
                      ),
                    )
                    .orderBy(transactions.id)
                    .for('update');
            const acquisitionPaymentByTransactionId = new Map(
              currentAcquisitionState.payments.map((payment) => [
                payment.transactionId,
                payment,
              ]),
            );
            const invalidAcquisitionPayment =
              successfulPaidSourceTransactions.length !==
                currentAcquisitionState.payments.length ||
              successfulPaidSourceTransactions.some((source) => {
                const acquisitionPayment =
                  acquisitionPaymentByTransactionId.get(source.id);
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
                  source.eventId !== registration.eventId ||
                  source.method !== 'stripe' ||
                  source.status !== 'successful' ||
                  !source.stripeAccountId ||
                  (!source.stripeChargeId && !source.stripePaymentIntentId) ||
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
              });
            if (invalidAcquisitionPayment) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'Registration acquisition payment ownership is inconsistent, so this registration was not transferred.',
                }),
              );
            }

            const sourceRefunds =
              successfulPaidSourceTransactions.length === 0
                ? []
                : yield* tx
                    .select({
                      amount: transactions.amount,
                      method: transactions.method,
                      sourceTransactionId: transactions.sourceTransactionId,
                      status: transactions.status,
                      stripeRefundStatus: transactions.stripeRefundStatus,
                    })
                    .from(transactions)
                    .where(
                      and(
                        eq(transactions.tenantId, tenant.id),
                        eq(transactions.type, 'refund'),
                        inArray(
                          transactions.sourceTransactionId,
                          successfulPaidSourceTransactions.map(({ id }) => id),
                        ),
                      ),
                    )
                    .orderBy(transactions.id)
                    .for('update');
            if (
              sourceRefunds.some(
                (refund) =>
                  refund.method !== 'stripe' ||
                  refund.status !== 'successful' ||
                  refund.stripeRefundStatus !== 'succeeded' ||
                  !refund.sourceTransactionId,
              )
            ) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'An earlier source refund is unresolved. Resolve it before creating a private transfer offer.',
                }),
              );
            }

            const refundedBySourceTransaction = new Map<string, number>();
            for (const refund of sourceRefunds) {
              if (!refund.sourceTransactionId || refund.amount >= 0) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message: 'Source refund history has an invalid amount',
                  }),
                );
              }
              refundedBySourceTransaction.set(
                refund.sourceTransactionId,
                (refundedBySourceTransaction.get(refund.sourceTransactionId) ??
                  0) - refund.amount,
              );
            }

            let sourceRefundAmountDue = 0;
            for (const payment of successfulPaidSourceTransactions) {
              const refundedAmount =
                refundedBySourceTransaction.get(payment.id) ?? 0;
              if (refundedAmount > payment.amount) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message: 'Source refunds exceed an original payment',
                  }),
                );
              }
              sourceRefundAmountDue += payment.amount - refundedAmount;
            }

            const lockedPricingRows = yield* tx
              .select({
                discountProviders: tenants.discountProviders,
                eventStart: eventInstances.start,
                eventStatus: eventInstances.status,
                optionPrice: eventRegistrationOptions.price,
                optionRoleIds: eventRegistrationOptions.roleIds,
                optionStripeTaxRateId: eventRegistrationOptions.stripeTaxRateId,
                optionTitle: eventRegistrationOptions.title,
                optionTransferDeadlineHoursBeforeStart:
                  eventRegistrationOptions.transferDeadlineHoursBeforeStart,
                stripeAccountId: tenants.stripeAccountId,
                tenantTransferDeadlineHoursBeforeStart:
                  tenants.transferDeadlineHoursBeforeStart,
              })
              .from(eventRegistrationOptions)
              .innerJoin(
                eventInstances,
                eq(eventInstances.id, eventRegistrationOptions.eventId),
              )
              .innerJoin(tenants, eq(tenants.id, eventInstances.tenantId))
              .where(
                and(
                  eq(
                    eventRegistrationOptions.id,
                    registration.registrationOptionId,
                  ),
                  eq(eventRegistrationOptions.eventId, registration.eventId),
                  eq(eventInstances.tenantId, tenant.id),
                ),
              )
              .for('update');
            const lockedPricing = lockedPricingRows[0];
            if (!lockedPricing) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message: 'Registration transfer pricing is unavailable',
                }),
              );
            }
            const lockedNow = new Date();
            if (lockedPricing.eventStatus !== 'APPROVED') {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message: 'Registration can no longer be transferred',
                }),
              );
            }
            yield* resolveRegistrationTransferDeadline({
              eventStart: lockedPricing.eventStart,
              now: lockedNow,
              optionHoursBeforeStart:
                lockedPricing.optionTransferDeadlineHoursBeforeStart,
              tenantHoursBeforeStart:
                lockedPricing.tenantTransferDeadlineHoursBeforeStart,
            }).pipe(
              Effect.mapError(
                (error) =>
                  new EventRegistrationConflictError({
                    message: error.message,
                  }),
              ),
            );
            const lockedTargetRoleIds = new Set(
              lockedTargetRoleAssignments.map(({ roleId }) => roleId),
            );
            if (
              lockedPricing.optionRoleIds.length > 0 &&
              lockedPricing.optionRoleIds.every(
                (roleId) => !lockedTargetRoleIds.has(roleId),
              )
            ) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'Target user is not eligible for this registration option',
                }),
              );
            }

            const lockedBundleAddOns = yield* tx
              .select({
                addonId: eventAddons.id,
                cancelledQuantity:
                  eventRegistrationAddonPurchases.cancelledQuantity,
                description: eventAddons.description,
                includedQuantity:
                  eventRegistrationAddonPurchases.includedQuantity,
                price: eventAddons.price,
                purchasedQuantity:
                  eventRegistrationAddonPurchases.purchasedQuantity,
                purchaseId: eventRegistrationAddonPurchases.id,
                quantity: eventRegistrationAddonPurchases.quantity,
                redeemedQuantity:
                  eventRegistrationAddonPurchases.redeemedQuantity,
                stripeTaxRateId: eventAddons.stripeTaxRateId,
                title: eventAddons.title,
                updatedAt: eventRegistrationAddonPurchases.updatedAt,
              })
              .from(eventRegistrationAddonPurchases)
              .innerJoin(
                eventAddons,
                and(
                  eq(eventAddons.id, eventRegistrationAddonPurchases.addonId),
                  eq(
                    eventAddons.eventId,
                    eventRegistrationAddonPurchases.eventId,
                  ),
                ),
              )
              .where(
                and(
                  eq(
                    eventRegistrationAddonPurchases.registrationId,
                    registration.id,
                  ),
                  eq(eventRegistrationAddonPurchases.tenantId, tenant.id),
                ),
              )
              .orderBy(eventRegistrationAddonPurchases.id)
              .for('update');
            const lockedBundleLots =
              lockedBundleAddOns.length === 0
                ? []
                : yield* tx
                    .select({
                      applicationFeeAmount:
                        eventRegistrationAddonPurchaseLots.applicationFeeAmount,
                      baseAmount: eventRegistrationAddonPurchaseLots.baseAmount,
                      cancelledQuantity:
                        eventRegistrationAddonPurchaseLots.cancelledQuantity,
                      currency: eventRegistrationAddonPurchaseLots.currency,
                      grossAmount:
                        eventRegistrationAddonPurchaseLots.grossAmount,
                      id: eventRegistrationAddonPurchaseLots.id,
                      netAmount: eventRegistrationAddonPurchaseLots.netAmount,
                      paymentAllocationFinalizedAt:
                        eventRegistrationAddonPurchaseLots.paymentAllocationFinalizedAt,
                      purchaseId: eventRegistrationAddonPurchaseLots.purchaseId,
                      quantity: eventRegistrationAddonPurchaseLots.quantity,
                      redeemedQuantity:
                        eventRegistrationAddonPurchaseLots.redeemedQuantity,
                      refundAllocatedApplicationFeeAmount:
                        eventRegistrationAddonPurchaseLots.refundAllocatedApplicationFeeAmount,
                      refundAllocatedGrossAmount:
                        eventRegistrationAddonPurchaseLots.refundAllocatedGrossAmount,
                      refundAllocatedNetAmount:
                        eventRegistrationAddonPurchaseLots.refundAllocatedNetAmount,
                      refundAllocatedQuantity:
                        eventRegistrationAddonPurchaseLots.refundAllocatedQuantity,
                      sourceTransactionId:
                        eventRegistrationAddonPurchaseLots.sourceTransactionId,
                      stripeFeeAmount:
                        eventRegistrationAddonPurchaseLots.stripeFeeAmount,
                      taxAmount: eventRegistrationAddonPurchaseLots.taxAmount,
                      taxRateDisplayName:
                        eventRegistrationAddonPurchaseLots.taxRateDisplayName,
                      taxRateInclusive:
                        eventRegistrationAddonPurchaseLots.taxRateInclusive,
                      taxRatePercentage:
                        eventRegistrationAddonPurchaseLots.taxRatePercentage,
                      unitPrice: eventRegistrationAddonPurchaseLots.unitPrice,
                      updatedAt: eventRegistrationAddonPurchaseLots.updatedAt,
                    })
                    .from(eventRegistrationAddonPurchaseLots)
                    .where(
                      and(
                        inArray(
                          eventRegistrationAddonPurchaseLots.purchaseId,
                          lockedBundleAddOns.map(
                            ({ purchaseId }) => purchaseId,
                          ),
                        ),
                        eq(
                          eventRegistrationAddonPurchaseLots.tenantId,
                          tenant.id,
                        ),
                      ),
                    )
                    .orderBy(eventRegistrationAddonPurchaseLots.id)
                    .for('update');
            const taxRateIds = [
              lockedPricing.optionStripeTaxRateId,
              ...lockedBundleAddOns.map(
                ({ stripeTaxRateId }) => stripeTaxRateId,
              ),
            ].filter((id): id is string => Boolean(id));
            const lockedTaxRates =
              taxRateIds.length === 0 || !lockedPricing.stripeAccountId
                ? []
                : yield* tx
                    .select({
                      displayName: tenantStripeTaxRates.displayName,
                      inclusive: tenantStripeTaxRates.inclusive,
                      percentage: tenantStripeTaxRates.percentage,
                      stripeTaxRateId: tenantStripeTaxRates.stripeTaxRateId,
                    })
                    .from(tenantStripeTaxRates)
                    .where(
                      and(
                        eq(tenantStripeTaxRates.tenantId, tenant.id),
                        eq(
                          tenantStripeTaxRates.stripeAccountId,
                          lockedPricing.stripeAccountId,
                        ),
                        eq(tenantStripeTaxRates.active, true),
                        eq(tenantStripeTaxRates.inclusive, true),
                        inArray(
                          tenantStripeTaxRates.stripeTaxRateId,
                          taxRateIds,
                        ),
                      ),
                    )
                    .for('update');
            const taxRateById = new Map(
              lockedTaxRates.map((taxRate) => [
                taxRate.stripeTaxRateId,
                taxRate,
              ]),
            );
            if (
              taxRateIds.some(
                (id) =>
                  !taxRateById.has(id) ||
                  taxRateById.get(id)?.percentage === null,
              )
            ) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'Registration transfer tax terms changed before ownership could be reassigned.',
                }),
              );
            }
            const currentRegistrationComponents =
              currentAcquisitionState.components.filter(
                ({ kind }) => kind === 'registration',
              );
            const currentAddonComponents =
              currentAcquisitionState.components.filter(
                ({ kind }) => kind === 'addon_lot',
              );
            const currentComponentByLotId = new Map(
              currentAddonComponents.flatMap((component) =>
                component.purchaseLotId
                  ? [[component.purchaseLotId, component] as const]
                  : [],
              ),
            );
            if (
              currentAcquisitionState.acquisition.eventId !==
                registration.eventId ||
              currentAcquisitionState.acquisition.spotCount !==
                registrationSpotCount(lockedRegistration.guestCount) ||
              currentRegistrationComponents.length !== 1 ||
              currentRegistrationComponents[0]?.quantity !==
                registrationSpotCount(lockedRegistration.guestCount) ||
              currentAddonComponents.length !== lockedBundleLots.length ||
              lockedBundleLots.some((lot) => {
                const component = currentComponentByLotId.get(lot.id);
                return (
                  lockedBundleAddOns.every(
                    ({ purchaseId }) => purchaseId !== lot.purchaseId,
                  ) ||
                  !component ||
                  component.purchaseId !== lot.purchaseId ||
                  component.quantity !== lot.quantity
                );
              })
            ) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'Registration acquisition components no longer match the transferred bundle.',
                }),
              );
            }
            const lockedDiscountCards = yield* tx
              .select({
                type: userDiscountCards.type,
                validTo: userDiscountCards.validTo,
              })
              .from(userDiscountCards)
              .where(
                and(
                  eq(userDiscountCards.status, 'verified'),
                  eq(userDiscountCards.tenantId, tenant.id),
                  eq(userDiscountCards.userId, targetUserId),
                ),
              )
              .for('update');
            const lockedDiscounts = yield* tx
              .select({
                discountedPrice:
                  eventRegistrationOptionDiscounts.discountedPrice,
                discountType: eventRegistrationOptionDiscounts.discountType,
              })
              .from(eventRegistrationOptionDiscounts)
              .where(
                eq(
                  eventRegistrationOptionDiscounts.registrationOptionId,
                  registration.registrationOptionId,
                ),
              )
              .for('update');
            const enabledDiscountTypes = new Set(
              Object.entries(
                resolveTenantDiscountProviders(lockedPricing.discountProviders),
              )
                .filter(([, provider]) => provider.status === 'enabled')
                .map(([discountType]) => discountType),
            );
            const recipientPrice = resolveRegistrationTransferPrice({
              basePrice: lockedPricing.optionPrice,
              cards: lockedDiscountCards,
              discounts: lockedDiscounts,
              enabledDiscountTypes,
              eventStart: lockedPricing.eventStart,
            });
            const recipientBundlePrice = registrationTransferTotalPrice({
              addOnTotal: lockedBundleAddOns.reduce(
                (total, addOn) => total + addOn.price * addOn.purchasedQuantity,
                0,
              ),
              effectivePrice: recipientPrice.effectivePrice,
              guestCount: lockedRegistration.guestCount,
              guestUnitPrice: lockedPricing.optionPrice,
            });
            if (sourceRefundAmountDue > 0 || recipientBundlePrice > 0) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message: privateRegistrationTransferRequiredMessage,
                }),
              );
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
                    sql`${eventInstances.start} > ${lockedNow}`,
                  ),
                )
                .limit(activeRegistrationLimit);
              if (activeFutureRegistrations.length >= activeRegistrationLimit) {
                return { _tag: 'TenantLimitReached' as const };
              }
            }

            const previewAddOns = lockedBundleAddOns.map((addOn) => ({
              cancelledQuantity: addOn.cancelledQuantity,
              currentUnitPrice: addOn.price,
              description: addOn.description,
              id: addOn.addonId,
              includedQuantity: addOn.includedQuantity,
              purchasedQuantity: addOn.purchasedQuantity,
              quantity: addOn.quantity,
              redeemedQuantity: addOn.redeemedQuantity,
              remainingQuantity: Math.max(
                0,
                addOn.quantity -
                  addOn.redeemedQuantity -
                  addOn.cancelledQuantity,
              ),
              title: addOn.title,
            }));
            const previewVersion = organizerDirectTransferPreviewVersion({
              acquisitionId: currentAcquisitionState.acquisition.id,
              addOns: lockedBundleAddOns.map((addOn) => ({
                addonId: addOn.addonId,
                cancelledQuantity: addOn.cancelledQuantity,
                currentUnitPrice: addOn.price,
                description: addOn.description,
                includedQuantity: addOn.includedQuantity,
                purchasedQuantity: addOn.purchasedQuantity,
                purchaseId: addOn.purchaseId,
                quantity: addOn.quantity,
                redeemedQuantity: addOn.redeemedQuantity,
                title: addOn.title,
              })),
              checkedInGuestCount: lockedRegistration.checkedInGuestCount,
              checkInTime: lockedRegistration.checkInTime,
              guestCount: lockedRegistration.guestCount,
              guestUnitPrice: lockedPricing.optionPrice,
              lockedState: {
                acquisition: directTransferPreviewStatePart(
                  currentAcquisitionState.acquisition,
                ),
                acquisitionComponents: currentAcquisitionState.components.map(
                  (component) => directTransferPreviewStatePart(component),
                ),
                acquisitionPayments: currentAcquisitionState.payments.map(
                  (payment) => directTransferPreviewStatePart(payment),
                ),
                addOnLots: lockedBundleLots.map((lot) =>
                  directTransferPreviewStatePart(lot),
                ),
                discountCards: lockedDiscountCards.map((card) =>
                  directTransferPreviewStatePart(card),
                ),
                discounts: lockedDiscounts.map((discount) =>
                  directTransferPreviewStatePart(discount),
                ),
                pricing: directTransferPreviewStatePart({
                  ...lockedPricing,
                  recipientPrice,
                }),
                sourceRefunds: sourceRefunds.map((refund) =>
                  directTransferPreviewStatePart(refund),
                ),
                sourceTransactions: successfulPaidSourceTransactions.map(
                  (transaction) => directTransferPreviewStatePart(transaction),
                ),
                targetRoleIds: lockedTargetRoleAssignments.map(
                  ({ roleId }) => roleId,
                ),
                taxRates: lockedTaxRates.map((taxRate) =>
                  directTransferPreviewStatePart(taxRate),
                ),
              },
              registrationId: registration.id,
              registrationOptionId: registration.registrationOptionId,
              registrationOptionTitle: lockedPricing.optionTitle,
              sourceUserId: lockedRegistration.userId,
              targetUserId,
            });

            if (mode._tag === 'OrganizerPreview') {
              if (!registration.user) {
                return yield* Effect.fail(
                  new EventRegistrationInternalError({
                    message: 'Registration owner relation missing',
                  }),
                );
              }
              return directTransferPreviewResult({
                bundle: {
                  addOns: previewAddOns,
                  checkedInGuestCount: lockedRegistration.checkedInGuestCount,
                  checkInTime:
                    lockedRegistration.checkInTime?.toISOString() ?? null,
                  guestCount: lockedRegistration.guestCount,
                  guestUnitPrice: lockedPricing.optionPrice,
                },
                completionMode: 'databaseOnly' as const,
                currency: tenant.currency,
                previewVersion,
                pricing: {
                  appliedDiscountedPrice: recipientPrice.appliedDiscountedPrice,
                  appliedDiscountType: recipientPrice.appliedDiscountType,
                  discountAmount: recipientPrice.discountAmount,
                  recipientBundlePrice: 0 as const,
                  recipientRegistrationPrice: recipientPrice.effectivePrice,
                  sourceRefundAmountDue: 0 as const,
                },
                recipient: {
                  email: targetUser.email,
                  firstName: targetUser.firstName,
                  id: targetUser.id,
                  lastName: targetUser.lastName,
                },
                registrationOption: {
                  currentPrice: lockedPricing.optionPrice,
                  id: registration.registrationOptionId,
                  title: lockedPricing.optionTitle,
                },
                source: {
                  email: registration.user.email,
                  firstName: registration.user.firstName,
                  id: lockedRegistration.userId,
                  lastName: registration.user.lastName,
                },
              });
            }

            if (
              mode._tag === 'OrganizerCommit' &&
              mode.previewVersion !== previewVersion
            ) {
              return yield* Effect.fail(
                new EventRegistrationConflictError({
                  message:
                    'The registration bundle changed after it was reviewed. Review the transfer again before confirming.',
                }),
              );
            }

            const registrationTaxRate = lockedPricing.optionStripeTaxRateId
              ? taxRateById.get(lockedPricing.optionStripeTaxRateId)
              : undefined;
            const directAcquisitionTerms = [
              {
                allocationKey: 'registration',
                baseAmount: 0,
                id: 'registration',
                kind: 'registration' as const,
                quantity: registrationSpotCount(lockedRegistration.guestCount),
                taxRateDisplayName: registrationTaxRate?.displayName ?? null,
                taxRateInclusive: registrationTaxRate?.inclusive ?? null,
                taxRatePercentage: registrationTaxRate?.percentage ?? null,
              },
              ...lockedBundleLots.flatMap((lot) => {
                const addOn = lockedBundleAddOns.find(
                  ({ purchaseId }) => purchaseId === lot.purchaseId,
                );
                if (!addOn) return [];
                const taxRate = addOn.stripeTaxRateId
                  ? taxRateById.get(addOn.stripeTaxRateId)
                  : undefined;
                return [
                  {
                    allocationKey: `addon-lot:${lot.id}`,
                    baseAmount: 0,
                    id: `addon-lot:${lot.id}`,
                    kind: 'addon_lot' as const,
                    purchaseId: lot.purchaseId,
                    purchaseLotId: lot.id,
                    quantity: lot.quantity,
                    taxRateDisplayName: taxRate?.displayName ?? null,
                    taxRateInclusive: taxRate?.inclusive ?? null,
                    taxRatePercentage: taxRate?.percentage ?? null,
                  },
                ];
              }),
            ];
            const settledDirectAcquisition = settleAcquisitionComponentTerms({
              terms: directAcquisitionTerms,
            });
            if (!settledDirectAcquisition) {
              return yield* Effect.fail(
                new EventRegistrationInternalError({
                  message:
                    'Recipient transfer acquisition terms could not be settled.',
                }),
              );
            }

            const targetRegistrations = alias(
              eventRegistrations,
              'target_registrations',
            );
            const transferredRegistrations = yield* tx
              .update(eventRegistrations)
              .set({
                appliedDiscountedPrice: recipientPrice.appliedDiscountedPrice,
                appliedDiscountType: recipientPrice.appliedDiscountType,
                basePriceAtRegistration: lockedPricing.optionPrice,
                discountAmount: recipientPrice.discountAmount,
                stripeTaxRateId: lockedPricing.optionStripeTaxRateId,
                taxRateDisplayName: registrationTaxRate?.displayName,
                taxRateInclusive: registrationTaxRate?.inclusive,
                taxRatePercentage: registrationTaxRate?.percentage,
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
            yield* establishRegistrationAcquisition(tx, {
              acquiredAt: new Date(),
              components: settledDirectAcquisition,
              currency: tenant.currency,
              eventId: registration.eventId,
              kind: 'direct_transfer',
              operationKey: `direct-registration-transfer:${currentAcquisitionState.acquisition.id}`,
              ownerUserId: targetUserId,
              registrationId: registration.id,
              spotCount: registrationSpotCount(lockedRegistration.guestCount),
              tenantId: tenant.id,
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new EventRegistrationInternalError({
                    cause,
                    message:
                      'Recipient acquisition could not be established after ownership transfer.',
                  }),
              ),
            );
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

    if (transferResult._tag === 'Preview') {
      return transferResult.preview;
    }
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
    return;
  },
);

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
            }).pipe(Effect.catch(mapRegistrationTransferGuardError));

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

      if (registration.event.start <= now) {
        return yield* Effect.fail(
          new EventRegistrationConflictError({
            message: 'Registration can no longer be transferred',
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

      const activeTransfers =
        registrations.length === 0
          ? []
          : yield* databaseEffect((database) =>
              database
                .select({
                  expiresAt: registrationTransfers.expiresAt,
                  ownershipTransferredAt:
                    registrationTransfers.ownershipTransferredAt,
                  sourceRegistrationId:
                    registrationTransfers.sourceRegistrationId,
                  status: registrationTransfers.status,
                  transferId: registrationTransfers.id,
                })
                .from(registrationTransfers)
                .where(
                  and(
                    inArray(
                      registrationTransfers.sourceRegistrationId,
                      registrations.map((registration) => registration.id),
                    ),
                    inArray(registrationTransfers.status, [
                      ...activeRegistrationTransferStatuses,
                    ]),
                    eq(registrationTransfers.tenantId, tenant.id),
                  ),
                ),
            );
      const activeTransferRefundRows =
        activeTransfers.length === 0
          ? []
          : yield* databaseEffect((database) =>
              database
                .select({
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
                      activeTransfers.map((transfer) => transfer.transferId),
                    ),
                    eq(registrationTransferRefundPlanItems.tenantId, tenant.id),
                    gt(registrationTransferRefundPlanItems.refundAmountDue, 0),
                  ),
                ),
            );
      const activeTransferRefunds = new Map<
        string,
        (typeof activeTransferRefundRows)[number]['refund'][]
      >();
      for (const row of activeTransferRefundRows) {
        const refunds = activeTransferRefunds.get(row.transferId) ?? [];
        refunds.push(row.refund);
        activeTransferRefunds.set(row.transferId, refunds);
      }
      const registrationIds = new Set(
        registrations.map((registration) => registration.id),
      );
      const activeTransferByRegistrationId = new Map<
        string,
        NonNullable<EventsRegistrationStatusRecord['activeTransfer']>
      >();
      for (const transfer of activeTransfers) {
        if (!isActiveRegistrationTransferStatus(transfer.status)) continue;
        const refundLifecycle = resolveRegistrationTransferRefundLifecycle({
          refunds: activeTransferRefunds.get(transfer.transferId) ?? [],
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

      const registrationSummaries = registrations.map((registration) => {
        const registrationOption = registration.registrationOption;
        if (!registrationOption) {
          throw new Error(
            `Registration option missing for registration ${registration.id}`,
          );
        }
        const event = registration.event;
        if (!event) {
          throw new Error(`Event missing for registration ${registration.id}`);
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
        const cancellationAvailability = registrationCancellationAvailability({
          checkInTime: registration.checkInTime,
          deadlineHoursBeforeStart: resolveCancellationDeadlineHoursBeforeStart(
            registrationOption.cancellationDeadlineHoursBeforeStart,
            tenant.cancellationDeadlineHoursBeforeStart,
          ),
          eventStart: event.start,
          now,
        });

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
          appliedDiscountedPrice: discountedPrice,
          appliedDiscountType,
          basePriceAtRegistration,
          ...cancellationAvailability,
          checkoutUrl: registration.transactions.find(
            (transaction) =>
              transaction.method === 'stripe' &&
              transaction.type === 'registration',
          )?.stripeCheckoutUrl,
          discountAmount,
          guestCount: registration.guestCount,
          id: registration.id,
          organizingRegistration: registrationOption.organizingRegistration,
          paymentPending: registration.transactions.some(
            (transaction) =>
              transaction.status === 'pending' &&
              transaction.type === 'registration',
          ),
          registeredDescription: registrationOption.registeredDescription,
          registrationAddOns,
          registrationOptionId: registration.registrationOptionId,
          registrationOptionTitle: registrationOption.title,
          status: registration.status,
          transferAvailable: transferBlockedReason === 'none',
          transferBlockedReason,
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
  'events.previewEventRegistrationTransfer': (
    { eventId, registrationId, targetUserId },
    _options,
  ) =>
    Effect.gen(function* () {
      const preview = yield* transferEventRegistration({
        mode: { _tag: 'OrganizerPreview', eventId },
        registrationId,
        targetUserId,
      });
      if (!preview) {
        return yield* Effect.fail(
          new EventRegistrationInternalError({
            message: 'Registration transfer preview was not produced',
          }),
        );
      }
      return preview;
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
  'events.transferEventRegistration': (
    { eventId, previewVersion, registrationId, targetUserId },
    _options,
  ) =>
    transferEventRegistration({
      mode: { _tag: 'OrganizerCommit', eventId, previewVersion },
      registrationId,
      targetUserId,
    }).pipe(Effect.asVoid),
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
        mode: { _tag: 'ParticipantCommit' },
        registrationId,
        targetUserId: targetUser.id,
      }).pipe(
        Effect.asVoid,
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
