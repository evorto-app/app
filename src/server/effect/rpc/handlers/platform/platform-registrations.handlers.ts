import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { type PlatformAuditSnapshot } from '@shared/platform-audit';
import { registrationSpotCount } from '@shared/registration-spots';
import { activeRegistrationTransferStatuses } from '@shared/registration-transfer';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  type PlatformRegistrationDetailRecord,
  type PlatformRegistrationsApproveInput,
  type PlatformRegistrationsCancelInput,
  type PlatformRegistrationsCheckInInput,
} from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { Effect, Option, Schema } from 'effect';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitionRefundAllocations,
  registrationAcquisitions,
  registrationTransfers,
  tenants,
  transactions,
  users,
} from '../../../../../db/schema';
import { getServerNow } from '../../../../clock';
import { serverClockConfig } from '../../../../config/server-config';
import { allocateAcquisitionComponentQuantity } from '../../../../registrations/registration-acquisition-refund';
import {
  ensureRegistrationMutationHasNoActiveTransfer,
  RegistrationTransferMutationConflict,
} from '../../../../registrations/registration-transfer-mutation-guard';
import {
  EventRegistrationService,
  type ManualRegistrationApprovalTransition,
} from '../events/event-registration.service';
import {
  cancelRegistrationForTenant,
  type RegistrationCancellationTransition,
} from '../events/events-registration.handlers';
import { PlatformOperationContext } from '../shared/platform-operation-context';
import {
  providePlatformOperation,
  resolvePlatformMutation,
  resolvePlatformRead,
  writePlatformAudit,
} from '../shared/platform-operation.service';

const CHECK_IN_PRE_START_WINDOW_MS = 60 * 60 * 1000;

type DatabaseReader = Pick<DatabaseClient, 'select'>;

const PlatformRegistrationAuditState = Schema.Struct({
  attendeeCheckedIn: Schema.Boolean,
  attendeeId: Schema.NonEmptyString,
  checkedInGuestCount: Schema.Number,
  checkInTime: Schema.NullOr(Schema.NonEmptyString),
  eventId: Schema.NonEmptyString,
  guestCount: Schema.Number,
  id: Schema.NonEmptyString,
  remainingGuestCount: Schema.Number,
  status: Schema.Literals(['CANCELLED', 'CONFIRMED', 'PENDING', 'WAITLIST']),
});

const PlatformRegistrationTransitionAuditState = Schema.Struct({
  checkInTime: Schema.NullOr(Schema.NonEmptyString),
  eventId: Schema.NonEmptyString,
  guestCount: Schema.Number,
  id: Schema.NonEmptyString,
  paymentTransactionId: Schema.NullOr(Schema.NonEmptyString),
  paymentTransactionStatus: Schema.NullOr(Schema.Literal('pending')),
  refundTransactionId: Schema.NullOr(Schema.NonEmptyString),
  refundTransactionStatus: Schema.NullOr(Schema.Literal('pending')),
  registrationOptionId: Schema.NonEmptyString,
  status: Schema.Literals(['CANCELLED', 'CONFIRMED', 'PENDING', 'WAITLIST']),
  userId: Schema.NonEmptyString,
});

const databaseEffect = <A, R>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, R>,
): Effect.Effect<A, RpcBadRequestError, Database | R> =>
  Database.use((database) =>
    operation(database).pipe(
      Effect.catch((error) =>
        error instanceof RpcBadRequestError
          ? Effect.fail(error)
          : Effect.die(error),
      ),
    ),
  );

const registrationNotFound = (registrationId: string) =>
  new RpcBadRequestError({
    message: `Registration ${registrationId} was not found for the target tenant`,
    reason: 'registrationNotFound',
  });

export const platformRegistrationActiveTransferError = (
  _conflict: RegistrationTransferMutationConflict,
) =>
  new RpcBadRequestError({
    message:
      'Finish or cancel the active transfer before checking in this registration.',
    reason: 'registrationTransferActive',
  });

const ensurePlatformRegistrationMutationHasNoActiveTransfer = (
  database: Pick<DatabaseClient, 'select'>,
  input: { registrationId: string; tenantId: string },
) =>
  ensureRegistrationMutationHasNoActiveTransfer(database, input).pipe(
    Effect.catch((error) =>
      error instanceof RegistrationTransferMutationConflict
        ? Effect.fail(platformRegistrationActiveTransferError(error))
        : Effect.die(error),
    ),
  );

const mapPlatformRegistrationMutationError = (error: unknown) => {
  if (error instanceof RpcBadRequestError) {
    return Effect.fail(error);
  }
  if (error instanceof EventRegistrationNotFoundError) {
    return Effect.fail(
      new RpcBadRequestError({
        message: error.message,
        reason: 'registrationNotFound',
      }),
    );
  }
  if (error instanceof EventRegistrationConflictError) {
    return Effect.fail(
      new RpcBadRequestError({
        message: error.message,
        reason: 'registrationStateConflict',
      }),
    );
  }
  if (error instanceof EventRegistrationInternalError) {
    return Effect.die(error);
  }
  return Effect.die(error);
};

const platformRegistrationTransitionSnapshot = (input: {
  checkInTime: null | string;
  eventId: string;
  guestCount: number;
  paymentTransactionId: null | string;
  paymentTransactionStatus: 'pending' | null;
  refundTransactionId: null | string;
  refundTransactionStatus: 'pending' | null;
  registrationId: string;
  registrationOptionId: string;
  status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
  userId: string;
}): PlatformAuditSnapshot => ({
  resourceId: input.registrationId,
  resourceType: 'registration',
  state: Schema.decodeUnknownSync(PlatformRegistrationTransitionAuditState)({
    checkInTime: input.checkInTime,
    eventId: input.eventId,
    guestCount: input.guestCount,
    id: input.registrationId,
    paymentTransactionId: input.paymentTransactionId,
    paymentTransactionStatus: input.paymentTransactionStatus,
    refundTransactionId: input.refundTransactionId,
    refundTransactionStatus: input.refundTransactionStatus,
    registrationOptionId: input.registrationOptionId,
    status: input.status,
    userId: input.userId,
  }),
});

export const platformRegistrationApprovalAuditSnapshots = (
  transition: ManualRegistrationApprovalTransition,
) => ({
  after: platformRegistrationTransitionSnapshot({
    checkInTime: null,
    eventId: transition.eventId,
    guestCount: transition.guestCount,
    paymentTransactionId: transition.transactionId,
    paymentTransactionStatus: transition.transactionStatus,
    refundTransactionId: null,
    refundTransactionStatus: null,
    registrationId: transition.registrationId,
    registrationOptionId: transition.registrationOptionId,
    status: transition.statusAfter,
    userId: transition.userId,
  }),
  before: platformRegistrationTransitionSnapshot({
    checkInTime: null,
    eventId: transition.eventId,
    guestCount: transition.guestCount,
    paymentTransactionId: null,
    paymentTransactionStatus: null,
    refundTransactionId: null,
    refundTransactionStatus: null,
    registrationId: transition.registrationId,
    registrationOptionId: transition.registrationOptionId,
    status: transition.statusBefore,
    userId: transition.userId,
  }),
});

export const platformRegistrationCancellationAuditSnapshots = (
  transition: RegistrationCancellationTransition,
) => ({
  after: platformRegistrationTransitionSnapshot({
    checkInTime: transition.checkInTime?.toISOString() ?? null,
    eventId: transition.eventId,
    guestCount: transition.guestCount,
    paymentTransactionId: null,
    paymentTransactionStatus: null,
    refundTransactionId: transition.refundTransactionId,
    refundTransactionStatus: transition.refundTransactionStatus,
    registrationId: transition.registrationId,
    registrationOptionId: transition.registrationOptionId,
    status: transition.statusAfter,
    userId: transition.userId,
  }),
  before: platformRegistrationTransitionSnapshot({
    checkInTime: transition.checkInTime?.toISOString() ?? null,
    eventId: transition.eventId,
    guestCount: transition.guestCount,
    paymentTransactionId: null,
    paymentTransactionStatus: null,
    refundTransactionId: null,
    refundTransactionStatus: null,
    registrationId: transition.registrationId,
    registrationOptionId: transition.registrationOptionId,
    status: transition.statusBefore,
    userId: transition.userId,
  }),
});

const platformRegistrationNow = serverClockConfig.pipe(
  Effect.orDie,
  Effect.map(({ E2E_NOW_ISO }) =>
    getServerNow(Option.getOrUndefined(E2E_NOW_ISO)).toJSDate(),
  ),
);

const isWithinCheckInWindow = (eventStart: Date, now: Date): boolean =>
  eventStart.getTime() - now.getTime() <= CHECK_IN_PRE_START_WINDOW_MS;

export const platformRegistrationCheckInPlan = ({
  checkedInGuestCount,
  checkInTime,
  guestCheckInCount,
  guestCount,
  status,
}: {
  checkedInGuestCount: number;
  checkInTime: Date | null;
  guestCheckInCount: number;
  guestCount: number;
  status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
}) => {
  if (status !== 'CONFIRMED') {
    return Effect.fail(
      new RpcBadRequestError({
        message: 'Only confirmed registrations can be checked in',
        reason: 'registrationStateConflict',
      }),
    );
  }
  const remainingGuestCount = Math.max(0, guestCount - checkedInGuestCount);
  if (guestCheckInCount > remainingGuestCount) {
    return Effect.fail(
      new RpcBadRequestError({
        message: 'Guest check-in count exceeds remaining guests',
        reason: 'guestCheckInCountExceeded',
      }),
    );
  }

  const alreadyCheckedInWithoutMoreGuests =
    checkInTime !== null &&
    (remainingGuestCount === 0 || guestCheckInCount === 0);
  return Effect.succeed({
    alreadyCheckedInWithoutMoreGuests,
    checkedInSpotCount: (checkInTime === null ? 1 : 0) + guestCheckInCount,
    remainingGuestCount,
  });
};

const platformRegistrationSelection = {
  attendeeEmail: users.email,
  attendeeFirstName: users.firstName,
  attendeeId: users.id,
  attendeeLastName: users.lastName,
  cancellationDeadlineHoursBeforeStart:
    eventRegistrationOptions.cancellationDeadlineHoursBeforeStart,
  checkedInGuestCount: eventRegistrations.checkedInGuestCount,
  checkInTime: eventRegistrations.checkInTime,
  eventId: eventInstances.id,
  eventStart: eventInstances.start,
  eventTitle: eventInstances.title,
  guestCount: eventRegistrations.guestCount,
  id: eventRegistrations.id,
  refundFeesOnCancellation: eventRegistrationOptions.refundFeesOnCancellation,
  registrationMode: eventRegistrationOptions.registrationMode,
  registrationOptionTitle: eventRegistrationOptions.title,
  status: eventRegistrations.status,
} as const;

const registrationBaseQuery = (database: DatabaseReader) =>
  database
    .select(platformRegistrationSelection)
    .from(eventRegistrations)
    .innerJoin(
      eventInstances,
      eq(eventInstances.id, eventRegistrations.eventId),
    )
    .innerJoin(
      eventRegistrationOptions,
      and(
        eq(
          eventRegistrationOptions.id,
          eventRegistrations.registrationOptionId,
        ),
        eq(eventRegistrationOptions.eventId, eventInstances.id),
      ),
    )
    .innerJoin(users, eq(users.id, eventRegistrations.userId));

const normalizeRegistrationListRecord = (
  registration: Effect.Success<
    ReturnType<typeof registrationBaseQuery>
  >[number],
) => ({
  attendee: {
    email: registration.attendeeEmail,
    firstName: registration.attendeeFirstName,
    id: registration.attendeeId,
    lastName: registration.attendeeLastName,
  },
  checkInTime: registration.checkInTime?.toISOString() ?? null,
  event: {
    id: registration.eventId,
    start: registration.eventStart.toISOString(),
    title: registration.eventTitle,
  },
  id: registration.id,
  registrationOptionTitle: registration.registrationOptionTitle,
  status: registration.status,
});

export const platformRegistrationActiveTransferPredicate = (input: {
  readonly registrationId: string;
  readonly tenantId: string;
}) =>
  and(
    eq(registrationTransfers.tenantId, input.tenantId),
    or(
      and(
        eq(registrationTransfers.sourceRegistrationId, input.registrationId),
        inArray(registrationTransfers.status, [
          ...activeRegistrationTransferStatuses,
        ]),
      ),
      and(
        eq(registrationTransfers.recipientRegistrationId, input.registrationId),
        eq(registrationTransfers.status, 'checkout_pending'),
      ),
    ),
  );

export const platformRegistrationCancellationBlockedReason = (input: {
  readonly activeTransfer: boolean;
  readonly checkInTime: Date | null;
  readonly eventStart: Date;
  readonly now: Date;
  readonly pendingAddonPayment: boolean;
  readonly pendingStripePayment: null | {
    readonly stripeAccountId: null | string;
    readonly stripeCheckoutSessionId: null | string;
  };
  readonly refundBlockedReason: null | string;
  readonly status: PlatformRegistrationDetailRecord['status'];
}): null | string => {
  if (input.status === 'CANCELLED') {
    return 'Registration is already cancelled.';
  }
  if (input.checkInTime) return 'Checked-in registrations cannot be cancelled.';
  if (input.eventStart <= input.now) return 'The event has already started.';
  if (input.activeTransfer) {
    return 'Resolve the active registration transfer before cancelling this registration.';
  }
  if (input.pendingStripePayment?.stripeCheckoutSessionId === null) {
    return 'Payment setup is still being reconciled. Resume approval before cancelling.';
  }
  if (
    input.pendingStripePayment &&
    !input.pendingStripePayment.stripeAccountId
  ) {
    return 'The pending payment is missing its Stripe account and cannot be cancelled safely.';
  }
  if (input.pendingAddonPayment) {
    return 'An add-on payment is still in progress. Finish or let that checkout expire before cancelling.';
  }
  return input.refundBlockedReason;
};

type CancellationRefundPreview =
  PlatformRegistrationDetailRecord['cancellation']['refund'];

interface PlatformRegistrationCancellationRefundPreview {
  readonly blockedReason: null | string;
  readonly refund: CancellationRefundPreview;
}
type RefundPreviewAcquisition = Pick<
  typeof registrationAcquisitions.$inferSelect,
  'eventId' | 'ownerUserId' | 'spotCount'
>;
type RefundPreviewAllocation = Pick<
  typeof registrationAcquisitionRefundAllocations.$inferSelect,
  'componentId' | 'quantity'
>;
type RefundPreviewComponent = Pick<
  typeof registrationAcquisitionComponents.$inferSelect,
  | 'acquisitionPaymentId'
  | 'applicationFeeAmount'
  | 'currency'
  | 'grossAmount'
  | 'id'
  | 'kind'
  | 'netAmount'
  | 'purchaseId'
  | 'purchaseLotId'
  | 'quantity'
  | 'stripeFeeAmount'
>;
type RefundPreviewLot = Pick<
  typeof eventRegistrationAddonPurchaseLots.$inferSelect,
  'cancelledQuantity' | 'id' | 'purchaseId' | 'quantity' | 'redeemedQuantity'
>;
type RefundPreviewPayment = Pick<
  typeof registrationAcquisitionPayments.$inferSelect,
  'id' | 'transactionId'
>;
type RefundPreviewPurchase = Pick<
  typeof eventRegistrationAddonPurchases.$inferSelect,
  | 'cancelledQuantity'
  | 'id'
  | 'includedQuantity'
  | 'purchasedQuantity'
  | 'redeemedQuantity'
>;

type RefundPreviewTransaction = Pick<
  typeof transactions.$inferSelect,
  | 'amount'
  | 'appFee'
  | 'currency'
  | 'eventId'
  | 'id'
  | 'method'
  | 'status'
  | 'stripeAccountId'
  | 'stripeChargeId'
  | 'stripeFee'
  | 'stripeNetAmount'
  | 'stripePaymentIntentId'
  | 'targetUserId'
  | 'type'
>;

const refundPreviewUnavailable = (
  refundFeesOnCancellation: boolean,
): PlatformRegistrationCancellationRefundPreview => ({
  blockedReason:
    "The current attendee's refundable payment could not be verified. Reconcile the registration payment before cancelling.",
  refund: {
    amount: null,
    feesIncluded: refundFeesOnCancellation,
    method: null,
    required: false,
  },
});

const refundPreviewNotRequired = (
  refundFeesOnCancellation: boolean,
): PlatformRegistrationCancellationRefundPreview => ({
  blockedReason: null,
  refund: {
    amount: null,
    feesIncluded: refundFeesOnCancellation,
    method: null,
    required: false,
  },
});

/**
 * Mirrors the monetary part of cancellation without mutating fulfillment.
 * Historical transactions are intentionally accepted as input, but only
 * sources owned by the current acquisition epoch can contribute a refund.
 */
export const platformRegistrationCancellationRefundPreview = (input: {
  readonly acquisition: RefundPreviewAcquisition;
  readonly allocations: readonly RefundPreviewAllocation[];
  readonly components: readonly RefundPreviewComponent[];
  readonly eventId: string;
  readonly expectedSpotCount: number;
  readonly lots: readonly RefundPreviewLot[];
  readonly ownerUserId: string;
  readonly payments: readonly RefundPreviewPayment[];
  readonly purchases: readonly RefundPreviewPurchase[];
  readonly refundFeesOnCancellation: boolean;
  readonly transactions: readonly RefundPreviewTransaction[];
}): PlatformRegistrationCancellationRefundPreview => {
  const noRefund = refundPreviewNotRequired(input.refundFeesOnCancellation);
  if (
    input.acquisition.ownerUserId !== input.ownerUserId ||
    input.acquisition.eventId !== input.eventId ||
    input.acquisition.spotCount !== input.expectedSpotCount
  ) {
    return refundPreviewUnavailable(input.refundFeesOnCancellation);
  }

  const purchaseById = new Map(
    input.purchases.map((purchase) => [purchase.id, purchase]),
  );
  if (
    input.lots.some((lot) => !purchaseById.has(lot.purchaseId)) ||
    input.purchases.some((purchase) => {
      const lots = input.lots.filter(
        ({ purchaseId }) => purchaseId === purchase.id,
      );
      const lotQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
      const purchasedConsumed = lots.reduce(
        (sum, lot) => sum + lot.redeemedQuantity + lot.cancelledQuantity,
        0,
      );
      const includedConsumed =
        purchase.redeemedQuantity +
        purchase.cancelledQuantity -
        purchasedConsumed;
      return (
        lotQuantity !== purchase.purchasedQuantity ||
        includedConsumed < 0 ||
        includedConsumed > purchase.includedQuantity
      );
    })
  ) {
    return refundPreviewUnavailable(input.refundFeesOnCancellation);
  }

  const registrationComponents = input.components.filter(
    ({ kind }) => kind === 'registration',
  );
  const addonComponents = input.components.filter(
    ({ kind }) => kind === 'addon_lot',
  );
  const lotById = new Map(input.lots.map((lot) => [lot.id, lot]));
  if (
    registrationComponents.length !== 1 ||
    registrationComponents[0]?.quantity !== input.expectedSpotCount ||
    addonComponents.length !== input.lots.length ||
    addonComponents.some((component) => {
      const lot = component.purchaseLotId
        ? lotById.get(component.purchaseLotId)
        : undefined;
      return (
        !lot ||
        component.purchaseId !== lot.purchaseId ||
        component.quantity !== lot.quantity
      );
    })
  ) {
    return refundPreviewUnavailable(input.refundFeesOnCancellation);
  }

  const transactionById = new Map(
    input.transactions.map((transaction) => [transaction.id, transaction]),
  );
  const paymentIds = new Set(input.payments.map(({ id }) => id));
  if (
    paymentIds.size !== input.payments.length ||
    input.payments.some((payment) => {
      const source = transactionById.get(payment.transactionId);
      const components = input.components.filter(
        ({ acquisitionPaymentId }) => acquisitionPaymentId === payment.id,
      );
      return (
        !source ||
        components.length === 0 ||
        source.amount <= 0 ||
        source.appFee === null ||
        source.eventId !== input.eventId ||
        source.method !== 'stripe' ||
        source.status !== 'successful' ||
        !source.stripeAccountId ||
        (!source.stripeChargeId && !source.stripePaymentIntentId) ||
        source.stripeFee === null ||
        source.stripeNetAmount === null ||
        source.targetUserId !== input.ownerUserId ||
        (source.type !== 'registration' && source.type !== 'addon') ||
        components.some(({ currency }) => currency !== source.currency) ||
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
        components.reduce((sum, component) => sum + component.netAmount, 0) !==
          source.stripeNetAmount
      );
    })
  ) {
    return refundPreviewUnavailable(input.refundFeesOnCancellation);
  }

  const allocatedQuantityByComponent = new Map<string, number>();
  for (const allocation of input.allocations) {
    allocatedQuantityByComponent.set(
      allocation.componentId,
      (allocatedQuantityByComponent.get(allocation.componentId) ?? 0) +
        allocation.quantity,
    );
  }

  let refundAmount = 0;
  for (const component of input.components) {
    const paymentId = component.acquisitionPaymentId;
    const amountsAreValid =
      Number.isSafeInteger(component.grossAmount) &&
      component.grossAmount >= 0 &&
      component.netAmount >= 0 &&
      component.stripeFeeAmount >= 0 &&
      component.applicationFeeAmount >= 0 &&
      component.netAmount +
        component.stripeFeeAmount +
        component.applicationFeeAmount ===
        component.grossAmount;
    if (
      !amountsAreValid ||
      (component.grossAmount > 0
        ? !paymentId || !paymentIds.has(paymentId)
        : paymentId !== null)
    ) {
      return refundPreviewUnavailable(input.refundFeesOnCancellation);
    }
    if (component.grossAmount === 0) continue;
    if (!paymentId) {
      return refundPreviewUnavailable(input.refundFeesOnCancellation);
    }
    let alreadyAllocatedQuantity = 0;
    let quantity = component.quantity;
    if (component.kind === 'registration') {
      if ((allocatedQuantityByComponent.get(component.id) ?? 0) !== 0) {
        return refundPreviewUnavailable(input.refundFeesOnCancellation);
      }
    } else {
      const lot = component.purchaseLotId
        ? lotById.get(component.purchaseLotId)
        : undefined;
      if (!lot) {
        return refundPreviewUnavailable(input.refundFeesOnCancellation);
      }
      alreadyAllocatedQuantity = lot.cancelledQuantity + lot.redeemedQuantity;
      quantity = Math.max(0, lot.quantity - alreadyAllocatedQuantity);
      if (
        (allocatedQuantityByComponent.get(component.id) ?? 0) >
        lot.cancelledQuantity
      ) {
        return refundPreviewUnavailable(input.refundFeesOnCancellation);
      }
    }
    if (quantity === 0) continue;
    const amounts = allocateAcquisitionComponentQuantity({
      alreadyAllocatedQuantity,
      component,
      quantity,
    });
    if (!amounts) {
      return refundPreviewUnavailable(input.refundFeesOnCancellation);
    }
    refundAmount += input.refundFeesOnCancellation
      ? amounts.grossAmount
      : amounts.netAmount;
  }

  return refundAmount > 0
    ? {
        blockedReason: null,
        refund: {
          amount: refundAmount,
          feesIncluded: input.refundFeesOnCancellation,
          method: 'stripe',
          required: true,
        },
      }
    : noRefund;
};

const loadPlatformRegistrationCancellationRefundPreview = Effect.fn(
  'PlatformRegistrations.loadCancellationRefundPreview',
)(function* (
  database: DatabaseReader,
  input: {
    readonly eventId: string;
    readonly guestCount: number;
    readonly ownerUserId: string;
    readonly refundFeesOnCancellation: boolean;
    readonly registrationId: string;
    readonly status: PlatformRegistrationDetailRecord['status'];
    readonly targetTenantId: string;
    readonly transactions: readonly RefundPreviewTransaction[];
  },
) {
  if (input.status !== 'CONFIRMED') {
    return refundPreviewNotRequired(input.refundFeesOnCancellation);
  }
  const acquisitions = yield* database
    .select()
    .from(registrationAcquisitions)
    .where(
      and(
        eq(registrationAcquisitions.tenantId, input.targetTenantId),
        eq(registrationAcquisitions.registrationId, input.registrationId),
      ),
    )
    .orderBy(desc(registrationAcquisitions.ordinal))
    .limit(1)
    .pipe(Effect.orDie);
  const acquisition = acquisitions[0] ?? null;
  if (!acquisition) {
    return refundPreviewUnavailable(input.refundFeesOnCancellation);
  }

  const payments = yield* database
    .select()
    .from(registrationAcquisitionPayments)
    .where(
      and(
        eq(registrationAcquisitionPayments.acquisitionId, acquisition.id),
        eq(registrationAcquisitionPayments.tenantId, input.targetTenantId),
        eq(
          registrationAcquisitionPayments.registrationId,
          input.registrationId,
        ),
      ),
    )
    .pipe(Effect.orDie);
  const components = yield* database
    .select()
    .from(registrationAcquisitionComponents)
    .where(
      and(
        eq(registrationAcquisitionComponents.acquisitionId, acquisition.id),
        eq(registrationAcquisitionComponents.tenantId, input.targetTenantId),
        eq(
          registrationAcquisitionComponents.registrationId,
          input.registrationId,
        ),
      ),
    )
    .pipe(Effect.orDie);
  const lots = yield* database
    .select()
    .from(eventRegistrationAddonPurchaseLots)
    .where(
      and(
        eq(eventRegistrationAddonPurchaseLots.tenantId, input.targetTenantId),
        eq(
          eventRegistrationAddonPurchaseLots.registrationId,
          input.registrationId,
        ),
      ),
    )
    .pipe(Effect.orDie);
  const purchases = yield* database
    .select()
    .from(eventRegistrationAddonPurchases)
    .where(
      and(
        eq(eventRegistrationAddonPurchases.tenantId, input.targetTenantId),
        eq(
          eventRegistrationAddonPurchases.registrationId,
          input.registrationId,
        ),
        eq(eventRegistrationAddonPurchases.eventId, input.eventId),
      ),
    )
    .pipe(Effect.orDie);
  const allocations = yield* database
    .select({
      componentId: registrationAcquisitionRefundAllocations.componentId,
      quantity: registrationAcquisitionRefundAllocations.quantity,
    })
    .from(registrationAcquisitionRefundAllocations)
    .where(
      and(
        eq(
          registrationAcquisitionRefundAllocations.acquisitionId,
          acquisition.id,
        ),
        eq(
          registrationAcquisitionRefundAllocations.tenantId,
          input.targetTenantId,
        ),
        eq(
          registrationAcquisitionRefundAllocations.registrationId,
          input.registrationId,
        ),
      ),
    )
    .pipe(Effect.orDie);
  return platformRegistrationCancellationRefundPreview({
    acquisition,
    allocations,
    components,
    eventId: input.eventId,
    expectedSpotCount: registrationSpotCount(input.guestCount),
    lots,
    ownerUserId: input.ownerUserId,
    payments,
    purchases,
    refundFeesOnCancellation: input.refundFeesOnCancellation,
    transactions: input.transactions,
  });
});

export const loadPlatformRegistrationDetail = Effect.fn(
  'PlatformRegistrations.loadPlatformRegistrationDetail',
)(function* (
  database: DatabaseReader,
  targetTenantId: string,
  registrationId: string,
) {
  const registrations = yield* registrationBaseQuery(database)
    .where(
      and(
        eq(eventRegistrations.id, registrationId),
        eq(eventRegistrations.tenantId, targetTenantId),
        eq(eventInstances.tenantId, targetTenantId),
      ),
    )
    .limit(1)
    .pipe(Effect.orDie);
  const registration = registrations[0];
  if (!registration) {
    return yield* Effect.fail(registrationNotFound(registrationId));
  }

  const now = yield* platformRegistrationNow;
  const tenantPolicies = yield* database
    .select({
      cancellationDeadlineHoursBeforeStart:
        tenants.cancellationDeadlineHoursBeforeStart,
      currency: tenants.currency,
      refundFeesOnCancellation: tenants.refundFeesOnCancellation,
    })
    .from(tenants)
    .where(eq(tenants.id, targetTenantId))
    .limit(1)
    .pipe(Effect.orDie);
  const tenantPolicy = tenantPolicies[0];
  if (!tenantPolicy) {
    return yield* Effect.fail(
      new RpcBadRequestError({
        message: 'Target tenant cancellation policy was not found',
        reason: 'targetTenantNotFound',
      }),
    );
  }
  const registrationTransactions = yield* database
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
        eq(transactions.tenantId, targetTenantId),
        eq(transactions.eventRegistrationId, registrationId),
        inArray(transactions.type, ['addon', 'registration']),
      ),
    )
    .pipe(Effect.orDie);
  const activeTransfers = yield* database
    .select({ id: registrationTransfers.id })
    .from(registrationTransfers)
    .where(
      platformRegistrationActiveTransferPredicate({
        registrationId,
        tenantId: targetTenantId,
      }),
    )
    .limit(1)
    .pipe(Effect.orDie);
  const activeTransfer = activeTransfers.length > 0;
  const remainingGuestCount = Math.max(
    0,
    registration.guestCount - registration.checkedInGuestCount,
  );
  const attendeeCheckedIn = registration.checkInTime !== null;
  const registrationStatusIssue = registration.status !== 'CONFIRMED';
  const checkInTimingIssue = !isWithinCheckInWindow(
    registration.eventStart,
    now,
  );
  const alreadyFullyCheckedIn = attendeeCheckedIn && remainingGuestCount === 0;
  const cancellationDeadlineHoursBeforeStart =
    registration.cancellationDeadlineHoursBeforeStart ??
    tenantPolicy.cancellationDeadlineHoursBeforeStart;
  const cancellationDeadline = new Date(
    registration.eventStart.getTime() -
      cancellationDeadlineHoursBeforeStart * 60 * 60 * 1000,
  );
  const cancellationDeadlinePassed = now >= cancellationDeadline;
  const refundFeesOnCancellation =
    registration.refundFeesOnCancellation ??
    tenantPolicy.refundFeesOnCancellation;
  const refundPreview =
    yield* loadPlatformRegistrationCancellationRefundPreview(database, {
      eventId: registration.eventId,
      guestCount: registration.guestCount,
      ownerUserId: registration.attendeeId,
      refundFeesOnCancellation,
      registrationId,
      status: registration.status,
      targetTenantId,
      transactions: registrationTransactions,
    });
  const pendingPayment = registrationTransactions.find(
    (transaction) =>
      transaction.status === 'pending' && transaction.type === 'registration',
  );
  const pendingStripePayment = registrationTransactions.find(
    (transaction) =>
      transaction.status === 'pending' &&
      transaction.method === 'stripe' &&
      transaction.type === 'registration',
  );
  const pendingAddonPayment = registrationTransactions.find(
    (transaction) =>
      transaction.status === 'pending' &&
      transaction.method === 'stripe' &&
      transaction.type === 'addon',
  );
  const cancellationBlockedReason =
    platformRegistrationCancellationBlockedReason({
      activeTransfer,
      checkInTime: registration.checkInTime,
      eventStart: registration.eventStart,
      now,
      pendingAddonPayment: pendingAddonPayment !== undefined,
      pendingStripePayment: pendingStripePayment ?? null,
      refundBlockedReason: refundPreview.blockedReason,
      status: registration.status,
    });

  return {
    ...normalizeRegistrationListRecord(registration),
    allowCheckIn:
      !registrationStatusIssue && !checkInTimingIssue && !alreadyFullyCheckedIn,
    attendeeCheckedIn,
    cancellation: {
      available: cancellationBlockedReason === null,
      blockedReason: cancellationBlockedReason,
      deadline: cancellationDeadline.toISOString(),
      deadlinePassed: cancellationDeadlinePassed,
      refund: refundPreview.refund,
    },
    checkedInGuestCount: registration.checkedInGuestCount,
    checkInTimingIssue,
    currency: tenantPolicy.currency,
    guestCount: registration.guestCount,
    manualApprovalAvailable:
      registration.status === 'PENDING' &&
      registration.registrationMode === 'application' &&
      (!pendingPayment || pendingPayment.stripeCheckoutSessionId === null),
    paymentPending: pendingPayment !== undefined,
    registrationMode: registration.registrationMode,
    registrationStatusIssue,
    remainingGuestCount,
  } satisfies PlatformRegistrationDetailRecord;
});

export const platformRegistrationAuditSnapshot = (
  registration: PlatformRegistrationDetailRecord,
): PlatformAuditSnapshot => ({
  resourceId: registration.id,
  resourceType: 'registration',
  state: Schema.decodeUnknownSync(PlatformRegistrationAuditState)({
    attendeeCheckedIn: registration.attendeeCheckedIn,
    attendeeId: registration.attendee.id,
    checkedInGuestCount: registration.checkedInGuestCount,
    checkInTime: registration.checkInTime,
    eventId: registration.event.id,
    guestCount: registration.guestCount,
    id: registration.id,
    remainingGuestCount: registration.remainingGuestCount,
    status: registration.status,
  }),
});

export const platformRegistrationHandlers = {
  'platform.registrations.approve': (
    input: PlatformRegistrationsApproveInput,
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformMutation(input);
      return yield* providePlatformOperation(
        Effect.gen(function* () {
          const platformOperationContext = yield* PlatformOperationContext;
          yield* EventRegistrationService.approveManualRegistration({
            executiveUserId: null,
            onApproved: (transaction, transition) => {
              const snapshots =
                platformRegistrationApprovalAuditSnapshots(transition);
              return writePlatformAudit(transaction, {
                action: 'registration.approve',
                after: snapshots.after,
                before: snapshots.before,
              }).pipe(
                Effect.provideService(
                  PlatformOperationContext,
                  platformOperationContext,
                ),
              );
            },
            registrationId: input.registrationId,
            targetTenant: operation.targetTenant,
          });

          return yield* databaseEffect((database) =>
            loadPlatformRegistrationDetail(
              database,
              input.targetTenantId,
              input.registrationId,
            ),
          );
        }).pipe(Effect.catch(mapPlatformRegistrationMutationError)),
        operation,
        ['events:organizeAll'],
      );
    }),
  'platform.registrations.cancel': (
    input: PlatformRegistrationsCancelInput,
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformMutation(input);
      return yield* providePlatformOperation(
        Effect.gen(function* () {
          const platformOperationContext = yield* PlatformOperationContext;
          yield* cancelRegistrationForTenant({
            cancelledBy: 'platformAdministrator',
            enforceParticipantDeadline: false,
            executiveUserId: null,
            onCancelled: (transaction, transition) => {
              const snapshots =
                platformRegistrationCancellationAuditSnapshots(transition);
              return writePlatformAudit(transaction, {
                action: 'registration.cancel',
                after: snapshots.after,
                before: snapshots.before,
              }).pipe(
                Effect.provideService(
                  PlatformOperationContext,
                  platformOperationContext,
                ),
              );
            },
            registrationId: input.registrationId,
            targetTenant: operation.targetTenant,
          });

          return yield* databaseEffect((database) =>
            loadPlatformRegistrationDetail(
              database,
              input.targetTenantId,
              input.registrationId,
            ),
          );
        }).pipe(Effect.catch(mapPlatformRegistrationMutationError)),
        operation,
        ['events:organizeAll'],
      );
    }),
  'platform.registrations.checkIn': (
    input: PlatformRegistrationsCheckInInput,
    _options: unknown,
  ) => {
    if (
      !Number.isInteger(input.guestCheckInCount) ||
      input.guestCheckInCount < 0
    ) {
      return Effect.fail(
        new RpcBadRequestError({
          message: 'Guest check-in count must be a non-negative integer',
          reason: 'invalidGuestCheckInCount',
        }),
      );
    }

    return Effect.gen(function* () {
      const operation = yield* resolvePlatformMutation(input);
      return yield* providePlatformOperation(
        databaseEffect((database) =>
          Effect.gen(function* () {
            yield* ensurePlatformRegistrationMutationHasNoActiveTransfer(
              database,
              {
                registrationId: input.registrationId,
                tenantId: input.targetTenantId,
              },
            );
            return yield* database.transaction((transaction) =>
              Effect.gen(function* () {
                const lockedRegistrations = yield* transaction
                  .select({
                    checkedInGuestCount: eventRegistrations.checkedInGuestCount,
                    checkInTime: eventRegistrations.checkInTime,
                    eventId: eventRegistrations.eventId,
                    guestCount: eventRegistrations.guestCount,
                    id: eventRegistrations.id,
                    registrationOptionId:
                      eventRegistrations.registrationOptionId,
                    status: eventRegistrations.status,
                  })
                  .from(eventRegistrations)
                  .where(
                    and(
                      eq(eventRegistrations.id, input.registrationId),
                      eq(eventRegistrations.tenantId, input.targetTenantId),
                    ),
                  )
                  .for('update')
                  .pipe(Effect.orDie);
                const lockedRegistration = lockedRegistrations[0];
                if (!lockedRegistration) {
                  return yield* Effect.fail(
                    registrationNotFound(input.registrationId),
                  );
                }

                yield* ensurePlatformRegistrationMutationHasNoActiveTransfer(
                  transaction,
                  {
                    registrationId: lockedRegistration.id,
                    tenantId: input.targetTenantId,
                  },
                );

                const before = yield* loadPlatformRegistrationDetail(
                  transaction,
                  input.targetTenantId,
                  input.registrationId,
                );
                const checkInPlan = yield* platformRegistrationCheckInPlan({
                  checkedInGuestCount: lockedRegistration.checkedInGuestCount,
                  checkInTime: lockedRegistration.checkInTime,
                  guestCheckInCount: input.guestCheckInCount,
                  guestCount: lockedRegistration.guestCount,
                  status: lockedRegistration.status,
                });

                const now = yield* platformRegistrationNow;
                if (!isWithinCheckInWindow(new Date(before.event.start), now)) {
                  return yield* Effect.fail(
                    new RpcBadRequestError({
                      message: 'Check-in is not open for this event yet',
                      reason: 'checkInNotOpen',
                    }),
                  );
                }

                if (!checkInPlan.alreadyCheckedInWithoutMoreGuests) {
                  const updatedRegistrations = yield* transaction
                    .update(eventRegistrations)
                    .set({
                      ...(!lockedRegistration.checkInTime && {
                        checkInTime: now,
                      }),
                      checkedInGuestCount: sql`${eventRegistrations.checkedInGuestCount} + ${input.guestCheckInCount}`,
                    })
                    .where(
                      and(
                        eq(eventRegistrations.id, input.registrationId),
                        eq(eventRegistrations.tenantId, input.targetTenantId),
                        eq(eventRegistrations.status, 'CONFIRMED'),
                        lockedRegistration.checkInTime
                          ? sql`${eventRegistrations.checkedInGuestCount} + ${input.guestCheckInCount} <= ${eventRegistrations.guestCount}`
                          : isNull(eventRegistrations.checkInTime),
                      ),
                    )
                    .returning({ id: eventRegistrations.id })
                    .pipe(Effect.orDie);
                  if (updatedRegistrations.length === 0) {
                    return yield* Effect.fail(
                      new RpcBadRequestError({
                        message: 'Registration check-in preconditions changed',
                        reason: 'registrationStateConflict',
                      }),
                    );
                  }

                  const targetEventExists = transaction
                    .select({ id: eventInstances.id })
                    .from(eventInstances)
                    .where(
                      and(
                        eq(eventInstances.id, lockedRegistration.eventId),
                        eq(eventInstances.tenantId, input.targetTenantId),
                      ),
                    );
                  const updatedOptions = yield* transaction
                    .update(eventRegistrationOptions)
                    .set({
                      checkedInSpots: sql`${eventRegistrationOptions.checkedInSpots} + ${checkInPlan.checkedInSpotCount}`,
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
                        exists(targetEventExists),
                      ),
                    )
                    .returning({ id: eventRegistrationOptions.id })
                    .pipe(Effect.orDie);
                  if (updatedOptions.length === 0) {
                    return yield* Effect.die(
                      new Error(
                        'Registration option was missing during platform check-in',
                      ),
                    );
                  }
                }

                const after = yield* loadPlatformRegistrationDetail(
                  transaction,
                  input.targetTenantId,
                  input.registrationId,
                );
                yield* writePlatformAudit(transaction, {
                  action: 'registration.checkIn',
                  after: platformRegistrationAuditSnapshot(after),
                  before: platformRegistrationAuditSnapshot(before),
                });
                return after;
              }),
            );
          }),
        ),
        operation,
        ['events:organizeAll'],
      );
    });
  },
  'platform.registrations.findOne': (
    input: { registrationId: string; targetTenantId: string },
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      return yield* providePlatformOperation(
        databaseEffect((database) =>
          loadPlatformRegistrationDetail(
            database,
            input.targetTenantId,
            input.registrationId,
          ),
        ),
        operation,
        [],
      );
    }),
  'platform.registrations.list': (
    input: {
      eventId?: string | undefined;
      limit: number;
      offset: number;
      targetTenantId: string;
    },
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      return yield* providePlatformOperation(
        databaseEffect((database) =>
          registrationBaseQuery(database)
            .where(
              and(
                eq(eventRegistrations.tenantId, input.targetTenantId),
                eq(eventInstances.tenantId, input.targetTenantId),
                ...(input.eventId
                  ? [eq(eventRegistrations.eventId, input.eventId)]
                  : []),
              ),
            )
            .orderBy(
              desc(eventInstances.start),
              asc(users.lastName),
              asc(users.firstName),
            )
            .limit(input.limit)
            .offset(input.offset)
            .pipe(
              Effect.map((registrations) =>
                registrations.map((registration) =>
                  normalizeRegistrationListRecord(registration),
                ),
              ),
            ),
        ),
        operation,
        [],
      );
    }),
};
