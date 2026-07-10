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
  eventRegistrationAddonRefundAllocations,
  eventRegistrationOptions,
  eventRegistrations,
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

import { allocateCumulativeQuantityAmount } from '../payments/addon-payment-allocation';
import { ensureAddonPaymentAllocations } from '../payments/addon-payment-allocation.service';
import { createRegistrationRefundClaim } from '../payments/registration-refund';
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
  typeof eventRegistrationAddonRefundAllocations.$inferSelect,
  'fulfillmentEventId' | 'quantity'
> &
  Pick<typeof transactions.$inferSelect, 'status' | 'stripeRefundStatus'>;

type RegistrationAddonRefundHistoryEvent = Pick<
  typeof eventRegistrationAddonFulfillmentEvents.$inferSelect,
  'id' | 'refundDisposition' | 'refundRequested' | 'type'
>;

type RegistrationAddonRefundHistoryLot = Pick<
  typeof eventRegistrationAddonPurchaseLots.$inferSelect,
  | 'cancelledQuantity'
  | 'grossAmount'
  | 'quantity'
  | 'redeemedQuantity'
  | 'sourceTransactionId'
>;

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
    (lot) => lot.sourceTransactionId !== null && (lot.grossAmount ?? 1) > 0,
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
    purchasedCancellationEventIds.has(refund.fulfillmentEventId),
  );
  const refundedQuantity = purchasedRefunds
    .filter(
      (refund) =>
        refund.status === 'successful' ||
        refund.stripeRefundStatus === 'succeeded',
    )
    .reduce((sum, refund) => sum + refund.quantity, 0);
  const hasFailedRefund = purchasedRefunds.some(
    (refund) =>
      refund.status === 'cancelled' ||
      refund.stripeRefundStatus === 'failed' ||
      refund.stripeRefundStatus === 'canceled',
  );
  const hasPendingRefund = purchasedRefunds.some(
    (refund) => refund.status === 'pending',
  );
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
  if (hasFailedRefund) refundStatus = 'failed';
  else if (hasPendingRefund) refundStatus = 'pending';
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
          const purchaseIds = purchases.map(({ id }) => id);
          const [lots, fulfillmentAllocations, fulfillmentEvents, refundRows] =
            yield* Effect.all([
              tx
                .select({
                  cancelledQuantity:
                    eventRegistrationAddonPurchaseLots.cancelledQuantity,
                  grossAmount: eventRegistrationAddonPurchaseLots.grossAmount,
                  purchaseId: eventRegistrationAddonPurchaseLots.purchaseId,
                  quantity: eventRegistrationAddonPurchaseLots.quantity,
                  redeemedQuantity:
                    eventRegistrationAddonPurchaseLots.redeemedQuantity,
                  refundAllocatedQuantity:
                    eventRegistrationAddonPurchaseLots.refundAllocatedQuantity,
                  sourceTransactionId:
                    eventRegistrationAddonPurchaseLots.sourceTransactionId,
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
                  quantity:
                    eventRegistrationAddonFulfillmentAllocations.quantity,
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
                  purchaseId:
                    eventRegistrationAddonFulfillmentEvents.purchaseId,
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
                    eventRegistrationAddonRefundAllocations.fulfillmentEventId,
                  purchaseId:
                    eventRegistrationAddonFulfillmentEvents.purchaseId,
                  quantity: eventRegistrationAddonRefundAllocations.quantity,
                  status: transactions.status,
                  stripeRefundStatus: transactions.stripeRefundStatus,
                })
                .from(eventRegistrationAddonRefundAllocations)
                .innerJoin(
                  eventRegistrationAddonFulfillmentEvents,
                  eq(
                    eventRegistrationAddonFulfillmentEvents.id,
                    eventRegistrationAddonRefundAllocations.fulfillmentEventId,
                  ),
                )
                .innerJoin(
                  transactions,
                  eq(
                    transactions.id,
                    eventRegistrationAddonRefundAllocations.refundTransactionId,
                  ),
                )
                .where(
                  and(
                    inArray(
                      eventRegistrationAddonFulfillmentEvents.purchaseId,
                      purchaseIds,
                    ),
                    eq(
                      eventRegistrationAddonRefundAllocations.tenantId,
                      input.tenantId,
                    ),
                  ),
                ),
            ]);

          const addOns = purchases.map((purchase) => {
            const purchaseLots = lots.filter(
              (lot) => lot.purchaseId === purchase.id,
            );
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
        ? lotAllocations.some(
            ({ lot }) =>
              lot.sourceTransactionId !== null && (lot.grossAmount ?? 0) > 0,
          )
          ? 'claims_created'
          : 'no_monetary_refund_required'
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

    let paidSourceIds: string[] = [];
    if (input.refundRequested) {
      const sourceIds = yield* Database.use((database) =>
        database
          .select({
            sourceTransactionId:
              eventRegistrationAddonPurchaseLots.sourceTransactionId,
          })
          .from(eventRegistrationAddonPurchaseLots)
          .where(
            and(
              eq(
                eventRegistrationAddonPurchaseLots.purchaseId,
                input.registrationAddonId,
              ),
              eq(eventRegistrationAddonPurchaseLots.tenantId, input.tenantId),
            ),
          ),
      ).pipe(
        Effect.mapError((cause) =>
          internal('Add-on payment sources could not be loaded', cause),
        ),
      );
      paidSourceIds = [
        ...new Set(
          sourceIds.flatMap(({ sourceTransactionId }) =>
            sourceTransactionId ? [sourceTransactionId] : [],
          ),
        ),
      ].toSorted();
      yield* Effect.forEach(
        paidSourceIds,
        (sourceTransactionId) =>
          ensureAddonPaymentAllocations(sourceTransactionId).pipe(
            Effect.mapError((cause) =>
              conflict(
                `Payment allocation is still reconciling: ${cause.message}`,
              ),
            ),
          ),
        { discard: true },
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
            const lockedSources =
              paidSourceIds.length === 0
                ? []
                : yield* tx
                    .select({
                      currency: transactions.currency,
                      id: transactions.id,
                      status: transactions.status,
                      stripeAccountId: transactions.stripeAccountId,
                      targetUserId: transactions.targetUserId,
                    })
                    .from(transactions)
                    .where(
                      and(
                        inArray(transactions.id, paidSourceIds),
                        eq(transactions.tenantId, input.tenantId),
                        inArray(transactions.type, ['registration', 'addon']),
                      ),
                    )
                    .orderBy(asc(transactions.id))
                    .for('update');
            if (
              lockedSources.length !== paidSourceIds.length ||
              lockedSources.some(
                (source) =>
                  source.status !== 'successful' ||
                  source.targetUserId !== registration.userId,
              )
            ) {
              return yield* conflict(
                'Add-on payment ownership is not reconciled',
              );
            }
            const locked = yield* lockFulfillmentRows(tx, input);
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
              if (
                existing[0].type !== 'cancelled' ||
                existing[0].refundRequested !== input.refundRequested ||
                existing[0].quantity !== input.quantity ||
                existing[0].reason !== reason
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
                        existing[0].id,
                      ),
                      eq(
                        eventRegistrationAddonFulfillmentAllocations.source,
                        'purchased',
                      ),
                    ),
                  )
                  .limit(1);
                return {
                  fulfillmentEventId: existing[0].id,
                  refundStatus:
                    purchasedAllocations.length === 0
                      ? ('notRequired' as const)
                      : ('cancelledWithoutRefund' as const),
                };
              }
              const replayClaims = yield* tx
                .select({
                  status: transactions.status,
                  stripeRefundStatus: transactions.stripeRefundStatus,
                })
                .from(eventRegistrationAddonRefundAllocations)
                .innerJoin(
                  transactions,
                  eq(
                    transactions.id,
                    eventRegistrationAddonRefundAllocations.refundTransactionId,
                  ),
                )
                .where(
                  eq(
                    eventRegistrationAddonRefundAllocations.fulfillmentEventId,
                    existing[0].id,
                  ),
                );
              const refundStatus: EventsRegistrationAddonRefundStatus =
                replayClaims.length === 0
                  ? 'notRequired'
                  : replayClaims.some(
                        (claim) =>
                          claim.status === 'cancelled' ||
                          claim.stripeRefundStatus === 'failed' ||
                          claim.stripeRefundStatus === 'canceled',
                      )
                    ? 'failed'
                    : replayClaims.some((claim) => claim.status === 'pending')
                      ? 'pending'
                      : replayClaims.every(
                            (claim) =>
                              claim.status === 'successful' ||
                              claim.stripeRefundStatus === 'succeeded',
                          )
                        ? 'refunded'
                        : 'pending';
              return {
                fulfillmentEventId: existing[0].id,
                refundStatus,
              };
            }
            const cancellationSelection = selectRegistrationAddonCancellation({
              cancelledQuantity: locked.purchase.cancelledQuantity,
              includedQuantity: locked.purchase.includedQuantity,
              lots: locked.lots,
              quantity: input.quantity,
              redeemedQuantity: locked.purchase.redeemedQuantity,
            });
            if (!cancellationSelection) {
              return yield* conflict(
                'Only unredeemed add-on quantities can be cancelled',
              );
            }
            const selectedLots = cancellationSelection.lots.flatMap(
              (allocation) => {
                const lot = locked.lots.find(({ id }) => id === allocation.id);
                return lot ? [{ lot, quantity: allocation.quantity }] : [];
              },
            );
            if (selectedLots.length !== cancellationSelection.lots.length) {
              return yield* internal(
                'Selected add-on purchase lot disappeared during cancellation',
              );
            }
            const selectedIncludedQuantity =
              cancellationSelection.includedQuantity;

            const lockedTenants = yield* tx
              .select({
                refundFeesOnCancellation: tenants.refundFeesOnCancellation,
              })
              .from(tenants)
              .where(eq(tenants.id, input.tenantId))
              .for('update');
            const lockedOptions = yield* tx
              .select({
                refundFeesOnCancellation:
                  eventRegistrationOptions.refundFeesOnCancellation,
              })
              .from(eventRegistrationOptions)
              .where(
                and(
                  eq(
                    eventRegistrationOptions.id,
                    locked.registration.registrationOptionId,
                  ),
                  eq(
                    eventRegistrationOptions.eventId,
                    locked.registration.eventId,
                  ),
                ),
              )
              .for('update');
            if (!lockedTenants[0] || !lockedOptions[0]) {
              return yield* internal('Add-on refund policy is missing');
            }
            const refundFees =
              lockedOptions[0].refundFeesOnCancellation ??
              lockedTenants[0].refundFeesOnCancellation;
            const fulfillmentEventId = createId();
            const claims: string[] = [];
            let refundAllocatedQuantity = 0;

            yield* tx.insert(eventRegistrationAddonFulfillmentEvents).values({
              actorKind: 'user',
              actorUserId: input.actorUserId,
              eventId: locked.registration.eventId,
              id: fulfillmentEventId,
              operationKey,
              purchaseId: locked.purchase.id,
              quantity: input.quantity,
              reason,
              refundDisposition: input.refundRequested
                ? selectedLots.some(({ lot }) => {
                    const amount = refundFees ? lot.grossAmount : lot.netAmount;
                    return (
                      lot.sourceTransactionId !== null && (amount ?? 0) > 0
                    );
                  })
                  ? 'claims_created'
                  : 'no_monetary_refund_required'
                : 'not_requested',
              refundRequested: input.refundRequested,
              registrationId: input.registrationId,
              tenantId: input.tenantId,
              type: 'cancelled',
            });
            for (const { lot, quantity } of selectedLots) {
              yield* tx
                .update(eventRegistrationAddonPurchaseLots)
                .set({
                  cancelledQuantity: sql`${eventRegistrationAddonPurchaseLots.cancelledQuantity} + ${quantity}`,
                })
                .where(eq(eventRegistrationAddonPurchaseLots.id, lot.id));
              yield* tx
                .insert(eventRegistrationAddonFulfillmentAllocations)
                .values({
                  fulfillmentEventId,
                  purchaseId: locked.purchase.id,
                  purchaseLotId: lot.id,
                  quantity,
                  source: 'purchased',
                  tenantId: input.tenantId,
                });

              if (!input.refundRequested) continue;
              const grossAmount = lot.grossAmount ?? 0;
              const netAmount = lot.netAmount ?? 0;
              const applicationFeeAmount = lot.applicationFeeAmount ?? 0;
              const grossAllocation = allocateCumulativeQuantityAmount({
                alreadyAllocatedQuantity: lot.refundAllocatedQuantity,
                amount: grossAmount,
                quantity,
                totalQuantity: lot.quantity,
              });
              const netAllocation = allocateCumulativeQuantityAmount({
                alreadyAllocatedQuantity: lot.refundAllocatedQuantity,
                amount: netAmount,
                quantity,
                totalQuantity: lot.quantity,
              });
              const appFeeAllocation = allocateCumulativeQuantityAmount({
                alreadyAllocatedQuantity: lot.refundAllocatedQuantity,
                amount: applicationFeeAmount,
                quantity,
                totalQuantity: lot.quantity,
              });
              const refundAmount = refundFees ? grossAllocation : netAllocation;
              if (lot.sourceTransactionId && refundAmount > 0) {
                const source = lockedSources.find(
                  ({ id }) => id === lot.sourceTransactionId,
                );
                if (!source?.stripeAccountId) {
                  return yield* conflict(
                    'Add-on Stripe payment ownership is missing',
                  );
                }
                const claim = yield* createRegistrationRefundClaim(tx, {
                  amount: refundAmount,
                  applicationFeeRefunded: refundFees,
                  currency: source.currency,
                  eventId: locked.registration.eventId,
                  eventRegistrationId: input.registrationId,
                  executiveUserId: input.actorUserId,
                  operationKey: `addon-cancel:${fulfillmentEventId}:${lot.id}`,
                  sourceTransactionId: source.id,
                  stripeAccountId: source.stripeAccountId,
                  targetUserId: locked.registration.userId,
                  tenantId: input.tenantId,
                });
                const refundTransactionId = claim.id;
                claims.push(claim.id);
                yield* tx
                  .insert(eventRegistrationAddonRefundAllocations)
                  .values({
                    applicationFeeAmount: appFeeAllocation,
                    applicationFeeRefunded: refundFees,
                    currency: source.currency,
                    eventId: locked.registration.eventId,
                    fulfillmentEventId,
                    grossEntitlementAmount: grossAllocation,
                    netEntitlementAmount: netAllocation,
                    purchaseId: locked.purchase.id,
                    purchaseLotId: lot.id,
                    quantity,
                    refundAmount,
                    refundTransactionId,
                    registrationId: input.registrationId,
                    tenantId: input.tenantId,
                  });
              }
              yield* tx
                .update(eventRegistrationAddonPurchaseLots)
                .set({
                  refundAllocatedApplicationFeeAmount: sql`${eventRegistrationAddonPurchaseLots.refundAllocatedApplicationFeeAmount} + ${appFeeAllocation}`,
                  refundAllocatedGrossAmount: sql`${eventRegistrationAddonPurchaseLots.refundAllocatedGrossAmount} + ${grossAllocation}`,
                  refundAllocatedNetAmount: sql`${eventRegistrationAddonPurchaseLots.refundAllocatedNetAmount} + ${netAllocation}`,
                  refundAllocatedQuantity: sql`${eventRegistrationAddonPurchaseLots.refundAllocatedQuantity} + ${quantity}`,
                })
                .where(eq(eventRegistrationAddonPurchaseLots.id, lot.id));
              refundAllocatedQuantity += quantity;
            }
            if (selectedIncludedQuantity > 0) {
              yield* tx
                .insert(eventRegistrationAddonFulfillmentAllocations)
                .values({
                  fulfillmentEventId,
                  purchaseId: locked.purchase.id,
                  quantity: selectedIncludedQuantity,
                  source: 'included',
                  tenantId: input.tenantId,
                });
            }
            yield* tx
              .update(eventRegistrationAddonPurchases)
              .set({
                cancelledQuantity: sql`${eventRegistrationAddonPurchases.cancelledQuantity} + ${input.quantity}`,
                ...(refundAllocatedQuantity > 0 && {
                  refundAllocatedPurchasedQuantity: sql`${eventRegistrationAddonPurchases.refundAllocatedPurchasedQuantity} + ${refundAllocatedQuantity}`,
                }),
              })
              .where(
                eq(eventRegistrationAddonPurchases.id, locked.purchase.id),
              );
            yield* tx
              .update(eventAddons)
              .set({
                totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${input.quantity}`,
              })
              .where(
                and(
                  eq(eventAddons.id, locked.purchase.addonId),
                  eq(eventAddons.eventId, locked.registration.eventId),
                ),
              );
            return {
              fulfillmentEventId,
              refundStatus: input.refundRequested
                ? claims.length > 0
                  ? 'pending'
                  : 'notRequired'
                : selectedLots.length === 0
                  ? 'notRequired'
                  : 'cancelledWithoutRefund',
            } as const;
          }),
        ),
      ),
      'Registration add-on could not be cancelled',
    );
  },
);
