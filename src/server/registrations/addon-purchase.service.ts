import type Stripe from 'stripe';

import { createId } from '@db/create-id';
import { Database, type DatabaseClient } from '@db/index';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchaseOrders,
  eventRegistrationAddonPurchases,
  eventRegistrations,
  type RegistrationCheckoutSnapshot,
  tenants,
  tenantStripeTaxRates,
  transactions,
  users,
} from '@db/schema';
import { MAX_REGISTRATION_ADDON_QUANTITY } from '@shared/registration-quantity-limits';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import { stripeCheckoutUrlMatchesSession } from '@shared/stripe-checkout-url';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Cause, Effect, Exit } from 'effect';

import { getServerNow } from '../clock';
import {
  buildCheckoutSessionExpiresAt,
  createHostedCheckoutSession,
  expireHostedCheckoutSession,
} from '../integrations/stripe-checkout';
import { resolveAddonTaxAmounts } from '../payments/addon-payment-allocation';
import { tenantOutboundUrl } from '../tenant-outbound-url';
import { safeServerErrorSummary } from '../utils/safe-server-error-summary';
import { recordCheckoutSessionIncident } from './checkout-session-incident';
import {
  appendAddonLotAcquisitionComponent,
  settleAcquisitionComponentTerms,
} from './registration-acquisition-write';
import { registrationCheckoutInitialReconcileAt } from './registration-checkout-completion';
import {
  addonPurchaseCheckoutMetadataOwnsIdentity,
  buildAddonPurchaseCheckoutMetadata,
} from './registration-checkout-metadata';
import { ensureRegistrationMutationHasNoActiveTransfer } from './registration-transfer-mutation-guard';

export interface PurchaseRegistrationAddonInput {
  readonly addonId: string;
  readonly operationKey: string;
  readonly quantity: number;
  readonly registrationId: string;
  readonly tenantId: string;
  readonly userId: string;
}

export type PurchaseRegistrationAddonResult =
  | {
      readonly checkoutUrl: string;
      readonly expiresAt: Date;
      readonly orderId: string;
      readonly status: 'checkout_required';
    }
  | {
      readonly orderId: string;
      readonly status: 'completed';
    };

export type RegistrationAddonPurchaseCapacity =
  | 'available'
  | 'invalid_quantity'
  | 'multiple_not_allowed'
  | 'option_limit_exceeded'
  | 'out_of_stock'
  | 'user_limit_exceeded';

export type RegistrationAddonPurchaseWindow = 'before_event' | 'during_event';

interface AddonPurchasePaymentClaim {
  readonly amount: number;
  readonly applicationFeeAmount: number;
  readonly currency: typeof transactions.$inferSelect.currency;
  readonly eventId: string;
  readonly expiresAt: Date;
  readonly orderId: string;
  readonly registrationId: string;
  readonly request: RegistrationCheckoutSnapshot;
  readonly stripeAccountId: string;
  readonly tenantId: string;
  readonly transactionId: string;
  readonly userId: string;
}

type AddonPurchaseReservation =
  | (AddonPurchasePaymentClaim & { readonly _tag: 'PaymentClaim' })
  | {
      readonly _tag: 'BoundCheckout';
      readonly checkoutUrl: string;
      readonly expiresAt: Date;
      readonly orderId: string;
    }
  | {
      readonly _tag: 'Completed';
      readonly orderId: string;
    }
  | {
      readonly _tag: 'UnboundCheckout';
      readonly orderId: string;
    };

const addonCheckoutNeedsAttentionMessage =
  'This add-on payment needs attention. Contact an organizer before trying again.';

const conflict = (message: string) =>
  new EventRegistrationConflictError({ message });
const internal = (message: string) =>
  new EventRegistrationInternalError({ message });
const notFound = () =>
  new EventRegistrationNotFoundError({
    message:
      'This ticket or add-on is no longer available. No purchase was started. Reopen the ticket and review its current add-ons.',
  });

const failInternal = (operation: string, message: string, error: unknown) =>
  Effect.logError(message).pipe(
    Effect.annotateLogs(safeServerErrorSummary(operation, error)),
    Effect.andThen(Effect.fail(internal(message))),
  );

const mapStorageError = <A, R>(
  effect: Effect.Effect<A, unknown, R>,
  operation: string,
  message: string,
): Effect.Effect<
  A,
  | EventRegistrationConflictError
  | EventRegistrationInternalError
  | EventRegistrationNotFoundError,
  R
> =>
  effect.pipe(
    Effect.catch(
      (
        error,
      ): Effect.Effect<
        never,
        | EventRegistrationConflictError
        | EventRegistrationInternalError
        | EventRegistrationNotFoundError
      > =>
        error instanceof EventRegistrationConflictError ||
        error instanceof EventRegistrationInternalError ||
        error instanceof EventRegistrationNotFoundError
          ? Effect.fail(error)
          : failInternal(operation, message, error),
    ),
  );

const validateOperationKey = (operationKey: string) => {
  const normalized = operationKey.trim();
  return normalized.length > 0 && normalized.length <= 100
    ? Effect.succeed(normalized)
    : Effect.fail(
        conflict(
          'The purchase could not be started. No purchase was created. Reopen the ticket and review its current add-ons before trying again.',
        ),
      );
};

export const resolveRegistrationAddonPurchaseWindow = (input: {
  readonly allowPurchaseBeforeEvent: boolean;
  readonly allowPurchaseDuringEvent: boolean;
  readonly end: Date;
  readonly now: Date;
  readonly start: Date;
}): RegistrationAddonPurchaseWindow | undefined => {
  if (input.now < input.start) {
    return input.allowPurchaseBeforeEvent ? 'before_event' : undefined;
  }
  if (input.now < input.end) {
    return input.allowPurchaseDuringEvent ? 'during_event' : undefined;
  }
  return;
};

export const registrationAddonPurchaseCapacity = (input: {
  readonly allowMultiple: boolean;
  readonly includedQuantity: number;
  readonly maxQuantityPerUser: number;
  readonly optionalPurchaseQuantity: number;
  readonly pendingOptionalQuantity: number;
  readonly purchasedOptionalQuantity: number;
  readonly requestedQuantity: number;
  readonly stock: number;
}): RegistrationAddonPurchaseCapacity => {
  const integers = [
    input.includedQuantity,
    input.maxQuantityPerUser,
    input.optionalPurchaseQuantity,
    input.pendingOptionalQuantity,
    input.purchasedOptionalQuantity,
    input.requestedQuantity,
    input.stock,
  ];
  if (
    integers.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    input.requestedQuantity === 0 ||
    input.requestedQuantity > MAX_REGISTRATION_ADDON_QUANTITY
  ) {
    return 'invalid_quantity';
  }
  const existingOptionalQuantity =
    input.purchasedOptionalQuantity + input.pendingOptionalQuantity;
  const requestedTotal = existingOptionalQuantity + input.requestedQuantity;
  if (!Number.isSafeInteger(requestedTotal)) return 'invalid_quantity';
  if (
    input.includedQuantity + requestedTotal >
    MAX_REGISTRATION_ADDON_QUANTITY
  ) {
    return 'user_limit_exceeded';
  }
  if (!input.allowMultiple && requestedTotal > 1) {
    return 'multiple_not_allowed';
  }
  if (requestedTotal > input.optionalPurchaseQuantity) {
    return 'option_limit_exceeded';
  }
  if (requestedTotal > input.maxQuantityPerUser) {
    return 'user_limit_exceeded';
  }
  if (input.requestedQuantity > input.stock) return 'out_of_stock';
  return 'available';
};

export const resolveRegistrationAddonPurchaseAmounts = (input: {
  readonly quantity: number;
  readonly taxRateInclusive: boolean | null;
  readonly taxRatePercentage: null | string;
  readonly unitPrice: number;
}):
  | undefined
  | {
      readonly applicationFeeAmount: number;
      readonly baseAmount: number;
      readonly expectedGrossAmount: number;
      readonly taxAmount: number;
    } => {
  if (
    !Number.isSafeInteger(input.quantity) ||
    input.quantity <= 0 ||
    !Number.isSafeInteger(input.unitPrice) ||
    input.unitPrice < 0
  ) {
    return;
  }
  const baseAmount = input.quantity * input.unitPrice;
  if (!Number.isSafeInteger(baseAmount)) return;
  const tax = resolveAddonTaxAmounts({
    baseAmount,
    taxRateInclusive: input.taxRateInclusive,
    taxRatePercentage: input.taxRatePercentage,
  });
  if (!tax) return;
  const applicationFeeAmount = Math.round(tax.expectedGrossAmount * 0.035);
  if (!Number.isSafeInteger(applicationFeeAmount)) return;
  return { applicationFeeAmount, baseAmount, ...tax };
};

const capacityConflictMessage = (
  capacity: Exclude<RegistrationAddonPurchaseCapacity, 'available'>,
) => {
  switch (capacity) {
    case 'invalid_quantity': {
      return 'Choose a whole number greater than zero.';
    }
    case 'multiple_not_allowed': {
      return 'You can buy this add-on only once for this ticket.';
    }
    case 'option_limit_exceeded': {
      return 'This ticket cannot have that many of this add-on.';
    }
    case 'out_of_stock': {
      return 'There are not enough of this add-on left.';
    }
    case 'user_limit_exceeded': {
      return 'You have reached the purchase limit for this add-on.';
    }
  }
};

const lockRegistration = Effect.fn('lockAddonPurchaseRegistration')(function* (
  tx: Pick<DatabaseClient, 'insert' | 'select' | 'update'>,
  input: Pick<
    PurchaseRegistrationAddonInput,
    'registrationId' | 'tenantId' | 'userId'
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
  if (!registration || registration.userId !== input.userId) {
    return yield* notFound();
  }
  if (registration.status !== 'CONFIRMED') {
    return yield* conflict(
      'You can only buy add-ons after the ticket is confirmed.',
    );
  }
  const purchaser = (yield* tx
    .select({
      communicationEmail: users.communicationEmail,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, registration.userId))
    .limit(1))[0];
  if (!purchaser) {
    return yield* internal(
      'The ticket owner could not be verified. No add-on purchase was started. Reopen the ticket and try again.',
    );
  }
  yield* ensureRegistrationMutationHasNoActiveTransfer(tx, {
    registrationId: input.registrationId,
    tenantId: input.tenantId,
  }).pipe(
    Effect.mapError(() =>
      conflict('Finish or cancel the ticket transfer before buying add-ons.'),
    ),
  );
  return {
    ...registration,
    communicationEmail: purchaser.communicationEmail.trim() || purchaser.email,
  };
});

const replayReservation = Effect.fn('replayAddonPurchaseReservation')(
  function* (
    tx: Pick<DatabaseClient, 'select'>,
    input: PurchaseRegistrationAddonInput & { readonly operationKey: string },
  ) {
    const replayCandidates = yield* tx
      .select()
      .from(eventRegistrationAddonPurchaseOrders)
      .where(
        and(
          eq(eventRegistrationAddonPurchaseOrders.tenantId, input.tenantId),
          eq(
            eventRegistrationAddonPurchaseOrders.registrationId,
            input.registrationId,
          ),
          eq(
            eventRegistrationAddonPurchaseOrders.operationKey,
            input.operationKey,
          ),
        ),
      )
      .limit(1);
    const candidate = replayCandidates[0];
    if (!candidate) return;

    const transaction = candidate.transactionId
      ? (yield* tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.id, candidate.transactionId),
              eq(transactions.eventRegistrationId, input.registrationId),
              eq(transactions.tenantId, input.tenantId),
            ),
          )
          .for('update'))[0]
      : undefined;
    const order = (yield* tx
      .select()
      .from(eventRegistrationAddonPurchaseOrders)
      .where(eq(eventRegistrationAddonPurchaseOrders.id, candidate.id))
      .for('update'))[0];
    if (!order) return yield* internal('Add-on purchase replay disappeared');
    if (
      order.addonId !== input.addonId ||
      order.quantity !== input.quantity ||
      order.requestedByUserId !== input.userId
    ) {
      return yield* conflict(
        'This add-on purchase no longer matches the ticket. No new purchase was started. Reopen the ticket and review its current add-ons before starting again.',
      );
    }
    if (order.status === 'completed') {
      return {
        _tag: 'Completed',
        orderId: order.id,
      } satisfies AddonPurchaseReservation;
    }
    if (order.status === 'expired') {
      return yield* conflict(
        'The time to pay for this add-on ran out. Start the purchase again.',
      );
    }
    if (
      !transaction ||
      transaction.id !== order.transactionId ||
      transaction.type !== 'addon' ||
      transaction.method !== 'stripe' ||
      transaction.status !== 'pending' ||
      transaction.eventId !== order.eventId ||
      transaction.targetUserId !== order.requestedByUserId ||
      transaction.amount !== order.expectedGrossAmount ||
      transaction.appFee !== order.applicationFeeAmount ||
      transaction.currency !== order.currency ||
      !transaction.stripeAccountId ||
      !transaction.stripeCheckoutRequest ||
      !order.expiresAt
    ) {
      return yield* internal(
        'Pending add-on purchase payment ownership is inconsistent',
      );
    }
    if (
      transaction.stripeCheckoutIncidentSessionId !== null ||
      transaction.stripeCheckoutCancellationRequestedAt !== null
    ) {
      return yield* internal(addonCheckoutNeedsAttentionMessage);
    }
    if (transaction.stripeCheckoutSessionId) {
      if (
        !transaction.stripeCheckoutUrl ||
        !stripeCheckoutUrlMatchesSession(
          transaction.stripeCheckoutUrl,
          transaction.stripeCheckoutSessionId,
        )
      ) {
        return yield* internal(
          'Bound add-on purchase Checkout is missing its URL',
        );
      }
      return {
        _tag: 'BoundCheckout',
        checkoutUrl: transaction.stripeCheckoutUrl,
        expiresAt: order.expiresAt,
        orderId: order.id,
      } satisfies AddonPurchaseReservation;
    }
    return {
      _tag: 'UnboundCheckout',
      orderId: order.id,
    } satisfies AddonPurchaseReservation;
  },
);

const reserveRegistrationAddonPurchase = Effect.fn(
  'reserveRegistrationAddonPurchase',
)(function* (
  tx: Pick<DatabaseClient, 'insert' | 'select' | 'update'>,
  input: PurchaseRegistrationAddonInput & {
    readonly now: Date;
    readonly operationKey: string;
  },
) {
  const registration = yield* lockRegistration(tx, input);
  const replay = yield* replayReservation(tx, input);
  if (replay) return replay;

  const pendingCandidates = yield* tx
    .select({
      id: eventRegistrationAddonPurchaseOrders.id,
      transactionId: eventRegistrationAddonPurchaseOrders.transactionId,
    })
    .from(eventRegistrationAddonPurchaseOrders)
    .where(
      and(
        eq(eventRegistrationAddonPurchaseOrders.tenantId, input.tenantId),
        eq(
          eventRegistrationAddonPurchaseOrders.registrationId,
          input.registrationId,
        ),
        eq(eventRegistrationAddonPurchaseOrders.status, 'pending_payment'),
      ),
    )
    .limit(1);
  const pendingCandidate = pendingCandidates[0];
  if (pendingCandidate?.transactionId) {
    yield* tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, pendingCandidate.transactionId))
      .for('update');
    yield* tx
      .select({ id: eventRegistrationAddonPurchaseOrders.id })
      .from(eventRegistrationAddonPurchaseOrders)
      .where(eq(eventRegistrationAddonPurchaseOrders.id, pendingCandidate.id))
      .for('update');
    return yield* conflict(
      'This ticket already has an add-on payment in progress. Finish it before starting another.',
    );
  }

  const existingPurchases = yield* tx
    .select()
    .from(eventRegistrationAddonPurchases)
    .where(
      and(
        eq(
          eventRegistrationAddonPurchases.registrationId,
          input.registrationId,
        ),
        eq(eventRegistrationAddonPurchases.addonId, input.addonId),
        eq(eventRegistrationAddonPurchases.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const existingPurchase = existingPurchases[0];

  const lockedTenants = yield* tx
    .select({
      currency: tenants.currency,
      domain: tenants.domain,
      stripeAccountId: tenants.stripeAccountId,
    })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .for('update');
  const tenant = lockedTenants[0];
  if (!tenant)
    return yield* internal('Tenant not found during add-on purchase');

  const addonRows = yield* tx
    .select({
      allowMultiple: eventAddons.allowMultiple,
      allowPurchaseBeforeEvent: eventAddons.allowPurchaseBeforeEvent,
      allowPurchaseDuringEvent: eventAddons.allowPurchaseDuringEvent,
      end: eventInstances.end,
      eventStatus: eventInstances.status,
      eventTitle: eventInstances.title,
      isPaid: eventAddons.isPaid,
      maxQuantityPerUser: eventAddons.maxQuantityPerUser,
      optionalPurchaseQuantity:
        addonToEventRegistrationOptions.optionalPurchaseQuantity,
      price: eventAddons.price,
      start: eventInstances.start,
      stripeTaxRateId: eventAddons.stripeTaxRateId,
      title: eventAddons.title,
      totalAvailableQuantity: eventAddons.totalAvailableQuantity,
    })
    .from(eventAddons)
    .innerJoin(
      addonToEventRegistrationOptions,
      and(
        eq(addonToEventRegistrationOptions.addonId, eventAddons.id),
        eq(
          addonToEventRegistrationOptions.registrationOptionId,
          registration.registrationOptionId,
        ),
        eq(addonToEventRegistrationOptions.eventId, registration.eventId),
      ),
    )
    .innerJoin(
      eventInstances,
      and(
        eq(eventInstances.id, eventAddons.eventId),
        eq(eventInstances.tenantId, input.tenantId),
      ),
    )
    .where(
      and(
        eq(eventAddons.id, input.addonId),
        eq(eventAddons.eventId, registration.eventId),
      ),
    )
    .for('update');
  const addon = addonRows[0];
  if (!addon || addon.optionalPurchaseQuantity <= 0) return yield* notFound();
  if (addon.eventStatus !== 'APPROVED') {
    return yield* conflict(
      'This event is not open, so add-ons cannot be bought.',
    );
  }
  const window = resolveRegistrationAddonPurchaseWindow({
    allowPurchaseBeforeEvent: addon.allowPurchaseBeforeEvent,
    allowPurchaseDuringEvent: addon.allowPurchaseDuringEvent,
    end: addon.end,
    now: input.now,
    start: addon.start,
  });
  if (!window) {
    return yield* conflict('This add-on is not available to buy right now.');
  }

  const taxRows =
    addon.stripeTaxRateId && tenant.stripeAccountId
      ? yield* tx
          .select({
            displayName: tenantStripeTaxRates.displayName,
            inclusive: tenantStripeTaxRates.inclusive,
            percentage: tenantStripeTaxRates.percentage,
          })
          .from(tenantStripeTaxRates)
          .where(
            and(
              eq(tenantStripeTaxRates.tenantId, input.tenantId),
              eq(tenantStripeTaxRates.stripeAccountId, tenant.stripeAccountId),
              eq(tenantStripeTaxRates.stripeTaxRateId, addon.stripeTaxRateId),
              eq(tenantStripeTaxRates.active, true),
              eq(tenantStripeTaxRates.inclusive, true),
            ),
          )
          .for('update')
      : [];
  const taxRate = taxRows[0];
  if (
    (addon.isPaid && !addon.stripeTaxRateId) ||
    (addon.stripeTaxRateId && (!taxRate || taxRate.percentage === null))
  ) {
    return yield* conflict(
      "Online payment cannot be started because this add-on's tax details are no longer available. No add-on purchase or payment was started. Contact the organizer.",
    );
  }
  const taxRateInclusive = taxRate?.inclusive ?? null;
  const taxRatePercentage = taxRate?.percentage ?? null;
  const capacity = registrationAddonPurchaseCapacity({
    allowMultiple: addon.allowMultiple,
    includedQuantity: existingPurchase?.includedQuantity ?? 0,
    maxQuantityPerUser: addon.maxQuantityPerUser,
    optionalPurchaseQuantity: addon.optionalPurchaseQuantity,
    pendingOptionalQuantity: 0,
    purchasedOptionalQuantity: existingPurchase?.purchasedQuantity ?? 0,
    requestedQuantity: input.quantity,
    stock: addon.totalAvailableQuantity,
  });
  if (capacity !== 'available') {
    return yield* conflict(capacityConflictMessage(capacity));
  }
  const amounts = resolveRegistrationAddonPurchaseAmounts({
    quantity: input.quantity,
    taxRateInclusive,
    taxRatePercentage,
    unitPrice: addon.price,
  });
  if (!amounts) {
    return yield* internal('Add-on amount or tax snapshot is invalid');
  }
  const hasPaidPrice = addon.price > 0;
  if (addon.isPaid !== hasPaidPrice) {
    return yield* internal('Add-on paid status and price are inconsistent');
  }
  const paidCheckout = addon.isPaid
    ? (() => {
        const expiresAtEpoch = buildCheckoutSessionExpiresAt(30, {
          pinnedNowIso: input.now.toISOString(),
        });
        return {
          expiresAt: new Date(expiresAtEpoch * 1000),
          expiresAtEpoch,
        };
      })()
    : undefined;
  if (paidCheckout && paidCheckout.expiresAt > addon.end) {
    return yield* conflict(
      'There is not enough time to finish online payment before the event ends. No purchase was started.',
    );
  }

  const orderId = createId();
  const purchaseId = existingPurchase?.id ?? createId();
  const purchaseLotId = createId();
  const updatedStock = yield* tx
    .update(eventAddons)
    .set({
      totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} - ${input.quantity}`,
    })
    .where(
      and(
        eq(eventAddons.id, input.addonId),
        eq(eventAddons.eventId, registration.eventId),
        sql`${eventAddons.totalAvailableQuantity} >= ${input.quantity}`,
      ),
    )
    .returning({ id: eventAddons.id });
  if (updatedStock.length !== 1) {
    return yield* conflict('There are not enough of this add-on left.');
  }

  if (!addon.isPaid) {
    if (existingPurchase) {
      const updatedPurchases = yield* tx
        .update(eventRegistrationAddonPurchases)
        .set({
          purchasedQuantity: sql`${eventRegistrationAddonPurchases.purchasedQuantity} + ${input.quantity}`,
          quantity: sql`${eventRegistrationAddonPurchases.quantity} + ${input.quantity}`,
          taxRateDisplayName: taxRate?.displayName,
          taxRateInclusive,
          taxRatePercentage,
          unitPrice: addon.price,
        })
        .where(eq(eventRegistrationAddonPurchases.id, existingPurchase.id))
        .returning({ id: eventRegistrationAddonPurchases.id });
      if (updatedPurchases.length !== 1) {
        return yield* internal('Existing add-on entitlement changed');
      }
    } else {
      yield* tx.insert(eventRegistrationAddonPurchases).values({
        addonId: input.addonId,
        eventId: registration.eventId,
        id: purchaseId,
        includedQuantity: 0,
        purchasedQuantity: input.quantity,
        quantity: input.quantity,
        registrationId: input.registrationId,
        registrationOptionId: registration.registrationOptionId,
        taxRateDisplayName: taxRate?.displayName,
        taxRateInclusive,
        taxRatePercentage,
        tenantId: input.tenantId,
        unitPrice: addon.price,
      });
    }
    yield* tx.insert(eventRegistrationAddonPurchaseLots).values({
      applicationFeeAmount: 0,
      baseAmount: 0,
      currency: tenant.currency,
      eventId: registration.eventId,
      grossAmount: 0,
      id: purchaseLotId,
      netAmount: 0,
      paymentAllocationFinalizedAt: input.now,
      purchaseId,
      quantity: input.quantity,
      registrationId: input.registrationId,
      registrationOptionId: registration.registrationOptionId,
      sourceLineKey: `addon-order:${orderId}`,
      stripeFeeAmount: 0,
      taxAmount: 0,
      taxRateDisplayName: taxRate?.displayName,
      taxRateInclusive,
      taxRatePercentage,
      tenantId: input.tenantId,
      unitPrice: addon.price,
    });
    yield* tx.insert(eventRegistrationAddonPurchaseOrders).values({
      addonId: input.addonId,
      applicationFeeAmount: 0,
      baseAmount: 0,
      completedAt: input.now,
      currency: tenant.currency,
      eventId: registration.eventId,
      expectedGrossAmount: 0,
      id: orderId,
      operationKey: input.operationKey,
      purchaseId,
      purchaseLotId,
      quantity: input.quantity,
      registrationId: input.registrationId,
      registrationOptionId: registration.registrationOptionId,
      requestedByUserId: input.userId,
      status: 'completed',
      stripeTaxRateId: addon.stripeTaxRateId,
      taxRateDisplayName: taxRate?.displayName,
      taxRateInclusive,
      taxRatePercentage,
      tenantId: input.tenantId,
      unitPrice: addon.price,
      window,
    });
    const settledComponents = settleAcquisitionComponentTerms({
      terms: [
        {
          allocationKey: `addon-order:${orderId}`,
          baseAmount: 0,
          id: `addon-lot:${purchaseLotId}`,
          kind: 'addon_lot',
          purchaseId,
          purchaseLotId,
          quantity: input.quantity,
          taxRateDisplayName: taxRate?.displayName ?? null,
          taxRateInclusive,
          taxRatePercentage,
        },
      ],
    });
    const settledComponent = settledComponents?.[0];
    if (!settledComponent || settledComponent.kind !== 'addon_lot') {
      return yield* internal(
        'Free add-on acquisition terms are not zero-value',
      );
    }
    yield* appendAddonLotAcquisitionComponent(tx, {
      acquiredAt: input.now,
      component: settledComponent,
      currency: tenant.currency,
      eventId: registration.eventId,
      ownerUserId: registration.userId,
      registrationId: input.registrationId,
      tenantId: input.tenantId,
    }).pipe(
      Effect.catch((error) =>
        failInternal(
          'registrationAddonPurchase.persistFreeAcquisition',
          'Free add-on acquisition could not be persisted',
          error,
        ),
      ),
    );
    return {
      _tag: 'Completed',
      orderId,
    } satisfies AddonPurchaseReservation;
  }

  if (!tenant.stripeAccountId) {
    return yield* internal('Stripe is not configured for this add-on purchase');
  }
  if (!paidCheckout) {
    return yield* internal('Paid add-on Checkout expiry is missing');
  }
  const eventUrl = yield* tenantOutboundUrl(
    { domain: tenant.domain, id: input.tenantId },
    `/events/${encodeURIComponent(registration.eventId)}`,
  ).pipe(
    Effect.catch((error) =>
      failInternal(
        'registrationAddonPurchase.createReturnUrl',
        'Add-on purchase return URL could not be created',
        error,
      ),
    ),
  );
  const transactionId = createId();
  const request = {
    customerEmail: registration.communicationEmail,
    eventTitle: addon.eventTitle,
    eventUrl,
    expiresAt: paidCheckout.expiresAtEpoch,
    lineItems: [
      {
        addonId: input.addonId,
        allocationKey: `addon-order:${orderId}`,
        kind: 'addon',
        name: `${addon.title} add-on for ${addon.eventTitle}`,
        quantity: input.quantity,
        ...(addon.stripeTaxRateId && {
          taxRateId: addon.stripeTaxRateId,
        }),
        unitAmount: addon.price,
      },
    ],
    notificationEmail: registration.communicationEmail,
  } satisfies RegistrationCheckoutSnapshot;
  yield* tx.insert(transactions).values({
    amount: amounts.expectedGrossAmount,
    appFee: amounts.applicationFeeAmount,
    currency: tenant.currency,
    eventId: registration.eventId,
    eventRegistrationId: input.registrationId,
    id: transactionId,
    method: 'stripe',
    status: 'pending',
    stripeAccountId: tenant.stripeAccountId,
    stripeCheckoutRequest: request,
    targetUserId: input.userId,
    tenantId: input.tenantId,
    type: 'addon',
  });
  yield* tx.insert(eventRegistrationAddonPurchaseOrders).values({
    addonId: input.addonId,
    applicationFeeAmount: amounts.applicationFeeAmount,
    baseAmount: amounts.baseAmount,
    currency: tenant.currency,
    eventId: registration.eventId,
    expectedGrossAmount: amounts.expectedGrossAmount,
    expiresAt: paidCheckout.expiresAt,
    id: orderId,
    operationKey: input.operationKey,
    purchaseId,
    purchaseLotId,
    quantity: input.quantity,
    registrationId: input.registrationId,
    registrationOptionId: registration.registrationOptionId,
    requestedByUserId: input.userId,
    status: 'pending_payment',
    stripeTaxRateId: addon.stripeTaxRateId,
    taxRateDisplayName: taxRate?.displayName,
    taxRateInclusive,
    taxRatePercentage,
    tenantId: input.tenantId,
    transactionId,
    unitPrice: addon.price,
    window,
  });
  return {
    _tag: 'PaymentClaim',
    amount: amounts.expectedGrossAmount,
    applicationFeeAmount: amounts.applicationFeeAmount,
    currency: tenant.currency,
    eventId: registration.eventId,
    expiresAt: paidCheckout.expiresAt,
    orderId,
    registrationId: input.registrationId,
    request,
    stripeAccountId: tenant.stripeAccountId,
    tenantId: input.tenantId,
    transactionId,
    userId: input.userId,
  } satisfies AddonPurchaseReservation;
});

const addonPurchasePaymentClaimTuple = (claim: AddonPurchasePaymentClaim) =>
  and(
    eq(transactions.id, claim.transactionId),
    eq(transactions.amount, claim.amount),
    eq(transactions.appFee, claim.applicationFeeAmount),
    eq(transactions.currency, claim.currency),
    eq(transactions.eventId, claim.eventId),
    eq(transactions.eventRegistrationId, claim.registrationId),
    eq(transactions.method, 'stripe'),
    eq(transactions.stripeAccountId, claim.stripeAccountId),
    eq(transactions.stripeCheckoutRequest, claim.request),
    eq(transactions.targetUserId, claim.userId),
    eq(transactions.tenantId, claim.tenantId),
    eq(transactions.type, 'addon'),
  );

const buildAddonPurchaseCheckoutParameters = (
  claim: AddonPurchasePaymentClaim,
): Stripe.Checkout.SessionCreateParams => ({
  cancel_url: `${claim.request.eventUrl}?addonPurchaseStatus=cancel`,
  customer_email: claim.request.customerEmail,
  expires_at: claim.request.expiresAt,
  line_items: claim.request.lineItems.map((lineItem) => ({
    price_data: {
      currency: claim.currency,
      product_data: { name: lineItem.name },
      unit_amount: lineItem.unitAmount,
    },
    ...(lineItem.taxRateId && { tax_rates: [lineItem.taxRateId] }),
    quantity: lineItem.quantity,
  })),
  metadata: buildAddonPurchaseCheckoutMetadata({
    addonPurchaseOrderId: claim.orderId,
    registrationId: claim.registrationId,
    tenantId: claim.tenantId,
    transactionId: claim.transactionId,
    userId: claim.userId,
  }),
  mode: 'payment',
  ...(claim.applicationFeeAmount > 0 && {
    payment_intent_data: {
      application_fee_amount: claim.applicationFeeAmount,
    },
  }),
  success_url: `${claim.request.eventUrl}?addonPurchaseStatus=success`,
});

const bindAddonPurchaseCheckout = Effect.fn('bindAddonPurchaseCheckout')(
  function* (
    claim: AddonPurchasePaymentClaim,
    session: { readonly id: string; readonly url: string },
  ) {
    return yield* mapStorageError(
      Database.use((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            yield* lockRegistration(tx, {
              registrationId: claim.registrationId,
              tenantId: claim.tenantId,
              userId: claim.userId,
            });
            const lockedTransactions = yield* tx
              .select({
                stripeCheckoutCancellationRequestedAt:
                  transactions.stripeCheckoutCancellationRequestedAt,
                stripeCheckoutIncidentSessionId:
                  transactions.stripeCheckoutIncidentSessionId,
                stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
                stripeCheckoutUrl: transactions.stripeCheckoutUrl,
              })
              .from(transactions)
              .where(
                and(
                  addonPurchasePaymentClaimTuple(claim),
                  eq(transactions.status, 'pending'),
                ),
              )
              .for('update');
            const transaction = lockedTransactions[0];
            const lockedOrders = yield* tx
              .select({
                status: eventRegistrationAddonPurchaseOrders.status,
                transactionId:
                  eventRegistrationAddonPurchaseOrders.transactionId,
              })
              .from(eventRegistrationAddonPurchaseOrders)
              .where(
                and(
                  eq(eventRegistrationAddonPurchaseOrders.id, claim.orderId),
                  eq(
                    eventRegistrationAddonPurchaseOrders.eventId,
                    claim.eventId,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseOrders.requestedByUserId,
                    claim.userId,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseOrders.expectedGrossAmount,
                    claim.amount,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseOrders.applicationFeeAmount,
                    claim.applicationFeeAmount,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseOrders.currency,
                    claim.currency,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseOrders.registrationId,
                    claim.registrationId,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseOrders.tenantId,
                    claim.tenantId,
                  ),
                ),
              )
              .for('update');
            const order = lockedOrders[0];
            if (
              !transaction ||
              transaction.stripeCheckoutCancellationRequestedAt !== null ||
              transaction.stripeCheckoutIncidentSessionId !== null ||
              !order ||
              order.status !== 'pending_payment' ||
              order.transactionId !== claim.transactionId
            ) {
              return { _tag: 'Unavailable' as const };
            }
            if (
              transaction.stripeCheckoutSessionId === session.id &&
              transaction.stripeCheckoutUrl === session.url
            ) {
              return { _tag: 'Bound' as const, checkoutUrl: session.url };
            }
            if (
              transaction.stripeCheckoutSessionId !== null ||
              transaction.stripeCheckoutUrl !== null
            ) {
              return { _tag: 'Unavailable' as const };
            }
            const updated = yield* tx
              .update(transactions)
              .set({
                stripeCheckoutReconcileAttempts: 0,
                stripeCheckoutReconcileLastError: null,
                stripeCheckoutReconcileLeaseExpiresAt: null,
                stripeCheckoutReconcileLeaseId: null,
                stripeCheckoutReconcileNextAt:
                  registrationCheckoutInitialReconcileAt(),
                stripeCheckoutSessionId: session.id,
                stripeCheckoutUrl: session.url,
              })
              .where(
                and(
                  addonPurchasePaymentClaimTuple(claim),
                  eq(transactions.status, 'pending'),
                  isNull(transactions.stripeCheckoutCancellationRequestedAt),
                  isNull(transactions.stripeCheckoutIncidentSessionId),
                  isNull(transactions.stripeCheckoutSessionId),
                  isNull(transactions.stripeCheckoutUrl),
                ),
              )
              .returning({ id: transactions.id });
            return updated.length === 1
              ? { _tag: 'Bound' as const, checkoutUrl: session.url }
              : { _tag: 'Unavailable' as const };
          }),
        ),
      ).pipe(
        Effect.catchTag('EffectDrizzleQueryError', Effect.die),
        Effect.catchTag('SqlError', Effect.die),
      ),
      'registrationAddonPurchase.bindCheckout',
      'Add-on checkout binding failed',
    );
  },
);

const addonCheckoutBindingWasCommitted = Effect.fn(
  'addonCheckoutBindingWasCommitted',
)(function* (
  claim: AddonPurchasePaymentClaim,
  session: { readonly id: string; readonly url: string },
) {
  return yield* Database.use((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx
          .select({ id: eventRegistrations.id })
          .from(eventRegistrations)
          .where(
            and(
              eq(eventRegistrations.id, claim.registrationId),
              eq(eventRegistrations.tenantId, claim.tenantId),
            ),
          )
          .for('update');
        const claims = yield* tx
          .select({
            stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
            stripeCheckoutUrl: transactions.stripeCheckoutUrl,
          })
          .from(transactions)
          .where(addonPurchasePaymentClaimTuple(claim))
          .for('update');
        return (
          claims[0]?.stripeCheckoutSessionId === session.id &&
          claims[0].stripeCheckoutUrl === session.url
        );
      }),
    ),
  ).pipe(
    Effect.catchTag('EffectDrizzleQueryError', Effect.die),
    Effect.catchTag('SqlError', Effect.die),
  );
});

const createAddonPurchaseCheckout = Effect.fn('createAddonPurchaseCheckout')(
  function* (claim: AddonPurchasePaymentClaim) {
    const parameters = buildAddonPurchaseCheckoutParameters(claim);
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const session = yield* restore(
          createHostedCheckoutSession(parameters, {
            idempotencyKey: `addon-purchase:${claim.orderId}:transaction:${claim.transactionId}`,
            stripeAccount: claim.stripeAccountId,
          }).pipe(
            Effect.catch((error) =>
              failInternal(
                'registrationAddonPurchase.createCheckout',
                addonCheckoutNeedsAttentionMessage,
                error,
              ),
            ),
          ),
        );
        const sessionId = yield* Effect.sync(() => session.id);
        if (
          typeof sessionId !== 'string' ||
          sessionId.length === 0 ||
          sessionId.trim() !== sessionId
        ) {
          return yield* Effect.die(
            new Error('Stripe returned an add-on Checkout without an identity'),
          );
        }

        const stopCreatedSession = Effect.fn('stopCreatedAddonCheckout')(
          (operation: string) =>
            Effect.gen(function* () {
              const expiry = yield* Effect.exit(
                Effect.gen(function* () {
                  const expired = yield* expireHostedCheckoutSession(
                    sessionId,
                    claim.stripeAccountId,
                  ).pipe(
                    Effect.catch((error) =>
                      failInternal(
                        operation,
                        addonCheckoutNeedsAttentionMessage,
                        error,
                      ),
                    ),
                  );
                  if (
                    expired.id !== sessionId ||
                    expired.object !== 'checkout.session' ||
                    expired.mode !== 'payment' ||
                    expired.status !== 'expired' ||
                    expired.payment_status !== 'unpaid'
                  )
                    return yield* internal(addonCheckoutNeedsAttentionMessage);
                }),
              );
              if (Exit.isSuccess(expiry)) return 'stopped' as const;
              const incident = yield* Effect.exit(
                mapStorageError(
                  recordCheckoutSessionIncident({
                    amount: claim.amount,
                    appFee: claim.applicationFeeAmount,
                    currency: claim.currency,
                    eventId: claim.eventId,
                    method: 'stripe',
                    operation,
                    registrationId: claim.registrationId,
                    stripeAccountId: claim.stripeAccountId,
                    stripeCheckoutRequest: claim.request,
                    stripeCheckoutSessionId: sessionId,
                    targetUserId: claim.userId,
                    tenantId: claim.tenantId,
                    transactionId: claim.transactionId,
                    type: 'addon',
                  }).pipe(
                    Effect.catchTag('EffectDrizzleQueryError', Effect.die),
                  ),
                  operation,
                  addonCheckoutNeedsAttentionMessage,
                ),
              );
              if (Exit.isFailure(incident)) {
                return yield* Effect.failCause(
                  Cause.combine(expiry.cause, incident.cause),
                );
              }
              if (
                Cause.hasDies(expiry.cause) ||
                Cause.hasInterrupts(expiry.cause)
              ) {
                return yield* Effect.failCause(expiry.cause);
              }
              return 'incidentRecorded' as const;
            }),
        );
        const validation = yield* Effect.exit(
          Effect.sync(() => {
            const url = session.url;
            return session.object === 'checkout.session' &&
              session.mode === 'payment' &&
              session.status === 'open' &&
              session.payment_status === 'unpaid' &&
              session.payment_intent === null &&
              session.amount_total === claim.amount &&
              session.currency === claim.currency.toLowerCase() &&
              session.expires_at === claim.request.expiresAt &&
              session.customer_email === parameters.customer_email &&
              session.success_url === parameters.success_url &&
              session.cancel_url === parameters.cancel_url &&
              addonPurchaseCheckoutMetadataOwnsIdentity({
                identity: {
                  addonPurchaseOrderId: claim.orderId,
                  registrationId: claim.registrationId,
                  tenantId: claim.tenantId,
                  transactionId: claim.transactionId,
                  userId: claim.userId,
                },
                metadata: session.metadata,
              }) &&
              typeof url === 'string' &&
              stripeCheckoutUrlMatchesSession(url, sessionId)
              ? url
              : null;
          }),
        );
        if (Exit.isFailure(validation)) {
          const cleanup = yield* Effect.exit(
            stopCreatedSession('addon-checkout-validation-failed'),
          );
          return yield* Effect.failCause(
            Exit.isFailure(cleanup)
              ? Cause.combine(validation.cause, cleanup.cause)
              : validation.cause,
          );
        }
        const checkoutUrl = validation.value;
        if (checkoutUrl === null) {
          yield* stopCreatedSession('addon-checkout-invalid-created-session');
          return yield* internal(addonCheckoutNeedsAttentionMessage);
        }
        const validatedSession = { id: sessionId, url: checkoutUrl };
        const binding = yield* Effect.exit(
          bindAddonPurchaseCheckout(claim, validatedSession),
        );
        if (Exit.isFailure(binding)) {
          const committed = yield* Effect.exit(
            addonCheckoutBindingWasCommitted(claim, validatedSession),
          );
          if (Exit.isSuccess(committed) && committed.value) {
            return yield* Effect.failCause(binding.cause);
          }
          const cleanup = yield* Effect.exit(
            stopCreatedSession('addon-checkout-binding-failed'),
          );
          const bindingCause = Exit.isFailure(committed)
            ? Cause.combine(binding.cause, committed.cause)
            : binding.cause;
          return yield* Effect.failCause(
            Exit.isFailure(cleanup)
              ? Cause.combine(bindingCause, cleanup.cause)
              : bindingCause,
          );
        }
        if (binding.value._tag === 'Unavailable') {
          yield* stopCreatedSession('addon-checkout-reservation-changed');
          return yield* internal(addonCheckoutNeedsAttentionMessage);
        }
        return { checkoutUrl };
      }),
    );
  },
);

export const purchaseRegistrationAddon = Effect.fn('purchaseRegistrationAddon')(
  function* (input: PurchaseRegistrationAddonInput) {
    const operationKey = yield* validateOperationKey(input.operationKey);
    const now = yield* Effect.try({
      catch: (error) => error,
      try: () => getServerNow(undefined).toJSDate(),
    }).pipe(
      Effect.catch((error) =>
        failInternal(
          'registrationAddonPurchase.readClock',
          'Server clock is invalid',
          error,
        ),
      ),
    );
    const reservation = yield* mapStorageError(
      Database.use((database) =>
        database.transaction((tx) =>
          reserveRegistrationAddonPurchase(tx, {
            ...input,
            now,
            operationKey,
          }),
        ),
      ),
      'registrationAddonPurchase.reserve',
      'Add-on purchase reservation failed',
    );
    if (reservation._tag === 'Completed') {
      return {
        orderId: reservation.orderId,
        status: 'completed',
      } satisfies PurchaseRegistrationAddonResult;
    }
    if (reservation._tag === 'BoundCheckout') {
      return {
        checkoutUrl: reservation.checkoutUrl,
        expiresAt: reservation.expiresAt,
        orderId: reservation.orderId,
        status: 'checkout_required',
      } satisfies PurchaseRegistrationAddonResult;
    }
    if (reservation._tag === 'UnboundCheckout') {
      return yield* internal(addonCheckoutNeedsAttentionMessage);
    }
    const binding = yield* createAddonPurchaseCheckout(reservation);
    return {
      checkoutUrl: binding.checkoutUrl,
      expiresAt: reservation.expiresAt,
      orderId: reservation.orderId,
      status: 'checkout_required',
    } satisfies PurchaseRegistrationAddonResult;
  },
);
