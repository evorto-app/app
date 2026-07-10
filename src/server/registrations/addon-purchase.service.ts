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
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import { and, eq, sql } from 'drizzle-orm';
import { Effect } from 'effect';

import { getServerNow } from '../clock';
import {
  buildCheckoutSessionExpiresAt,
  createHostedCheckoutSession,
  expireHostedCheckoutSession,
} from '../integrations/stripe-checkout';
import { resolveAddonTaxAmounts } from '../payments/addon-payment-allocation';
import { tenantOutboundUrl } from '../tenant-outbound-url';
import { registrationCheckoutInitialReconcileAt } from './registration-checkout-completion';
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
  readonly applicationFeeAmount: number;
  readonly currency: typeof transactions.$inferSelect.currency;
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
    message: 'Registration or optional add-on not found',
  });

const mapStorageError = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  message: string,
): Effect.Effect<
  A,
  | EventRegistrationConflictError
  | EventRegistrationInternalError
  | EventRegistrationNotFoundError,
  R
> =>
  effect.pipe(
    Effect.mapError((error) =>
      error instanceof EventRegistrationConflictError ||
      error instanceof EventRegistrationInternalError ||
      error instanceof EventRegistrationNotFoundError
        ? error
        : internal(message, error),
    ),
  );

const validateOperationKey = (operationKey: string) => {
  const normalized = operationKey.trim();
  return normalized.length > 0 && normalized.length <= 100
    ? Effect.succeed(normalized)
    : Effect.fail(
        conflict('Operation key must contain between 1 and 100 characters'),
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
  readonly maxQuantityPerUser: number;
  readonly optionalPurchaseQuantity: number;
  readonly pendingOptionalQuantity: number;
  readonly purchasedOptionalQuantity: number;
  readonly requestedQuantity: number;
  readonly stock: number;
}): RegistrationAddonPurchaseCapacity => {
  const integers = [
    input.maxQuantityPerUser,
    input.optionalPurchaseQuantity,
    input.pendingOptionalQuantity,
    input.purchasedOptionalQuantity,
    input.requestedQuantity,
    input.stock,
  ];
  if (
    integers.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    input.requestedQuantity === 0
  ) {
    return 'invalid_quantity';
  }
  const existingOptionalQuantity =
    input.purchasedOptionalQuantity + input.pendingOptionalQuantity;
  const requestedTotal = existingOptionalQuantity + input.requestedQuantity;
  if (!Number.isSafeInteger(requestedTotal)) return 'invalid_quantity';
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
      return 'Add-on quantity must be a positive integer';
    }
    case 'multiple_not_allowed': {
      return 'This add-on can only be purchased once per registration';
    }
    case 'option_limit_exceeded': {
      return 'This registration option does not allow that many optional add-ons';
    }
    case 'out_of_stock': {
      return 'This add-on no longer has enough stock';
    }
    case 'user_limit_exceeded': {
      return 'This add-on exceeds the per-user purchase limit';
    }
  }
};

const lockRegistration = Effect.fn('lockAddonPurchaseRegistration')(function* (
  tx: Pick<DatabaseClient, 'select'>,
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
      'Only a confirmed registration can purchase optional add-ons',
    );
  }
  yield* ensureRegistrationMutationHasNoActiveTransfer(tx, {
    registrationId: input.registrationId,
    tenantId: input.tenantId,
  }).pipe(
    Effect.mapError(() =>
      conflict(
        'Resolve or cancel the active registration transfer before purchasing add-ons',
      ),
    ),
  );
  return registration;
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
        'This operation key was already used for a different add-on purchase',
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
        'This add-on purchase checkout expired. Start a new purchase.',
      );
    }
    if (
      !transaction ||
      transaction.id !== order.transactionId ||
      transaction.type !== 'addon' ||
      transaction.method !== 'stripe' ||
      transaction.status !== 'pending' ||
      !transaction.stripeAccountId ||
      !transaction.stripeCheckoutRequest ||
      !order.expiresAt
    ) {
      return yield* internal(
        'Pending add-on purchase payment ownership is inconsistent',
      );
    }
    if (transaction.stripeCheckoutSessionId) {
      if (!transaction.stripeCheckoutUrl) {
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
      _tag: 'PaymentClaim',
      applicationFeeAmount: order.applicationFeeAmount,
      currency: order.currency,
      expiresAt: order.expiresAt,
      orderId: order.id,
      registrationId: order.registrationId,
      request: transaction.stripeCheckoutRequest,
      stripeAccountId: transaction.stripeAccountId,
      tenantId: order.tenantId,
      transactionId: transaction.id,
      userId: order.requestedByUserId,
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
      'This registration already has an add-on payment in progress',
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
      'Optional add-ons can only be purchased for an approved event',
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
    return yield* conflict(
      'This add-on is not available for purchase at this time',
    );
  }

  const taxRows = addon.stripeTaxRateId
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
            eq(tenantStripeTaxRates.stripeTaxRateId, addon.stripeTaxRateId),
            eq(tenantStripeTaxRates.active, true),
          ),
        )
        .for('update')
    : [];
  const taxRate = taxRows[0];
  if (addon.stripeTaxRateId && (!taxRate || taxRate.percentage === null)) {
    return yield* conflict(
      'This add-on has an incomplete or inactive Stripe tax configuration',
    );
  }
  const taxRateInclusive = taxRate?.inclusive ?? null;
  const taxRatePercentage = taxRate?.percentage ?? null;
  const capacity = registrationAddonPurchaseCapacity({
    allowMultiple: addon.allowMultiple,
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
    return yield* conflict('This add-on no longer has enough stock');
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
    return {
      _tag: 'Completed',
      orderId,
    } satisfies AddonPurchaseReservation;
  }

  if (!tenant.stripeAccountId) {
    return yield* internal('Stripe is not configured for this add-on purchase');
  }
  const purchaser = (yield* tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1))[0];
  if (!purchaser) return yield* notFound();
  const eventUrl = yield* tenantOutboundUrl(
    { domain: tenant.domain, id: input.tenantId },
    `/events/${encodeURIComponent(registration.eventId)}`,
  ).pipe(
    Effect.mapError((cause) =>
      internal('Add-on purchase return URL could not be created', cause),
    ),
  );
  const expiresAtEpoch = buildCheckoutSessionExpiresAt(30);
  const expiresAt = new Date(expiresAtEpoch * 1000);
  const transactionId = createId();
  const request = {
    customerEmail: purchaser.email,
    eventTitle: addon.eventTitle,
    eventUrl,
    expiresAt: expiresAtEpoch,
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
    notificationEmail: purchaser.email,
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
    expiresAt,
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
    applicationFeeAmount: amounts.applicationFeeAmount,
    currency: tenant.currency,
    expiresAt,
    orderId,
    registrationId: input.registrationId,
    request,
    stripeAccountId: tenant.stripeAccountId,
    tenantId: input.tenantId,
    transactionId,
    userId: input.userId,
  } satisfies AddonPurchaseReservation;
});

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
  metadata: {
    addonPurchaseOrderId: claim.orderId,
    registrationId: claim.registrationId,
    tenantId: claim.tenantId,
    transactionId: claim.transactionId,
    userId: claim.userId,
  },
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
    session: Stripe.Checkout.Session,
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
                stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
              })
              .from(transactions)
              .where(
                and(
                  eq(transactions.id, claim.transactionId),
                  eq(transactions.eventRegistrationId, claim.registrationId),
                  eq(transactions.method, 'stripe'),
                  eq(transactions.status, 'pending'),
                  eq(transactions.stripeAccountId, claim.stripeAccountId),
                  eq(transactions.tenantId, claim.tenantId),
                  eq(transactions.type, 'addon'),
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
              !order ||
              order.status !== 'pending_payment' ||
              order.transactionId !== claim.transactionId
            ) {
              return { _tag: 'Unavailable' as const };
            }
            if (
              transaction.stripeCheckoutSessionId &&
              transaction.stripeCheckoutSessionId !== session.id
            ) {
              return yield* internal(
                'Add-on payment is bound to a different Checkout session',
              );
            }
            if (!session.url) {
              return yield* internal(
                'Stripe Checkout did not provide an add-on payment URL',
              );
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
                stripePaymentIntentId:
                  typeof session.payment_intent === 'string'
                    ? session.payment_intent
                    : session.payment_intent?.id,
              })
              .where(
                and(
                  eq(transactions.id, claim.transactionId),
                  eq(transactions.status, 'pending'),
                  eq(transactions.type, 'addon'),
                ),
              )
              .returning({ id: transactions.id });
            return updated.length === 1
              ? { _tag: 'Bound' as const, checkoutUrl: session.url }
              : { _tag: 'Unavailable' as const };
          }),
        ),
      ),
      'Add-on checkout binding failed',
    );
  },
);

export const purchaseRegistrationAddon = Effect.fn('purchaseRegistrationAddon')(
  function* (input: PurchaseRegistrationAddonInput) {
    const operationKey = yield* validateOperationKey(input.operationKey);
    const now = yield* Effect.try({
      catch: (cause) => internal('Server clock is invalid', cause),
      try: () => getServerNow(undefined).toJSDate(),
    });
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

    const session = yield* createHostedCheckoutSession(
      buildAddonPurchaseCheckoutParameters(reservation),
      {
        idempotencyKey: `addon-purchase:${reservation.orderId}:transaction:${reservation.transactionId}`,
        stripeAccount: reservation.stripeAccountId,
      },
    ).pipe(
      Effect.mapError((cause) =>
        internal(
          'Add-on payment setup is still pending. Retry without creating another order.',
          cause,
        ),
      ),
    );
    const binding = yield* bindAddonPurchaseCheckout(reservation, session);
    if (binding._tag === 'Unavailable') {
      yield* expireHostedCheckoutSession(
        session.id,
        reservation.stripeAccountId,
      ).pipe(
        Effect.mapError((cause) =>
          internal(
            'The add-on reservation changed, but its Checkout session could not be expired',
            cause,
          ),
        ),
      );
      return yield* conflict(
        'The add-on purchase is no longer awaiting payment',
      );
    }
    return {
      checkoutUrl: binding.checkoutUrl,
      expiresAt: reservation.expiresAt,
      orderId: reservation.orderId,
      status: 'checkout_required',
    } satisfies PurchaseRegistrationAddonResult;
  },
);
