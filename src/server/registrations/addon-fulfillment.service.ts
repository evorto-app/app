import type {
  EventsRegistrationAddonFulfillmentRecord,
  EventsRegistrationAddonRefundStatus,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { createId } from '@db/create-id';
import { Database, type DatabaseClient } from '@db/index';
import {
  eventAddons,
  eventRegistrationAddonFulfillmentAllocations,
  eventRegistrationAddonFulfillmentEvents,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  registrationAcquisitionComponents,
  registrationAcquisitionRefundAllocations,
  registrationAcquisitions,
  registrationTransfers,
  tenants,
  transactions,
} from '@db/schema';
import { activeRegistrationTransferStatuses } from '@shared/registration-transfer';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import { and, asc, desc, eq, inArray, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Effect } from 'effect';

import { createRegistrationRefundClaim } from '../payments/registration-refund';
import { allocateAcquisitionComponentQuantity } from './registration-acquisition-refund';
import { lockCurrentRegistrationAcquisition } from './registration-acquisition-write';
import { ensureRegistrationMutationHasNoActiveTransfer } from './registration-transfer-mutation-guard';

export interface RegistrationAddonCancellationAllocation {
  readonly fulfillmentEventId: string;
  readonly lot: typeof eventRegistrationAddonPurchaseLots.$inferSelect;
  readonly purchaseId: string;
  readonly quantity: number;
}

export interface RegistrationAddonCancellationSelection {
  readonly includedQuantity: number;
  readonly lots: readonly { readonly id: string; readonly quantity: number }[];
}

type RegistrationAddonRefundHistoryAllocation = Pick<
  typeof eventRegistrationAddonFulfillmentAllocations.$inferSelect,
  'fulfillmentEventId' | 'quantity' | 'source'
>;

type RegistrationAddonRefundHistoryClaim = Pick<
  typeof registrationAcquisitionRefundAllocations.$inferSelect,
  'fulfillmentEventId' | 'quantity'
> &
  Pick<
    typeof transactions.$inferSelect,
    | 'manuallyCreated'
    | 'method'
    | 'status'
    | 'stripeRefundAttempts'
    | 'stripeRefundClaimLeaseExpiresAt'
    | 'stripeRefundClaimLeaseId'
    | 'stripeRefundMaxAttempts'
    | 'stripeRefundNextAttemptAt'
    | 'stripeRefundStatus'
  >;

type RegistrationAddonRefundHistoryEvent = Pick<
  typeof eventRegistrationAddonFulfillmentEvents.$inferSelect,
  'id' | 'refundDisposition' | 'refundRequested' | 'type'
>;

interface RegistrationAddonRefundHistoryLot {
  readonly cancelledQuantity: number;
  readonly grossAmount: number;
  readonly quantity: number;
  readonly redeemedQuantity: number;
}

export const registrationAddonRefundClaimProgress = (
  refunds: readonly RegistrationAddonRefundHistoryClaim[],
): 'actionRequired' | 'failed' | 'pending' | null => {
  const failed = refunds.some(
    (refund) =>
      refund.status === 'cancelled' ||
      refund.stripeRefundStatus === 'failed' ||
      refund.stripeRefundStatus === 'canceled',
  );
  if (failed) return 'failed';

  const actionRequired = refunds.some(
    (refund) =>
      refund.method === 'stripe' &&
      !refund.manuallyCreated &&
      refund.status === 'pending' &&
      refund.stripeRefundStatus === 'requires_action',
  );
  if (actionRequired) return 'actionRequired';

  const stopped = refunds.some((refund) => {
    if (
      refund.method !== 'stripe' ||
      refund.manuallyCreated ||
      refund.status !== 'pending'
    ) {
      return false;
    }
    const leaseShapeValid =
      (refund.stripeRefundClaimLeaseId === null) ===
      (refund.stripeRefundClaimLeaseExpiresAt === null);
    const activeLease =
      refund.stripeRefundClaimLeaseId !== null &&
      refund.stripeRefundClaimLeaseExpiresAt !== null;
    return (
      !leaseShapeValid ||
      (!activeLease &&
        (refund.stripeRefundAttempts >= refund.stripeRefundMaxAttempts ||
          refund.stripeRefundNextAttemptAt === null))
    );
  });
  if (stopped) return 'failed';

  return refunds.some((refund) => refund.status === 'pending')
    ? 'pending'
    : null;
};

export const deriveRegistrationAddonRefundState = (input: {
  readonly allocations: readonly RegistrationAddonRefundHistoryAllocation[];
  readonly cancelledQuantity: number;
  readonly events: readonly RegistrationAddonRefundHistoryEvent[];
  readonly lots: readonly RegistrationAddonRefundHistoryLot[];
  readonly purchasedQuantity: number;
  readonly refunds: readonly RegistrationAddonRefundHistoryClaim[];
}): Pick<
  EventsRegistrationAddonFulfillmentRecord,
  'refundAvailability' | 'refundStatus'
> => {
  const purchasedCancelledQuantity = input.lots.reduce(
    (sum, lot) => sum + lot.cancelledQuantity,
    0,
  );
  const cancellablePurchasedLots = input.lots.filter(
    (lot) => lot.redeemedQuantity + lot.cancelledQuantity < lot.quantity,
  );
  const cancellablePurchasedQuantity = cancellablePurchasedLots.reduce(
    (sum, lot) =>
      sum + lot.quantity - lot.redeemedQuantity - lot.cancelledQuantity,
    0,
  );
  const monetaryRefundAvailable = cancellablePurchasedLots.some(
    (lot) => lot.grossAmount > 0,
  );
  const refundAvailability: EventsRegistrationAddonFulfillmentRecord['refundAvailability'] =
    cancellablePurchasedQuantity === 0
      ? 'none'
      : monetaryRefundAvailable
        ? 'monetaryRefundAvailable'
        : 'noMonetaryRefundRequired';

  if (input.purchasedQuantity === 0) {
    return {
      refundAvailability,
      refundStatus:
        input.cancelledQuantity > 0 ? 'notRequired' : 'notApplicable',
    };
  }

  const purchasedQuantityByEventId = new Map<string, number>();
  for (const allocation of input.allocations) {
    if (allocation.source !== 'purchased') continue;
    purchasedQuantityByEventId.set(
      allocation.fulfillmentEventId,
      (purchasedQuantityByEventId.get(allocation.fulfillmentEventId) ?? 0) +
        allocation.quantity,
    );
  }
  const purchasedCancellationEvents = input.events.flatMap((event) => {
    const quantity = purchasedQuantityByEventId.get(event.id) ?? 0;
    return event.type === 'cancelled' && quantity > 0
      ? [{ ...event, quantity }]
      : [];
  });
  const purchasedCancellationEventIds = new Set(
    purchasedCancellationEvents.map((event) => event.id),
  );
  const purchasedRefunds = input.refunds.filter((refund) =>
    refund.fulfillmentEventId
      ? purchasedCancellationEventIds.has(refund.fulfillmentEventId)
      : false,
  );
  const refundedQuantity = purchasedRefunds
    .filter(
      (refund) =>
        refund.status === 'successful' ||
        refund.stripeRefundStatus === 'succeeded',
    )
    .reduce((sum, refund) => sum + refund.quantity, 0);
  const claimProgress = registrationAddonRefundClaimProgress(purchasedRefunds);
  const cancellationWithoutRefundQuantity = purchasedCancellationEvents
    .filter((event) => !event.refundRequested)
    .reduce((sum, event) => sum + event.quantity, 0);
  const noMonetaryRefundRequiredQuantity = purchasedCancellationEvents
    .filter(
      (event) =>
        event.refundRequested &&
        event.refundDisposition === 'no_monetary_refund_required',
    )
    .reduce((sum, event) => sum + event.quantity, 0);
  const claimsRequestedQuantity = purchasedCancellationEvents
    .filter(
      (event) =>
        event.refundRequested && event.refundDisposition === 'claims_created',
    )
    .reduce((sum, event) => sum + event.quantity, 0);
  const allocatedPurchasedCancellationQuantity =
    cancellationWithoutRefundQuantity +
    noMonetaryRefundRequiredQuantity +
    claimsRequestedQuantity;

  let refundStatus: EventsRegistrationAddonRefundStatus = 'notRequested';
  if (claimProgress) refundStatus = claimProgress;
  else if (refundedQuantity > 0) {
    refundStatus =
      refundedQuantity >= purchasedCancelledQuantity
        ? 'refunded'
        : 'partiallyRefunded';
  } else if (purchasedCancelledQuantity > 0) {
    if (
      cancellationWithoutRefundQuantity > 0 ||
      allocatedPurchasedCancellationQuantity < purchasedCancelledQuantity
    ) {
      refundStatus = 'cancelledWithoutRefund';
    } else if (noMonetaryRefundRequiredQuantity >= purchasedCancelledQuantity) {
      refundStatus = 'notRequired';
    } else if (claimsRequestedQuantity > 0) {
      refundStatus = 'pending';
    }
  }

  return { refundAvailability, refundStatus };
};

export type RegistrationAddonFulfillmentActor =
  | { readonly kind: 'platform' | 'system'; readonly subject: string }
  | { readonly kind: 'user'; readonly userId: string };

interface FulfillmentIdentity {
  readonly actorUserId: string;
  readonly operationKey: string;
  readonly registrationAddonId: string;
  readonly registrationId: string;
  readonly tenantId: string;
}

export const selectRegistrationAddonCancellation = (input: {
  readonly cancelledQuantity: number;
  readonly includedQuantity: number;
  readonly lots: readonly {
    readonly cancelledQuantity: number;
    readonly id: string;
    readonly quantity: number;
    readonly redeemedQuantity: number;
  }[];
  readonly quantity: number;
  readonly redeemedQuantity: number;
}): RegistrationAddonCancellationSelection | undefined => {
  const purchasedConsumed = input.lots.reduce(
    (sum, lot) => sum + lot.redeemedQuantity + lot.cancelledQuantity,
    0,
  );
  const includedConsumed =
    input.redeemedQuantity + input.cancelledQuantity - purchasedConsumed;
  if (
    includedConsumed < 0 ||
    includedConsumed > input.includedQuantity ||
    !Number.isSafeInteger(input.quantity) ||
    input.quantity <= 0
  ) {
    return;
  }

  const lots: { id: string; quantity: number }[] = [];
  let remaining = input.quantity;
  for (const lot of input.lots) {
    const available = Math.max(
      0,
      lot.quantity - lot.redeemedQuantity - lot.cancelledQuantity,
    );
    const quantity = Math.min(available, remaining);
    if (quantity > 0) lots.push({ id: lot.id, quantity });
    remaining -= quantity;
    if (remaining === 0) break;
  }
  const includedAvailable = input.includedQuantity - includedConsumed;
  if (remaining > includedAvailable) return;
  return { includedQuantity: remaining, lots };
};

const conflict = (message: string) =>
  new EventRegistrationConflictError({ message });
const internal = (message: string, cause?: unknown) =>
  new EventRegistrationInternalError({
    ...(cause !== undefined && { cause }),
    message,
  });
const notFound = () =>
  new EventRegistrationNotFoundError({
    message: 'Registration add-on not found',
  });

const validateOperationKey = (operationKey: string) => {
  const normalized = operationKey.trim();
  return normalized.length > 0 && normalized.length <= 100
    ? Effect.succeed(normalized)
    : Effect.fail(
        conflict('Operation key must contain between 1 and 100 characters'),
      );
};

const mapUnexpected = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  message: string,
): Effect.Effect<A, E | EventRegistrationInternalError, R> =>
  effect.pipe(
    Effect.mapError((error) =>
      error instanceof EventRegistrationConflictError ||
      error instanceof EventRegistrationInternalError ||
      error instanceof EventRegistrationNotFoundError
        ? error
        : internal(message, error),
    ),
  );

export const getRegistrationAddonFulfillment = Effect.fn(
  'getRegistrationAddonFulfillment',
)(function* (input: {
  readonly canCancel: boolean;
  readonly registrationId: string;
  readonly tenantId: string;
}) {
  return yield* mapUnexpected(
    Database.use((database) =>
      database.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.setTransaction({
            accessMode: 'read only',
            isolationLevel: 'repeatable read',
          });
          const registrations = yield* tx
            .select({
              eventId: eventRegistrations.eventId,
              status: eventRegistrations.status,
              userId: eventRegistrations.userId,
            })
            .from(eventRegistrations)
            .where(
              and(
                eq(eventRegistrations.id, input.registrationId),
                eq(eventRegistrations.tenantId, input.tenantId),
              ),
            )
            .limit(1);
          const registration = registrations[0];
          if (!registration) return yield* notFound();
          const activeTransfers = yield* tx
            .select({ id: registrationTransfers.id })
            .from(registrationTransfers)
            .where(
              and(
                eq(registrationTransfers.tenantId, input.tenantId),
                or(
                  and(
                    eq(
                      registrationTransfers.sourceRegistrationId,
                      input.registrationId,
                    ),
                    inArray(
                      registrationTransfers.status,
                      activeRegistrationTransferStatuses,
                    ),
                  ),
                  and(
                    eq(
                      registrationTransfers.recipientRegistrationId,
                      input.registrationId,
                    ),
                    eq(registrationTransfers.status, 'checkout_pending'),
                  ),
                ),
              ),
            )
            .limit(1);
          if (activeTransfers.length > 0) {
            return yield* conflict(
              'This registration has an active transfer. Resolve or cancel the transfer before fulfilling add-ons.',
            );
          }

          const purchases = yield* tx
            .select({
              addonId: eventRegistrationAddonPurchases.addonId,
              cancelledQuantity:
                eventRegistrationAddonPurchases.cancelledQuantity,
              id: eventRegistrationAddonPurchases.id,
              includedQuantity:
                eventRegistrationAddonPurchases.includedQuantity,
              purchasedQuantity:
                eventRegistrationAddonPurchases.purchasedQuantity,
              quantity: eventRegistrationAddonPurchases.quantity,
              redeemedQuantity:
                eventRegistrationAddonPurchases.redeemedQuantity,
              title: eventAddons.title,
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
                  input.registrationId,
                ),
                eq(eventRegistrationAddonPurchases.tenantId, input.tenantId),
              ),
            )
            .orderBy(
              asc(eventAddons.title),
              asc(eventRegistrationAddonPurchases.id),
            );
          if (purchases.length === 0) {
            return { addOns: [], registrationId: input.registrationId };
          }
          const acquisitionRows = yield* tx
            .select({
              id: registrationAcquisitions.id,
              ownerUserId: registrationAcquisitions.ownerUserId,
            })
            .from(registrationAcquisitions)
            .where(
              and(
                eq(registrationAcquisitions.tenantId, input.tenantId),
                eq(
                  registrationAcquisitions.registrationId,
                  input.registrationId,
                ),
              ),
            )
            .orderBy(desc(registrationAcquisitions.ordinal))
            .limit(1);
          const acquisition = acquisitionRows[0];
          if (!acquisition || acquisition.ownerUserId !== registration.userId) {
            return yield* internal(
              'Current add-on acquisition ownership is missing',
            );
          }
          const purchaseIds = purchases.map(({ id }) => id);
          const [
            lots,
            fulfillmentAllocations,
            fulfillmentEvents,
            refundRows,
            acquisitionComponents,
          ] = yield* Effect.all([
            tx
              .select({
                cancelledQuantity:
                  eventRegistrationAddonPurchaseLots.cancelledQuantity,
                id: eventRegistrationAddonPurchaseLots.id,
                purchaseId: eventRegistrationAddonPurchaseLots.purchaseId,
                quantity: eventRegistrationAddonPurchaseLots.quantity,
                redeemedQuantity:
                  eventRegistrationAddonPurchaseLots.redeemedQuantity,
              })
              .from(eventRegistrationAddonPurchaseLots)
              .where(
                and(
                  inArray(
                    eventRegistrationAddonPurchaseLots.purchaseId,
                    purchaseIds,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseLots.tenantId,
                    input.tenantId,
                  ),
                ),
              ),
            tx
              .select({
                fulfillmentEventId:
                  eventRegistrationAddonFulfillmentAllocations.fulfillmentEventId,
                purchaseId:
                  eventRegistrationAddonFulfillmentAllocations.purchaseId,
                quantity: eventRegistrationAddonFulfillmentAllocations.quantity,
                source: eventRegistrationAddonFulfillmentAllocations.source,
              })
              .from(eventRegistrationAddonFulfillmentAllocations)
              .where(
                and(
                  inArray(
                    eventRegistrationAddonFulfillmentAllocations.purchaseId,
                    purchaseIds,
                  ),
                  eq(
                    eventRegistrationAddonFulfillmentAllocations.tenantId,
                    input.tenantId,
                  ),
                ),
              ),
            tx
              .select({
                createdAt: eventRegistrationAddonFulfillmentEvents.createdAt,
                id: eventRegistrationAddonFulfillmentEvents.id,
                purchaseId: eventRegistrationAddonFulfillmentEvents.purchaseId,
                refundDisposition:
                  eventRegistrationAddonFulfillmentEvents.refundDisposition,
                refundRequested:
                  eventRegistrationAddonFulfillmentEvents.refundRequested,
                reversesEventId:
                  eventRegistrationAddonFulfillmentEvents.reversesEventId,
                type: eventRegistrationAddonFulfillmentEvents.type,
              })
              .from(eventRegistrationAddonFulfillmentEvents)
              .where(
                and(
                  inArray(
                    eventRegistrationAddonFulfillmentEvents.purchaseId,
                    purchaseIds,
                  ),
                  eq(
                    eventRegistrationAddonFulfillmentEvents.tenantId,
                    input.tenantId,
                  ),
                ),
              )
              .orderBy(
                desc(eventRegistrationAddonFulfillmentEvents.createdAt),
                desc(eventRegistrationAddonFulfillmentEvents.id),
              ),
            tx
              .select({
                fulfillmentEventId:
                  registrationAcquisitionRefundAllocations.fulfillmentEventId,
                manuallyCreated: transactions.manuallyCreated,
                method: transactions.method,
                purchaseId: registrationAcquisitionRefundAllocations.purchaseId,
                quantity: registrationAcquisitionRefundAllocations.quantity,
                status: transactions.status,
                stripeRefundAttempts: transactions.stripeRefundAttempts,
                stripeRefundClaimLeaseExpiresAt:
                  transactions.stripeRefundClaimLeaseExpiresAt,
                stripeRefundClaimLeaseId: transactions.stripeRefundClaimLeaseId,
                stripeRefundMaxAttempts: transactions.stripeRefundMaxAttempts,
                stripeRefundNextAttemptAt:
                  transactions.stripeRefundNextAttemptAt,
                stripeRefundStatus: transactions.stripeRefundStatus,
              })
              .from(registrationAcquisitionRefundAllocations)
              .innerJoin(
                transactions,
                eq(
                  transactions.id,
                  registrationAcquisitionRefundAllocations.refundTransactionId,
                ),
              )
              .where(
                and(
                  inArray(
                    registrationAcquisitionRefundAllocations.purchaseId,
                    purchaseIds,
                  ),
                  eq(
                    registrationAcquisitionRefundAllocations.tenantId,
                    input.tenantId,
                  ),
                  eq(
                    registrationAcquisitionRefundAllocations.operationKind,
                    'addon_cancellation',
                  ),
                ),
              ),
            tx
              .select({
                grossAmount: registrationAcquisitionComponents.grossAmount,
                purchaseId: registrationAcquisitionComponents.purchaseId,
                purchaseLotId: registrationAcquisitionComponents.purchaseLotId,
              })
              .from(registrationAcquisitionComponents)
              .where(
                and(
                  eq(
                    registrationAcquisitionComponents.acquisitionId,
                    acquisition.id,
                  ),
                  eq(registrationAcquisitionComponents.kind, 'addon_lot'),
                  eq(
                    registrationAcquisitionComponents.tenantId,
                    input.tenantId,
                  ),
                ),
              ),
          ]);

          const acquisitionComponentByLotId = new Map(
            acquisitionComponents.flatMap((component) =>
              component.purchaseLotId
                ? [[component.purchaseLotId, component] as const]
                : [],
            ),
          );
          if (
            lots.some((lot) => {
              const component = acquisitionComponentByLotId.get(lot.id);
              return !component || component.purchaseId !== lot.purchaseId;
            })
          ) {
            return yield* internal(
              'Current add-on acquisition components are incomplete',
            );
          }

          const addOns = purchases.map((purchase) => {
            const purchaseLots = lots
              .filter((lot) => lot.purchaseId === purchase.id)
              .map((lot) => ({
                ...lot,
                grossAmount:
                  acquisitionComponentByLotId.get(lot.id)?.grossAmount ?? 0,
              }));
            const purchasedRedeemedQuantity = purchaseLots.reduce(
              (sum, lot) => sum + lot.redeemedQuantity,
              0,
            );
            const purchasedCancelledQuantity = purchaseLots.reduce(
              (sum, lot) => sum + lot.cancelledQuantity,
              0,
            );
            const cancellablePurchasedQuantity = Math.max(
              0,
              purchase.purchasedQuantity -
                purchasedRedeemedQuantity -
                purchasedCancelledQuantity,
            );
            const purchaseEvents = fulfillmentEvents.filter(
              (event) => event.purchaseId === purchase.id,
            );
            const reversedIds = new Set(
              purchaseEvents.flatMap(({ reversesEventId }) =>
                reversesEventId ? [reversesEventId] : [],
              ),
            );
            const latestRedemption = purchaseEvents.find(
              (event) =>
                event.type === 'redeemed' && !reversedIds.has(event.id),
            );
            const purchaseRefunds = refundRows.filter(
              (refund) => refund.purchaseId === purchase.id,
            );
            const purchaseAllocations = fulfillmentAllocations.filter(
              (allocation) => allocation.purchaseId === purchase.id,
            );
            const { refundAvailability, refundStatus } =
              deriveRegistrationAddonRefundState({
                allocations: purchaseAllocations,
                cancelledQuantity: purchase.cancelledQuantity,
                events: purchaseEvents,
                lots: purchaseLots,
                purchasedQuantity: purchase.purchasedQuantity,
                refunds: purchaseRefunds,
              });
            return {
              addOnId: purchase.addonId,
              cancellablePurchasedQuantity,
              cancellableQuantity: Math.max(
                0,
                purchase.quantity -
                  purchase.redeemedQuantity -
                  purchase.cancelledQuantity,
              ),
              cancellationAvailable:
                input.canCancel &&
                registration.status === 'CONFIRMED' &&
                purchase.redeemedQuantity + purchase.cancelledQuantity <
                  purchase.quantity,
              cancellationBlockedReason: input.canCancel
                ? registration.status === 'CONFIRMED'
                  ? purchase.redeemedQuantity + purchase.cancelledQuantity >=
                    purchase.quantity
                    ? 'noQuantity'
                    : 'none'
                  : 'registrationStatus'
                : 'permission',
              cancelledQuantity: purchase.cancelledQuantity,
              includedQuantity: purchase.includedQuantity,
              latestFulfillmentEventId: purchaseEvents[0]?.id ?? null,
              latestRedemptionEventId: latestRedemption?.id ?? null,
              purchasedQuantity: purchase.purchasedQuantity,
              redeemedQuantity: purchase.redeemedQuantity,
              redemptionAvailable:
                registration.status === 'CONFIRMED' &&
                purchase.redeemedQuantity + purchase.cancelledQuantity <
                  purchase.quantity,
              refundAvailability,
              refundStatus,
              registrationAddonId: purchase.id,
              remainingQuantity: Math.max(
                0,
                purchase.quantity -
                  purchase.redeemedQuantity -
                  purchase.cancelledQuantity,
              ),
              title: purchase.title,
              totalQuantity: purchase.quantity,
              undoAvailable: Boolean(latestRedemption),
            } satisfies EventsRegistrationAddonFulfillmentRecord;
          });
          return { addOns, registrationId: input.registrationId };
        }),
      ),
    ),
    'Registration add-on fulfillment could not be loaded',
  );
});

const lockFulfillmentRows = Effect.fn('lockFulfillmentRows')(function* (
  tx: Pick<DatabaseClient, 'select'>,
  input: Pick<
    FulfillmentIdentity,
    'registrationAddonId' | 'registrationId' | 'tenantId'
  >,
) {
  const registrations = yield* tx
    .select({
      eventId: eventRegistrations.eventId,
      registrationOptionId: eventRegistrations.registrationOptionId,
      status: eventRegistrations.status,
      userId: eventRegistrations.userId,
    })
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.id, input.registrationId),
        eq(eventRegistrations.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const registration = registrations[0];
  if (!registration) return yield* notFound();
  if (registration.status !== 'CONFIRMED') {
    return yield* conflict('Only confirmed registrations can fulfill add-ons');
  }
  yield* ensureRegistrationMutationHasNoActiveTransfer(tx, {
    registrationId: input.registrationId,
    tenantId: input.tenantId,
  }).pipe(
    Effect.mapError(() =>
      conflict(
        'This registration has an active transfer. Resolve or cancel the transfer before fulfilling add-ons.',
      ),
    ),
  );
  const purchases = yield* tx
    .select()
    .from(eventRegistrationAddonPurchases)
    .where(
      and(
        eq(eventRegistrationAddonPurchases.id, input.registrationAddonId),
        eq(
          eventRegistrationAddonPurchases.registrationId,
          input.registrationId,
        ),
        eq(eventRegistrationAddonPurchases.eventId, registration.eventId),
        eq(eventRegistrationAddonPurchases.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const purchase = purchases[0];
  if (!purchase) return yield* notFound();
  const lots = yield* tx
    .select()
    .from(eventRegistrationAddonPurchaseLots)
    .where(
      and(
        eq(eventRegistrationAddonPurchaseLots.purchaseId, purchase.id),
        eq(eventRegistrationAddonPurchaseLots.tenantId, input.tenantId),
      ),
    )
    .orderBy(
      asc(eventRegistrationAddonPurchaseLots.createdAt),
      asc(eventRegistrationAddonPurchaseLots.id),
    )
    .for('update');
  return { lots, purchase, registration };
});

/**
 * Cancels only still-unfulfilled quantities and returns inventory exactly once.
 * The caller owns the registration lock before entering this helper.
 */
export const cancelRemainingRegistrationAddons = Effect.fn(
  'cancelRemainingRegistrationAddons',
)(function* (
  tx: Pick<DatabaseClient, 'insert' | 'select' | 'update'>,
  input: {
    readonly actor: RegistrationAddonFulfillmentActor;
    readonly eventId: string;
    readonly reason: string;
    readonly refundRequested: boolean;
    readonly registrationId: string;
    readonly tenantId: string;
  },
) {
  const purchases = yield* tx
    .select()
    .from(eventRegistrationAddonPurchases)
    .where(
      and(
        eq(
          eventRegistrationAddonPurchases.registrationId,
          input.registrationId,
        ),
        eq(eventRegistrationAddonPurchases.eventId, input.eventId),
        eq(eventRegistrationAddonPurchases.tenantId, input.tenantId),
      ),
    )
    .orderBy(asc(eventRegistrationAddonPurchases.id))
    .for('update');
  const allocations: RegistrationAddonCancellationAllocation[] = [];

  for (const purchase of purchases) {
    const lots = yield* tx
      .select()
      .from(eventRegistrationAddonPurchaseLots)
      .where(
        and(
          eq(eventRegistrationAddonPurchaseLots.purchaseId, purchase.id),
          eq(eventRegistrationAddonPurchaseLots.tenantId, input.tenantId),
        ),
      )
      .orderBy(
        asc(eventRegistrationAddonPurchaseLots.createdAt),
        asc(eventRegistrationAddonPurchaseLots.id),
      )
      .for('update');
    const lotQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    if (lotQuantity !== purchase.purchasedQuantity) {
      return yield* internal('Optional add-on purchase lots are incomplete');
    }
    const purchasedConsumed = lots.reduce(
      (sum, lot) => sum + lot.redeemedQuantity + lot.cancelledQuantity,
      0,
    );
    const includedConsumed =
      purchase.redeemedQuantity +
      purchase.cancelledQuantity -
      purchasedConsumed;
    if (includedConsumed < 0 || includedConsumed > purchase.includedQuantity) {
      return yield* internal(
        'Included add-on fulfillment counters are inconsistent',
      );
    }
    const includedQuantity = purchase.includedQuantity - includedConsumed;
    const lotAllocations = lots.flatMap((lot) => {
      const quantity = Math.max(
        0,
        lot.quantity - lot.redeemedQuantity - lot.cancelledQuantity,
      );
      return quantity > 0 ? [{ lot, quantity }] : [];
    });
    const quantity =
      includedQuantity +
      lotAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    if (quantity === 0) continue;

    const fulfillmentEventId = createId();
    yield* tx.insert(eventRegistrationAddonFulfillmentEvents).values({
      actorKind: input.actor.kind,
      ...(input.actor.kind === 'user'
        ? { actorUserId: input.actor.userId }
        : { actorSubject: input.actor.subject }),
      eventId: input.eventId,
      id: fulfillmentEventId,
      operationKey: `registration-cancel:${input.registrationId}:${purchase.id}`,
      purchaseId: purchase.id,
      quantity,
      reason: input.reason,
      refundDisposition: input.refundRequested
        ? 'no_monetary_refund_required'
        : 'not_requested',
      refundRequested: input.refundRequested,
      registrationId: input.registrationId,
      tenantId: input.tenantId,
      type: 'cancelled',
    });
    if (includedQuantity > 0) {
      yield* tx.insert(eventRegistrationAddonFulfillmentAllocations).values({
        fulfillmentEventId,
        purchaseId: purchase.id,
        quantity: includedQuantity,
        source: 'included',
        tenantId: input.tenantId,
      });
    }
    for (const allocation of lotAllocations) {
      yield* tx
        .update(eventRegistrationAddonPurchaseLots)
        .set({
          cancelledQuantity: sql`${eventRegistrationAddonPurchaseLots.cancelledQuantity} + ${allocation.quantity}`,
        })
        .where(eq(eventRegistrationAddonPurchaseLots.id, allocation.lot.id));
      yield* tx.insert(eventRegistrationAddonFulfillmentAllocations).values({
        fulfillmentEventId,
        purchaseId: purchase.id,
        purchaseLotId: allocation.lot.id,
        quantity: allocation.quantity,
        source: 'purchased',
        tenantId: input.tenantId,
      });
      allocations.push({
        fulfillmentEventId,
        lot: allocation.lot,
        purchaseId: purchase.id,
        quantity: allocation.quantity,
      });
    }
    const updatedPurchases = yield* tx
      .update(eventRegistrationAddonPurchases)
      .set({
        cancelledQuantity: sql`${eventRegistrationAddonPurchases.cancelledQuantity} + ${quantity}`,
      })
      .where(
        and(
          eq(eventRegistrationAddonPurchases.id, purchase.id),
          sql`${eventRegistrationAddonPurchases.redeemedQuantity} + ${eventRegistrationAddonPurchases.cancelledQuantity} + ${quantity} <= ${eventRegistrationAddonPurchases.quantity}`,
        ),
      )
      .returning({ id: eventRegistrationAddonPurchases.id });
    if (updatedPurchases.length !== 1) {
      return yield* internal(
        'Add-on cancellation counters changed unexpectedly',
      );
    }
    const releasedStock = yield* tx
      .update(eventAddons)
      .set({
        totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${quantity}`,
      })
      .where(
        and(
          eq(eventAddons.id, purchase.addonId),
          eq(eventAddons.eventId, input.eventId),
        ),
      )
      .returning({ id: eventAddons.id });
    if (releasedStock.length !== 1) {
      return yield* internal('Add-on inventory could not be released');
    }
  }
  return allocations;
});

export const redeemRegistrationAddon = Effect.fn('redeemRegistrationAddon')(
  function* (input: FulfillmentIdentity) {
    const operationKey = yield* validateOperationKey(input.operationKey);
    return yield* mapUnexpected(
      Database.use((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            const locked = yield* lockFulfillmentRows(tx, input);
            const existing = yield* tx
              .select({
                id: eventRegistrationAddonFulfillmentEvents.id,
                quantity: eventRegistrationAddonFulfillmentEvents.quantity,
                reason: eventRegistrationAddonFulfillmentEvents.reason,
                type: eventRegistrationAddonFulfillmentEvents.type,
              })
              .from(eventRegistrationAddonFulfillmentEvents)
              .where(
                and(
                  eq(
                    eventRegistrationAddonFulfillmentEvents.purchaseId,
                    locked.purchase.id,
                  ),
                  eq(
                    eventRegistrationAddonFulfillmentEvents.operationKey,
                    operationKey,
                  ),
                  eq(
                    eventRegistrationAddonFulfillmentEvents.tenantId,
                    input.tenantId,
                  ),
                ),
              )
              .limit(1);
            if (existing[0]) {
              if (existing[0].type !== 'redeemed') {
                return yield* conflict('Operation key was already used');
              }
              return { fulfillmentEventId: existing[0].id };
            }
            if (
              locked.purchase.redeemedQuantity +
                locked.purchase.cancelledQuantity >=
              locked.purchase.quantity
            ) {
              return yield* conflict('No unfulfilled add-on quantity remains');
            }

            const purchasedRedeemed = locked.lots.reduce(
              (sum, lot) => sum + lot.redeemedQuantity,
              0,
            );
            const purchasedCancelled = locked.lots.reduce(
              (sum, lot) => sum + lot.cancelledQuantity,
              0,
            );
            const includedConsumed =
              locked.purchase.redeemedQuantity +
              locked.purchase.cancelledQuantity -
              purchasedRedeemed -
              purchasedCancelled;
            const useIncluded =
              includedConsumed < locked.purchase.includedQuantity;
            const lot = useIncluded
              ? undefined
              : locked.lots.find(
                  (candidate) =>
                    candidate.redeemedQuantity + candidate.cancelledQuantity <
                    candidate.quantity,
                );
            if (!useIncluded && !lot) {
              return yield* internal(
                'Purchased add-on lot counters are inconsistent',
              );
            }

            const fulfillmentEventId = createId();
            const updatedPurchase = yield* tx
              .update(eventRegistrationAddonPurchases)
              .set({
                redeemedQuantity: sql`${eventRegistrationAddonPurchases.redeemedQuantity} + 1`,
              })
              .where(
                and(
                  eq(eventRegistrationAddonPurchases.id, locked.purchase.id),
                  sql`${eventRegistrationAddonPurchases.redeemedQuantity} + ${eventRegistrationAddonPurchases.cancelledQuantity} < ${eventRegistrationAddonPurchases.quantity}`,
                ),
              )
              .returning({ id: eventRegistrationAddonPurchases.id });
            if (updatedPurchase.length !== 1) {
              return yield* conflict(
                'Add-on fulfillment changed; refresh and retry',
              );
            }
            if (lot) {
              yield* tx
                .update(eventRegistrationAddonPurchaseLots)
                .set({
                  redeemedQuantity: sql`${eventRegistrationAddonPurchaseLots.redeemedQuantity} + 1`,
                })
                .where(eq(eventRegistrationAddonPurchaseLots.id, lot.id));
            }
            yield* tx.insert(eventRegistrationAddonFulfillmentEvents).values({
              actorKind: 'user',
              actorUserId: input.actorUserId,
              eventId: locked.registration.eventId,
              id: fulfillmentEventId,
              operationKey,
              purchaseId: locked.purchase.id,
              quantity: 1,
              registrationId: input.registrationId,
              tenantId: input.tenantId,
              type: 'redeemed',
            });
            yield* tx
              .insert(eventRegistrationAddonFulfillmentAllocations)
              .values({
                fulfillmentEventId,
                purchaseId: locked.purchase.id,
                ...(lot && { purchaseLotId: lot.id }),
                quantity: 1,
                source: lot ? 'purchased' : 'included',
                tenantId: input.tenantId,
              });
            return { fulfillmentEventId };
          }),
        ),
      ),
      'Registration add-on could not be redeemed',
    );
  },
);

export const undoRegistrationAddonRedemption = Effect.fn(
  'undoRegistrationAddonRedemption',
)(function* (
  input: FulfillmentIdentity & { readonly redemptionEventId: string },
) {
  const operationKey = yield* validateOperationKey(input.operationKey);
  return yield* mapUnexpected(
    Database.use((database) =>
      database.transaction((tx) =>
        Effect.gen(function* () {
          const locked = yield* lockFulfillmentRows(tx, input);
          const originals = yield* tx
            .select()
            .from(eventRegistrationAddonFulfillmentEvents)
            .where(
              and(
                eq(
                  eventRegistrationAddonFulfillmentEvents.id,
                  input.redemptionEventId,
                ),
                eq(
                  eventRegistrationAddonFulfillmentEvents.purchaseId,
                  locked.purchase.id,
                ),
                eq(eventRegistrationAddonFulfillmentEvents.type, 'redeemed'),
                eq(
                  eventRegistrationAddonFulfillmentEvents.tenantId,
                  input.tenantId,
                ),
              ),
            )
            .for('update');
          const original = originals[0];
          if (!original) return yield* notFound();
          const existing = yield* tx
            .select({ id: eventRegistrationAddonFulfillmentEvents.id })
            .from(eventRegistrationAddonFulfillmentEvents)
            .where(
              and(
                eq(
                  eventRegistrationAddonFulfillmentEvents.reversesEventId,
                  original.id,
                ),
                eq(
                  eventRegistrationAddonFulfillmentEvents.tenantId,
                  input.tenantId,
                ),
              ),
            )
            .limit(1);
          if (existing[0]) return { fulfillmentEventId: existing[0].id };
          const reversal = alias(
            eventRegistrationAddonFulfillmentEvents,
            'active_redemption_reversal',
          );
          const latest = yield* tx
            .select({ id: eventRegistrationAddonFulfillmentEvents.id })
            .from(eventRegistrationAddonFulfillmentEvents)
            .where(
              and(
                eq(
                  eventRegistrationAddonFulfillmentEvents.purchaseId,
                  locked.purchase.id,
                ),
                eq(eventRegistrationAddonFulfillmentEvents.type, 'redeemed'),
                eq(
                  eventRegistrationAddonFulfillmentEvents.tenantId,
                  input.tenantId,
                ),
                notExists(
                  tx
                    .select({ id: reversal.id })
                    .from(reversal)
                    .where(
                      and(
                        eq(
                          reversal.reversesEventId,
                          eventRegistrationAddonFulfillmentEvents.id,
                        ),
                        eq(reversal.tenantId, input.tenantId),
                      ),
                    ),
                ),
              ),
            )
            .orderBy(
              desc(eventRegistrationAddonFulfillmentEvents.createdAt),
              desc(eventRegistrationAddonFulfillmentEvents.id),
            )
            .limit(1);
          if (latest[0]?.id !== original.id) {
            return yield* conflict(
              'Only the most recent redemption can be undone',
            );
          }
          const allocations = yield* tx
            .select()
            .from(eventRegistrationAddonFulfillmentAllocations)
            .where(
              eq(
                eventRegistrationAddonFulfillmentAllocations.fulfillmentEventId,
                original.id,
              ),
            )
            .for('update');
          if (
            allocations.reduce(
              (sum, allocation) => sum + allocation.quantity,
              0,
            ) !== original.quantity
          ) {
            return yield* internal('Redemption allocation is incomplete');
          }
          for (const allocation of allocations) {
            if (!allocation.purchaseLotId) {
              continue;
            }

            const updatedLot = yield* tx
              .update(eventRegistrationAddonPurchaseLots)
              .set({
                redeemedQuantity: sql`${eventRegistrationAddonPurchaseLots.redeemedQuantity} - ${allocation.quantity}`,
              })
              .where(
                and(
                  eq(
                    eventRegistrationAddonPurchaseLots.id,
                    allocation.purchaseLotId,
                  ),
                  sql`${eventRegistrationAddonPurchaseLots.redeemedQuantity} >= ${allocation.quantity}`,
                ),
              )
              .returning({ id: eventRegistrationAddonPurchaseLots.id });
            if (updatedLot.length !== 1) {
              return yield* internal(
                'Purchased redemption counter is inconsistent',
              );
            }
          }
          const updatedPurchase = yield* tx
            .update(eventRegistrationAddonPurchases)
            .set({
              redeemedQuantity: sql`${eventRegistrationAddonPurchases.redeemedQuantity} - ${original.quantity}`,
            })
            .where(
              and(
                eq(eventRegistrationAddonPurchases.id, locked.purchase.id),
                sql`${eventRegistrationAddonPurchases.redeemedQuantity} >= ${original.quantity}`,
              ),
            )
            .returning({ id: eventRegistrationAddonPurchases.id });
          if (updatedPurchase.length !== 1) {
            return yield* internal('Redemption counter is inconsistent');
          }
          const fulfillmentEventId = createId();
          yield* tx.insert(eventRegistrationAddonFulfillmentEvents).values({
            actorKind: 'user',
            actorUserId: input.actorUserId,
            eventId: locked.registration.eventId,
            id: fulfillmentEventId,
            operationKey,
            purchaseId: locked.purchase.id,
            quantity: original.quantity,
            registrationId: input.registrationId,
            reversesEventId: original.id,
            tenantId: input.tenantId,
            type: 'redemption_undone',
          });
          return { fulfillmentEventId };
        }),
      ),
    ),
    'Registration add-on redemption could not be undone',
  );
});

export const cancelRegistrationAddon = Effect.fn('cancelRegistrationAddon')(
  function* (
    input: FulfillmentIdentity & {
      readonly quantity: number;
      readonly reason: string;
      readonly refundRequested: boolean;
    },
  ) {
    const operationKey = yield* validateOperationKey(input.operationKey);
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > 500) {
      return yield* conflict(
        'Cancellation reason must contain between 1 and 500 characters',
      );
    }
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      return yield* conflict(
        'Cancellation quantity must be a positive integer',
      );
    }

    return yield* mapUnexpected(
      Database.use((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            const registrationRows = yield* tx
              .select({
                eventId: eventRegistrations.eventId,
                registrationOptionId: eventRegistrations.registrationOptionId,
                status: eventRegistrations.status,
                userId: eventRegistrations.userId,
              })
              .from(eventRegistrations)
              .where(
                and(
                  eq(eventRegistrations.id, input.registrationId),
                  eq(eventRegistrations.tenantId, input.tenantId),
                ),
              )
              .for('update');
            const registration = registrationRows[0];
            if (!registration) return yield* notFound();
            if (registration.status !== 'CONFIRMED') {
              return yield* conflict(
                'Only confirmed registrations can fulfill add-ons',
              );
            }
            yield* ensureRegistrationMutationHasNoActiveTransfer(tx, {
              registrationId: input.registrationId,
              tenantId: input.tenantId,
            }).pipe(
              Effect.mapError(() =>
                conflict(
                  'This registration has an active transfer. Resolve or cancel the transfer before fulfilling add-ons.',
                ),
              ),
            );

            // The registration row lock is the root lock for the immutable
            // acquisition, its payments, and its components.
            const currentAcquisition =
              yield* lockCurrentRegistrationAcquisition(tx, {
                ownerUserId: registration.userId,
                registrationId: input.registrationId,
                tenantId: input.tenantId,
              }).pipe(
                Effect.mapError((cause) =>
                  conflict(
                    `Current add-on acquisition is not settled: ${cause.message}`,
                  ),
                ),
              );
            if (
              currentAcquisition.acquisition.eventId !== registration.eventId
            ) {
              return yield* internal(
                'Current add-on acquisition event does not match',
              );
            }

            const purchases = yield* tx
              .select()
              .from(eventRegistrationAddonPurchases)
              .where(
                and(
                  eq(
                    eventRegistrationAddonPurchases.id,
                    input.registrationAddonId,
                  ),
                  eq(
                    eventRegistrationAddonPurchases.registrationId,
                    input.registrationId,
                  ),
                  eq(
                    eventRegistrationAddonPurchases.eventId,
                    registration.eventId,
                  ),
                  eq(eventRegistrationAddonPurchases.tenantId, input.tenantId),
                ),
              )
              .for('update');
            const purchase = purchases[0];
            if (!purchase) return yield* notFound();
            const lots = yield* tx
              .select()
              .from(eventRegistrationAddonPurchaseLots)
              .where(
                and(
                  eq(
                    eventRegistrationAddonPurchaseLots.purchaseId,
                    purchase.id,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseLots.tenantId,
                    input.tenantId,
                  ),
                ),
              )
              .orderBy(
                asc(eventRegistrationAddonPurchaseLots.createdAt),
                asc(eventRegistrationAddonPurchaseLots.id),
              )
              .for('update');

            const existing = yield* tx
              .select({
                id: eventRegistrationAddonFulfillmentEvents.id,
                quantity: eventRegistrationAddonFulfillmentEvents.quantity,
                reason: eventRegistrationAddonFulfillmentEvents.reason,
                refundRequested:
                  eventRegistrationAddonFulfillmentEvents.refundRequested,
                type: eventRegistrationAddonFulfillmentEvents.type,
              })
              .from(eventRegistrationAddonFulfillmentEvents)
              .where(
                and(
                  eq(
                    eventRegistrationAddonFulfillmentEvents.purchaseId,
                    purchase.id,
                  ),
                  eq(
                    eventRegistrationAddonFulfillmentEvents.operationKey,
                    operationKey,
                  ),
                  eq(
                    eventRegistrationAddonFulfillmentEvents.tenantId,
                    input.tenantId,
                  ),
                ),
              )
              .limit(1);
            const existingEvent = existing[0];
            if (existingEvent) {
              if (
                existingEvent.type !== 'cancelled' ||
                existingEvent.refundRequested !== input.refundRequested ||
                existingEvent.quantity !== input.quantity ||
                existingEvent.reason !== reason
              ) {
                return yield* conflict('Operation key was already used');
              }
              if (!input.refundRequested) {
                const purchasedAllocations = yield* tx
                  .select({
                    purchaseLotId:
                      eventRegistrationAddonFulfillmentAllocations.purchaseLotId,
                  })
                  .from(eventRegistrationAddonFulfillmentAllocations)
                  .where(
                    and(
                      eq(
                        eventRegistrationAddonFulfillmentAllocations.fulfillmentEventId,
                        existingEvent.id,
                      ),
                      eq(
                        eventRegistrationAddonFulfillmentAllocations.source,
                        'purchased',
                      ),
                    ),
                  )
                  .limit(1);
                return {
                  fulfillmentEventId: existingEvent.id,
                  refundStatus:
                    purchasedAllocations.length === 0
                      ? ('notRequired' as const)
                      : ('cancelledWithoutRefund' as const),
                };
              }
              const replayClaims = yield* tx
                .select({
                  fulfillmentEventId:
                    registrationAcquisitionRefundAllocations.fulfillmentEventId,
                  manuallyCreated: transactions.manuallyCreated,
                  method: transactions.method,
                  quantity: registrationAcquisitionRefundAllocations.quantity,
                  status: transactions.status,
                  stripeRefundAttempts: transactions.stripeRefundAttempts,
                  stripeRefundClaimLeaseExpiresAt:
                    transactions.stripeRefundClaimLeaseExpiresAt,
                  stripeRefundClaimLeaseId:
                    transactions.stripeRefundClaimLeaseId,
                  stripeRefundMaxAttempts: transactions.stripeRefundMaxAttempts,
                  stripeRefundNextAttemptAt:
                    transactions.stripeRefundNextAttemptAt,
                  stripeRefundStatus: transactions.stripeRefundStatus,
                })
                .from(registrationAcquisitionRefundAllocations)
                .innerJoin(
                  transactions,
                  eq(
                    transactions.id,
                    registrationAcquisitionRefundAllocations.refundTransactionId,
                  ),
                )
                .where(
                  and(
                    eq(
                      registrationAcquisitionRefundAllocations.fulfillmentEventId,
                      existingEvent.id,
                    ),
                    eq(
                      registrationAcquisitionRefundAllocations.operationKind,
                      'addon_cancellation',
                    ),
                  ),
                );
              const claimProgress =
                registrationAddonRefundClaimProgress(replayClaims);
              const refundStatus: EventsRegistrationAddonRefundStatus =
                replayClaims.length === 0
                  ? 'notRequired'
                  : (claimProgress ??
                    (replayClaims.every(
                      (claim) =>
                        claim.status === 'successful' ||
                        claim.stripeRefundStatus === 'succeeded',
                    )
                      ? 'refunded'
                      : 'pending'));
              return {
                fulfillmentEventId: existingEvent.id,
                refundStatus,
              };
            }

            const cancellationSelection = selectRegistrationAddonCancellation({
              cancelledQuantity: purchase.cancelledQuantity,
              includedQuantity: purchase.includedQuantity,
              lots,
              quantity: input.quantity,
              redeemedQuantity: purchase.redeemedQuantity,
            });
            if (!cancellationSelection) {
              return yield* conflict(
                'Only unredeemed add-on quantities can be cancelled',
              );
            }
            const selectedLots = cancellationSelection.lots.flatMap(
              (selection) => {
                const lot = lots.find(({ id }) => id === selection.id);
                if (!lot) return [];
                const components = currentAcquisition.components.filter(
                  (component) =>
                    component.kind === 'addon_lot' &&
                    component.purchaseLotId === lot.id &&
                    component.purchaseId === purchase.id,
                );
                return components.length === 1
                  ? [
                      {
                        component: components[0],
                        lot,
                        quantity: selection.quantity,
                      },
                    ]
                  : [];
              },
            );
            if (selectedLots.length !== cancellationSelection.lots.length) {
              return yield* conflict(
                'Current add-on acquisition components are incomplete or ambiguous',
              );
            }

            const componentIds = selectedLots.map(
              ({ component }) => component.id,
            );
            const priorAllocations =
              componentIds.length === 0
                ? []
                : yield* tx
                    .select()
                    .from(registrationAcquisitionRefundAllocations)
                    .where(
                      and(
                        inArray(
                          registrationAcquisitionRefundAllocations.componentId,
                          componentIds,
                        ),
                        eq(
                          registrationAcquisitionRefundAllocations.tenantId,
                          input.tenantId,
                        ),
                      ),
                    )
                    .orderBy(registrationAcquisitionRefundAllocations.id)
                    .for('update');

            const lockedTenants = input.refundRequested
              ? yield* tx
                  .select({
                    refundFeesOnCancellation: tenants.refundFeesOnCancellation,
                  })
                  .from(tenants)
                  .where(eq(tenants.id, input.tenantId))
                  .for('update')
              : [];
            const lockedOptions = input.refundRequested
              ? yield* tx
                  .select({
                    refundFeesOnCancellation:
                      eventRegistrationOptions.refundFeesOnCancellation,
                  })
                  .from(eventRegistrationOptions)
                  .where(
                    and(
                      eq(
                        eventRegistrationOptions.id,
                        registration.registrationOptionId,
                      ),
                      eq(
                        eventRegistrationOptions.eventId,
                        registration.eventId,
                      ),
                    ),
                  )
                  .for('update')
              : [];
            if (
              input.refundRequested &&
              (!lockedTenants[0] || !lockedOptions[0])
            ) {
              return yield* internal('Add-on refund policy is missing');
            }
            const refundFees = input.refundRequested
              ? (lockedOptions[0]?.refundFeesOnCancellation ??
                lockedTenants[0]?.refundFeesOnCancellation ??
                false)
              : false;

            const plannedRefunds = [];
            if (input.refundRequested) {
              for (const selected of selectedLots) {
                const component = selected.component;
                const prior = priorAllocations.filter(
                  ({ componentId }) => componentId === component.id,
                );
                const priorQuantity = prior.reduce(
                  (sum, allocation) => sum + allocation.quantity,
                  0,
                );
                const priorGrossAmount = prior.reduce(
                  (sum, allocation) => sum + allocation.grossEntitlementAmount,
                  0,
                );
                const priorNetAmount = prior.reduce(
                  (sum, allocation) => sum + allocation.netEntitlementAmount,
                  0,
                );
                const priorStripeFeeAmount = prior.reduce(
                  (sum, allocation) => sum + allocation.stripeFeeAmount,
                  0,
                );
                const priorApplicationFeeAmount = prior.reduce(
                  (sum, allocation) => sum + allocation.applicationFeeAmount,
                  0,
                );
                const unavailableQuantity =
                  selected.lot.redeemedQuantity +
                  selected.lot.cancelledQuantity;
                const amounts = allocateAcquisitionComponentQuantity({
                  alreadyAllocatedQuantity: unavailableQuantity,
                  component,
                  quantity: selected.quantity,
                });
                if (
                  !amounts ||
                  priorQuantity > selected.lot.cancelledQuantity ||
                  priorGrossAmount + amounts.grossAmount >
                    component.grossAmount ||
                  priorNetAmount + amounts.netAmount > component.netAmount ||
                  priorStripeFeeAmount + amounts.stripeFeeAmount >
                    component.stripeFeeAmount ||
                  priorApplicationFeeAmount + amounts.applicationFeeAmount >
                    component.applicationFeeAmount
                ) {
                  return yield* conflict(
                    'Current add-on refund entitlement is inconsistent or exhausted',
                  );
                }
                const refundAmount = refundFees
                  ? amounts.grossAmount
                  : amounts.netAmount;
                if (refundAmount === 0) continue;
                if (
                  amounts.grossAmount <= 0 ||
                  component.acquisitionPaymentId === null
                ) {
                  return yield* internal(
                    'Monetary add-on component payment ownership is missing',
                  );
                }
                plannedRefunds.push({
                  ...amounts,
                  acquisitionPaymentId: component.acquisitionPaymentId,
                  component,
                  quantity: selected.quantity,
                  refundAmount,
                });
              }
            }

            const selectedPaymentIds = [
              ...new Set(
                plannedRefunds.map(
                  ({ acquisitionPaymentId }) => acquisitionPaymentId,
                ),
              ),
            ].toSorted();
            const selectedPayments = selectedPaymentIds.flatMap((paymentId) => {
              const payment = currentAcquisition.payments.find(
                ({ id }) => id === paymentId,
              );
              return payment ? [payment] : [];
            });
            if (selectedPayments.length !== selectedPaymentIds.length) {
              return yield* internal(
                'Current add-on acquisition payment is missing',
              );
            }
            const sourceTransactionIds = selectedPayments
              .map(({ transactionId }) => transactionId)
              .toSorted();
            const lockedSources =
              sourceTransactionIds.length === 0
                ? []
                : yield* tx
                    .select({
                      amount: transactions.amount,
                      appFee: transactions.appFee,
                      currency: transactions.currency,
                      eventId: transactions.eventId,
                      eventRegistrationId: transactions.eventRegistrationId,
                      id: transactions.id,
                      method: transactions.method,
                      status: transactions.status,
                      stripeAccountId: transactions.stripeAccountId,
                      stripeChargeId: transactions.stripeChargeId,
                      stripeFee: transactions.stripeFee,
                      stripeNetAmount: transactions.stripeNetAmount,
                      stripePaymentIntentId: transactions.stripePaymentIntentId,
                      targetUserId: transactions.targetUserId,
                      tenantId: transactions.tenantId,
                      type: transactions.type,
                    })
                    .from(transactions)
                    .where(inArray(transactions.id, sourceTransactionIds))
                    .orderBy(transactions.id)
                    .for('update');
            if (
              lockedSources.length !== sourceTransactionIds.length ||
              lockedSources.some(
                (source) =>
                  (source.type !== 'registration' && source.type !== 'addon') ||
                  source.method !== 'stripe' ||
                  source.status !== 'successful' ||
                  source.eventId !== registration.eventId ||
                  source.eventRegistrationId !== input.registrationId ||
                  source.targetUserId !== registration.userId ||
                  source.tenantId !== input.tenantId ||
                  source.stripeAccountId === null ||
                  (source.stripeChargeId === null &&
                    source.stripePaymentIntentId === null),
              )
            ) {
              return yield* conflict(
                'Current add-on payment ownership is not refundable',
              );
            }
            for (const plan of plannedRefunds) {
              const payment = selectedPayments.find(
                ({ id }) => id === plan.acquisitionPaymentId,
              );
              const source = lockedSources.find(
                ({ id }) => id === payment?.transactionId,
              );
              if (!source || source.currency !== plan.component.currency) {
                return yield* conflict(
                  'Current add-on payment currency does not match',
                );
              }
            }
            for (const payment of selectedPayments) {
              const source = lockedSources.find(
                ({ id }) => id === payment.transactionId,
              );
              const components = currentAcquisition.components.filter(
                ({ acquisitionPaymentId }) =>
                  acquisitionPaymentId === payment.id,
              );
              const currencies = new Set(
                components.map(({ currency }) => currency),
              );
              if (
                !source ||
                components.length === 0 ||
                currencies.size !== 1 ||
                !currencies.has(source.currency) ||
                source.amount !==
                  components.reduce(
                    (sum, component) => sum + component.grossAmount,
                    0,
                  ) ||
                source.appFee !==
                  components.reduce(
                    (sum, component) => sum + component.applicationFeeAmount,
                    0,
                  ) ||
                source.stripeFee !==
                  components.reduce(
                    (sum, component) => sum + component.stripeFeeAmount,
                    0,
                  ) ||
                source.stripeNetAmount !==
                  components.reduce(
                    (sum, component) => sum + component.netAmount,
                    0,
                  )
              ) {
                return yield* conflict(
                  'Current add-on payment settlement no longer matches its immutable acquisition components',
                );
              }
            }

            const fulfillmentEventId = createId();
            yield* tx.insert(eventRegistrationAddonFulfillmentEvents).values({
              actorKind: 'user',
              actorUserId: input.actorUserId,
              eventId: registration.eventId,
              id: fulfillmentEventId,
              operationKey,
              purchaseId: purchase.id,
              quantity: input.quantity,
              reason,
              refundDisposition: input.refundRequested
                ? plannedRefunds.length > 0
                  ? 'claims_created'
                  : 'no_monetary_refund_required'
                : 'not_requested',
              refundRequested: input.refundRequested,
              registrationId: input.registrationId,
              tenantId: input.tenantId,
              type: 'cancelled',
            });

            const claimByPaymentId = new Map<string, string>();
            for (const payment of selectedPayments) {
              const source = lockedSources.find(
                ({ id }) => id === payment.transactionId,
              );
              if (!source?.stripeAccountId) {
                return yield* internal(
                  'Current add-on Stripe payment ownership is missing',
                );
              }
              const paymentPlans = plannedRefunds.filter(
                ({ acquisitionPaymentId }) =>
                  acquisitionPaymentId === payment.id,
              );
              const refundAmount = paymentPlans.reduce(
                (sum, plan) => sum + plan.refundAmount,
                0,
              );
              const claim = yield* createRegistrationRefundClaim(tx, {
                amount: refundAmount,
                applicationFeeRefunded: refundFees,
                currency: source.currency,
                eventId: registration.eventId,
                eventRegistrationId: input.registrationId,
                executiveUserId: input.actorUserId,
                operationKey: `addon-cancel:${fulfillmentEventId}:${payment.id}`,
                sourceTransactionId: source.id,
                stripeAccountId: source.stripeAccountId,
                targetUserId: registration.userId,
                tenantId: input.tenantId,
              });
              claimByPaymentId.set(payment.id, claim.id);
            }

            for (const plan of plannedRefunds) {
              const refundTransactionId = claimByPaymentId.get(
                plan.acquisitionPaymentId,
              );
              if (!refundTransactionId) {
                return yield* internal(
                  'Current add-on refund claim was not persisted',
                );
              }
              yield* tx
                .insert(registrationAcquisitionRefundAllocations)
                .values({
                  acquisitionId: currentAcquisition.acquisition.id,
                  acquisitionPaymentId: plan.acquisitionPaymentId,
                  applicationFeeAmount: plan.applicationFeeAmount,
                  applicationFeeRefunded: refundFees,
                  componentId: plan.component.id,
                  eventId: registration.eventId,
                  fulfillmentEventId,
                  grossEntitlementAmount: plan.grossAmount,
                  netEntitlementAmount: plan.netAmount,
                  operationKey: `addon-cancel:${fulfillmentEventId}:${plan.component.id}`,
                  operationKind: 'addon_cancellation',
                  purchaseId: purchase.id,
                  quantity: plan.quantity,
                  refundAmount: plan.refundAmount,
                  refundTransactionId,
                  registrationId: input.registrationId,
                  stripeFeeAmount: plan.stripeFeeAmount,
                  tenantId: input.tenantId,
                });
            }

            for (const selected of selectedLots) {
              const updatedLots = yield* tx
                .update(eventRegistrationAddonPurchaseLots)
                .set({
                  cancelledQuantity: sql`${eventRegistrationAddonPurchaseLots.cancelledQuantity} + ${selected.quantity}`,
                })
                .where(
                  and(
                    eq(eventRegistrationAddonPurchaseLots.id, selected.lot.id),
                    sql`${eventRegistrationAddonPurchaseLots.redeemedQuantity} + ${eventRegistrationAddonPurchaseLots.cancelledQuantity} + ${selected.quantity} <= ${eventRegistrationAddonPurchaseLots.quantity}`,
                  ),
                )
                .returning({ id: eventRegistrationAddonPurchaseLots.id });
              if (updatedLots.length !== 1) {
                return yield* internal(
                  'Add-on purchase lot cancellation changed unexpectedly',
                );
              }
              yield* tx
                .insert(eventRegistrationAddonFulfillmentAllocations)
                .values({
                  fulfillmentEventId,
                  purchaseId: purchase.id,
                  purchaseLotId: selected.lot.id,
                  quantity: selected.quantity,
                  source: 'purchased',
                  tenantId: input.tenantId,
                });
            }
            if (cancellationSelection.includedQuantity > 0) {
              yield* tx
                .insert(eventRegistrationAddonFulfillmentAllocations)
                .values({
                  fulfillmentEventId,
                  purchaseId: purchase.id,
                  quantity: cancellationSelection.includedQuantity,
                  source: 'included',
                  tenantId: input.tenantId,
                });
            }
            const updatedPurchases = yield* tx
              .update(eventRegistrationAddonPurchases)
              .set({
                cancelledQuantity: sql`${eventRegistrationAddonPurchases.cancelledQuantity} + ${input.quantity}`,
              })
              .where(
                and(
                  eq(eventRegistrationAddonPurchases.id, purchase.id),
                  sql`${eventRegistrationAddonPurchases.redeemedQuantity} + ${eventRegistrationAddonPurchases.cancelledQuantity} + ${input.quantity} <= ${eventRegistrationAddonPurchases.quantity}`,
                ),
              )
              .returning({ id: eventRegistrationAddonPurchases.id });
            if (updatedPurchases.length !== 1) {
              return yield* internal(
                'Add-on cancellation counters changed unexpectedly',
              );
            }
            const releasedStock = yield* tx
              .update(eventAddons)
              .set({
                totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${input.quantity}`,
              })
              .where(
                and(
                  eq(eventAddons.id, purchase.addonId),
                  eq(eventAddons.eventId, registration.eventId),
                ),
              )
              .returning({ id: eventAddons.id });
            if (releasedStock.length !== 1) {
              return yield* internal('Add-on inventory could not be released');
            }
            return {
              fulfillmentEventId,
              refundStatus: input.refundRequested
                ? plannedRefunds.length > 0
                  ? ('pending' as const)
                  : ('notRequired' as const)
                : selectedLots.length === 0
                  ? ('notRequired' as const)
                  : ('cancelledWithoutRefund' as const),
            };
          }),
        ),
      ),
      'Registration add-on could not be cancelled',
    );
  },
);
