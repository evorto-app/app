import type { DatabaseClient } from '@db/index';

import { createId } from '@db/create-id';
import {
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitions,
  transactions,
} from '@db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import {
  allocateIntegerByWeight,
  resolveAddonTaxAmounts,
} from '../payments/addon-payment-allocation';
import {
  deriveRegistrationPaymentFeeSnapshot,
  type RegistrationPaymentFeeSnapshot,
} from '../payments/registration-payment-fee-snapshot';
import { StripeClient } from '../stripe-client';

export type AcquisitionComponentTerm =
  AddonLotAcquisitionComponentTerm | RegistrationAcquisitionComponentTerm;

export interface AcquisitionPaymentInput {
  readonly settlement: AcquisitionPaymentSettlement;
  readonly stripeAccountId: string;
  readonly stripeChargeId: string;
  readonly stripePaymentIntentId: string;
  readonly transactionId: string;
  readonly type: AcquisitionPaymentType;
}
export interface AcquisitionPaymentSettlement {
  readonly applicationFeeAmount: number;
  readonly grossAmount: number;
  readonly stripeFeeAmount: number;
  readonly stripeNetAmount: number;
}
export interface AddonLotAcquisitionComponentTerm extends AcquisitionComponentTermBase {
  readonly kind: 'addon_lot';
  readonly purchaseId: string;
  readonly purchaseLotId: string;
}

export interface RegistrationAcquisitionComponentTerm extends AcquisitionComponentTermBase {
  readonly kind: 'registration';
}

export type SettledAcquisitionComponent = AcquisitionComponentTerm & {
  readonly applicationFeeAmount: number;
  readonly grossAmount: number;
  readonly netAmount: number;
  readonly stripeFeeAmount: number;
  readonly taxAmount: number;
};

interface AcquisitionComponentTermBase {
  readonly allocationKey: string;
  readonly baseAmount: number;
  readonly id: string;
  readonly quantity: number;
  readonly taxRateDisplayName: null | string;
  readonly taxRateInclusive: boolean | null;
  readonly taxRatePercentage: null | string;
}

type AcquisitionCurrency =
  typeof registrationAcquisitionComponents.$inferInsert.currency;

type AcquisitionKind = typeof registrationAcquisitions.$inferInsert.kind;

type AcquisitionPaymentType = Extract<
  typeof transactions.$inferSelect.type,
  'addon' | 'registration'
>;

type AcquisitionTransaction = Pick<DatabaseClient, 'insert' | 'select'>;

export class RegistrationAcquisitionWriteError extends Schema.TaggedErrorClass<RegistrationAcquisitionWriteError>()(
  'RegistrationAcquisitionWriteError',
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
  },
) {}

const acquisitionError = (message: string, cause?: unknown) =>
  new RegistrationAcquisitionWriteError({
    ...(cause !== undefined && { cause }),
    message,
  });

const validComponentTerm = (term: AcquisitionComponentTerm): boolean =>
  term.id.trim().length > 0 &&
  term.allocationKey.trim().length > 0 &&
  term.allocationKey.length <= 100 &&
  Number.isSafeInteger(term.baseAmount) &&
  term.baseAmount >= 0 &&
  Number.isSafeInteger(term.quantity) &&
  term.quantity > 0 &&
  (term.kind === 'registration' ||
    (term.purchaseId.trim().length > 0 &&
      term.purchaseLotId.trim().length > 0));

/**
 * Settles immutable acquisition component amounts against one exact payment.
 * A missing payment is valid only when every component is genuinely free.
 */
export const settleAcquisitionComponentTerms = (input: {
  readonly payment?: AcquisitionPaymentSettlement | undefined;
  readonly terms: readonly AcquisitionComponentTerm[];
}): readonly SettledAcquisitionComponent[] | undefined => {
  if (
    input.terms.length === 0 ||
    input.terms.some((term) => !validComponentTerm(term)) ||
    new Set(input.terms.map(({ id }) => id)).size !== input.terms.length ||
    new Set(input.terms.map(({ allocationKey }) => allocationKey)).size !==
      input.terms.length
  ) {
    return;
  }

  const expected = input.terms.flatMap((term) => {
    const amounts = resolveAddonTaxAmounts(term);
    return amounts ? [{ ...term, ...amounts }] : [];
  });
  if (expected.length !== input.terms.length) return;

  const expectedGrossAmount = expected.reduce(
    (total, component) => total + component.expectedGrossAmount,
    0,
  );
  if (!Number.isSafeInteger(expectedGrossAmount)) return;

  if (!input.payment) {
    if (expectedGrossAmount !== 0) return;
    return expected.map(
      ({ expectedGrossAmount: grossAmount, ...component }) => ({
        ...component,
        applicationFeeAmount: 0,
        grossAmount,
        netAmount: 0,
        stripeFeeAmount: 0,
      }),
    );
  }

  const payment = input.payment;
  if (
    !Number.isSafeInteger(payment.grossAmount) ||
    payment.grossAmount <= 0 ||
    payment.grossAmount !== expectedGrossAmount ||
    !Number.isSafeInteger(payment.applicationFeeAmount) ||
    payment.applicationFeeAmount < 0 ||
    !Number.isSafeInteger(payment.stripeFeeAmount) ||
    payment.stripeFeeAmount < 0 ||
    !Number.isSafeInteger(payment.stripeNetAmount) ||
    payment.stripeNetAmount < 0 ||
    payment.stripeNetAmount +
      payment.stripeFeeAmount +
      payment.applicationFeeAmount !==
      payment.grossAmount
  ) {
    return;
  }

  const weights = expected.map((component) => ({
    key: component.id,
    weight: component.expectedGrossAmount,
  }));
  let applicationFees: ReadonlyMap<string, number>;
  let stripeFees: ReadonlyMap<string, number>;
  try {
    applicationFees = allocateIntegerByWeight(
      payment.applicationFeeAmount,
      weights,
    );
    stripeFees = allocateIntegerByWeight(payment.stripeFeeAmount, weights);
  } catch {
    return;
  }

  const settled = expected.map(
    ({ expectedGrossAmount: grossAmount, ...component }) => {
      const applicationFeeAmount = applicationFees.get(component.id) ?? 0;
      const stripeFeeAmount = stripeFees.get(component.id) ?? 0;
      return {
        ...component,
        applicationFeeAmount,
        grossAmount,
        netAmount: grossAmount - applicationFeeAmount - stripeFeeAmount,
        stripeFeeAmount,
      } satisfies SettledAcquisitionComponent;
    },
  );
  return settled.some(({ netAmount }) => netAmount < 0) ? undefined : settled;
};

/** Resolves the settled connected-account fee snapshot before database locks. */
export const resolveStripeAcquisitionPaymentSettlement = Effect.fn(
  'resolveStripeAcquisitionPaymentSettlement',
)(function* (input: {
  readonly expectedCurrency: string;
  readonly expectedGrossAmount: number;
  readonly expectedPaymentIntentId: string;
  readonly stripeAccountId: string;
  readonly stripeChargeId: string;
}) {
  const stripe = yield* StripeClient;
  const charge = yield* Effect.tryPromise({
    catch: (cause) =>
      acquisitionError(
        'Stripe payment fees are not settled yet; retry completion',
        cause,
      ),
    try: () =>
      stripe.charges.retrieve(
        input.stripeChargeId,
        { expand: ['balance_transaction'] },
        { stripeAccount: input.stripeAccountId },
      ),
  });
  const snapshot = deriveRegistrationPaymentFeeSnapshot({
    charge,
    expectedCurrency: input.expectedCurrency,
    expectedGrossAmount: input.expectedGrossAmount,
    expectedPaymentIntentId: input.expectedPaymentIntentId,
  });
  if (!snapshot || snapshot.stripeChargeId !== input.stripeChargeId) {
    return yield* acquisitionError(
      'Stripe payment fee snapshot does not own this Checkout payment',
    );
  }
  return {
    applicationFeeAmount: snapshot.appFee,
    grossAmount: snapshot.grossAmount,
    stripeFeeAmount: snapshot.stripeFee,
    stripeNetAmount: snapshot.stripeNetAmount,
  } satisfies AcquisitionPaymentSettlement;
});

const paymentSettlementFromSnapshot = (
  snapshot: RegistrationPaymentFeeSnapshot,
): AcquisitionPaymentSettlement => ({
  applicationFeeAmount: snapshot.appFee,
  grossAmount: snapshot.grossAmount,
  stripeFeeAmount: snapshot.stripeFee,
  stripeNetAmount: snapshot.stripeNetAmount,
});

export const acquisitionPaymentSettlementFromSnapshot =
  paymentSettlementFromSnapshot;

const lockAndValidatePaymentSource = Effect.fn(
  'lockAndValidateAcquisitionPaymentSource',
)(function* (
  tx: Pick<DatabaseClient, 'select'>,
  input: {
    readonly currency: AcquisitionCurrency;
    readonly eventId: string;
    readonly ownerUserId: string;
    readonly payment: AcquisitionPaymentInput;
    readonly registrationId: string;
    readonly tenantId: string;
  },
) {
  const rows = yield* tx
    .select({
      amount: transactions.amount,
      appFee: transactions.appFee,
      currency: transactions.currency,
      eventId: transactions.eventId,
      method: transactions.method,
      registrationId: transactions.eventRegistrationId,
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
    .where(eq(transactions.id, input.payment.transactionId))
    .for('update');
  const source = rows[0];
  if (
    !source ||
    !acquisitionPaymentSourceMatches({
      currency: input.currency,
      eventId: input.eventId,
      ownerUserId: input.ownerUserId,
      payment: input.payment,
      registrationId: input.registrationId,
      source,
      tenantId: input.tenantId,
    })
  ) {
    return yield* acquisitionError(
      'Successful acquisition payment ownership or settlement changed',
    );
  }
});

export const acquisitionPaymentSourceMatches = (input: {
  readonly currency: AcquisitionCurrency;
  readonly eventId: string;
  readonly ownerUserId: string;
  readonly payment: AcquisitionPaymentInput;
  readonly registrationId: string;
  readonly source: {
    readonly amount: number;
    readonly appFee: null | number;
    readonly currency: AcquisitionCurrency;
    readonly eventId: null | string;
    readonly method: typeof transactions.$inferSelect.method;
    readonly registrationId: null | string;
    readonly status: typeof transactions.$inferSelect.status;
    readonly stripeAccountId: null | string;
    readonly stripeChargeId: null | string;
    readonly stripeFee: null | number;
    readonly stripeNetAmount: null | number;
    readonly stripePaymentIntentId: null | string;
    readonly targetUserId: null | string;
    readonly tenantId: string;
    readonly type: typeof transactions.$inferSelect.type;
  };
  readonly tenantId: string;
}): boolean => {
  const { settlement } = input.payment;
  return (
    input.source.amount === settlement.grossAmount &&
    input.source.appFee === settlement.applicationFeeAmount &&
    input.source.currency === input.currency &&
    input.source.eventId === input.eventId &&
    input.source.method === 'stripe' &&
    input.source.registrationId === input.registrationId &&
    input.source.status === 'successful' &&
    input.source.stripeAccountId === input.payment.stripeAccountId &&
    input.source.stripeChargeId === input.payment.stripeChargeId &&
    input.source.stripeFee === settlement.stripeFeeAmount &&
    input.source.stripeNetAmount === settlement.stripeNetAmount &&
    input.source.stripePaymentIntentId ===
      input.payment.stripePaymentIntentId &&
    input.source.targetUserId === input.ownerUserId &&
    input.source.tenantId === input.tenantId &&
    input.source.type === input.payment.type
  );
};

type PersistedAcquisitionReplayComponent = Pick<
  typeof registrationAcquisitionComponents.$inferSelect,
  | 'acquisitionPaymentId'
  | 'allocationKey'
  | 'applicationFeeAmount'
  | 'baseAmount'
  | 'currency'
  | 'grossAmount'
  | 'id'
  | 'kind'
  | 'netAmount'
  | 'purchaseId'
  | 'purchaseLotId'
  | 'quantity'
  | 'stripeFeeAmount'
  | 'taxAmount'
  | 'taxRateDisplayName'
  | 'taxRateInclusive'
  | 'taxRatePercentage'
>;

const componentMatches = (
  persisted: PersistedAcquisitionReplayComponent,
  expected: SettledAcquisitionComponent,
  paymentId: null | string,
  currency: AcquisitionCurrency,
): boolean =>
  persisted.acquisitionPaymentId === paymentId &&
  persisted.allocationKey === expected.allocationKey &&
  persisted.applicationFeeAmount === expected.applicationFeeAmount &&
  persisted.baseAmount === expected.baseAmount &&
  persisted.currency === currency &&
  persisted.grossAmount === expected.grossAmount &&
  persisted.kind === expected.kind &&
  persisted.netAmount === expected.netAmount &&
  persisted.purchaseId ===
    (expected.kind === 'addon_lot' ? expected.purchaseId : null) &&
  persisted.purchaseLotId ===
    (expected.kind === 'addon_lot' ? expected.purchaseLotId : null) &&
  persisted.quantity === expected.quantity &&
  persisted.stripeFeeAmount === expected.stripeFeeAmount &&
  persisted.taxAmount === expected.taxAmount &&
  persisted.taxRateDisplayName === expected.taxRateDisplayName &&
  persisted.taxRateInclusive === expected.taxRateInclusive &&
  persisted.taxRatePercentage === expected.taxRatePercentage;

/**
 * Resolves only the rows originally requested by an idempotent operation.
 * Later add-ons may have appended more payments and components to the epoch.
 */
export const resolveRequestedAcquisitionReplay = (input: {
  readonly currency: AcquisitionCurrency;
  readonly persistedComponents: readonly PersistedAcquisitionReplayComponent[];
  readonly persistedPayments: readonly Pick<
    typeof registrationAcquisitionPayments.$inferSelect,
    'id' | 'transactionId'
  >[];
  readonly requestedComponents: readonly SettledAcquisitionComponent[];
  readonly requestedPaymentTransactionId?: string | undefined;
}):
  | undefined
  | {
      readonly componentIds: readonly string[];
      readonly paymentId?: string;
    } => {
  const requestedPayments = input.requestedPaymentTransactionId
    ? input.persistedPayments.filter(
        ({ transactionId }) =>
          transactionId === input.requestedPaymentTransactionId,
      )
    : [];
  if (
    input.requestedPaymentTransactionId !== undefined &&
    requestedPayments.length !== 1
  ) {
    return;
  }
  const requestedPayment = requestedPayments[0];
  const componentIds: string[] = [];
  for (const requested of input.requestedComponents) {
    const matchingComponents = input.persistedComponents.filter(
      ({ allocationKey }) => allocationKey === requested.allocationKey,
    );
    const persisted = matchingComponents[0];
    if (
      matchingComponents.length !== 1 ||
      !persisted ||
      !componentMatches(
        persisted,
        requested,
        requested.grossAmount > 0 ? (requestedPayment?.id ?? null) : null,
        input.currency,
      )
    ) {
      return;
    }
    componentIds.push(persisted.id);
  }
  return {
    componentIds,
    ...(requestedPayment && { paymentId: requestedPayment.id }),
  };
};

const validateSettledComponents = (input: {
  readonly components: readonly SettledAcquisitionComponent[];
  readonly payment?: AcquisitionPaymentInput | undefined;
}): boolean => {
  if (
    input.components.length === 0 ||
    input.components.filter(({ kind }) => kind === 'registration').length !==
      1 ||
    new Set(input.components.map(({ allocationKey }) => allocationKey)).size !==
      input.components.length ||
    new Set(
      input.components.flatMap((component) =>
        component.kind === 'addon_lot' ? [component.purchaseLotId] : [],
      ),
    ).size !==
      input.components.filter(({ kind }) => kind === 'addon_lot').length ||
    input.components.some(
      (component) =>
        !validComponentTerm(component) ||
        component.netAmount < 0 ||
        component.taxAmount < 0 ||
        component.grossAmount < component.baseAmount ||
        component.netAmount +
          component.stripeFeeAmount +
          component.applicationFeeAmount !==
          component.grossAmount,
    )
  ) {
    return false;
  }
  const positive = input.components.filter(
    ({ grossAmount }) => grossAmount > 0,
  );
  if (!input.payment) return positive.length === 0;
  const settlement = input.payment.settlement;
  return (
    positive.length > 0 &&
    input.components.reduce(
      (sum, component) => sum + component.grossAmount,
      0,
    ) === settlement.grossAmount &&
    input.components.reduce(
      (sum, component) => sum + component.applicationFeeAmount,
      0,
    ) === settlement.applicationFeeAmount &&
    input.components.reduce(
      (sum, component) => sum + component.stripeFeeAmount,
      0,
    ) === settlement.stripeFeeAmount &&
    input.components.reduce(
      (sum, component) => sum + component.netAmount,
      0,
    ) === settlement.stripeNetAmount
  );
};

export interface EstablishRegistrationAcquisitionInput {
  readonly acquiredAt: Date;
  readonly components: readonly SettledAcquisitionComponent[];
  readonly currency: AcquisitionCurrency;
  readonly eventId: string;
  readonly kind: AcquisitionKind;
  readonly operationKey: string;
  readonly ownerUserId: string;
  readonly payment?: AcquisitionPaymentInput | undefined;
  readonly registrationId: string;
  readonly spotCount: number;
  readonly tenantId: string;
  readonly transferId?: string | undefined;
}

export const resolveRegistrationAcquisitionEpoch = <
  A extends { readonly operationKey: string },
>(
  acquisitionsNewestFirst: readonly A[],
  operationKey: string,
): { readonly current: A | undefined; readonly existing: A | undefined } => ({
  current: acquisitionsNewestFirst[0],
  existing: acquisitionsNewestFirst.find(
    (acquisition) => acquisition.operationKey === operationKey,
  ),
});

export const establishRegistrationAcquisition = Effect.fn(
  'establishRegistrationAcquisition',
)(function* (
  tx: AcquisitionTransaction,
  input: EstablishRegistrationAcquisitionInput,
) {
  if (
    !input.operationKey.trim() ||
    input.operationKey.length > 100 ||
    !Number.isSafeInteger(input.spotCount) ||
    input.spotCount <= 0 ||
    !validateSettledComponents(input) ||
    (input.kind === 'claim_transfer' && !input.transferId) ||
    (input.kind !== 'claim_transfer' && input.transferId !== undefined)
  ) {
    return yield* acquisitionError('Acquisition terms are invalid');
  }

  const acquisitions = yield* tx
    .select()
    .from(registrationAcquisitions)
    .where(
      and(
        eq(registrationAcquisitions.tenantId, input.tenantId),
        eq(registrationAcquisitions.registrationId, input.registrationId),
      ),
    )
    .orderBy(desc(registrationAcquisitions.ordinal))
    .for('update');
  const { current: previous, existing } = resolveRegistrationAcquisitionEpoch(
    acquisitions,
    input.operationKey,
  );

  if (input.payment) {
    yield* lockAndValidatePaymentSource(tx, {
      currency: input.currency,
      eventId: input.eventId,
      ownerUserId: input.ownerUserId,
      payment: input.payment,
      registrationId: input.registrationId,
      tenantId: input.tenantId,
    });
  }

  if (existing) {
    const payments = yield* tx
      .select()
      .from(registrationAcquisitionPayments)
      .where(eq(registrationAcquisitionPayments.acquisitionId, existing.id))
      .orderBy(registrationAcquisitionPayments.id)
      .for('update');
    const components = yield* tx
      .select()
      .from(registrationAcquisitionComponents)
      .where(eq(registrationAcquisitionComponents.acquisitionId, existing.id))
      .orderBy(registrationAcquisitionComponents.id)
      .for('update');
    const expectedPrevious =
      existing.ordinal === 0 ? undefined : existing.previousAcquisitionId;
    const replay = resolveRequestedAcquisitionReplay({
      currency: input.currency,
      persistedComponents: components,
      persistedPayments: payments,
      requestedComponents: input.components,
      ...(input.payment && {
        requestedPaymentTransactionId: input.payment.transactionId,
      }),
    });
    if (
      existing.eventId !== input.eventId ||
      existing.kind !== input.kind ||
      existing.ownerUserId !== input.ownerUserId ||
      existing.registrationId !== input.registrationId ||
      existing.spotCount !== input.spotCount ||
      existing.tenantId !== input.tenantId ||
      existing.transferId !== (input.transferId ?? null) ||
      (input.kind === 'initial'
        ? existing.ordinal !== 0 || existing.previousAcquisitionId !== null
        : existing.ordinal <= 0 || !expectedPrevious) ||
      !replay
    ) {
      return yield* acquisitionError(
        'Existing acquisition does not match the immutable requested terms',
      );
    }
    return {
      acquisitionId: existing.id,
      componentIds: replay.componentIds,
      paymentId: replay.paymentId,
    };
  }

  if (
    (input.kind === 'initial' && previous) ||
    (input.kind !== 'initial' &&
      (!previous || previous.ownerUserId === input.ownerUserId))
  ) {
    return yield* acquisitionError(
      'Acquisition ownership epoch does not follow the current owner',
    );
  }

  const acquisitionId = createId();
  yield* tx.insert(registrationAcquisitions).values({
    acquiredAt: input.acquiredAt,
    eventId: input.eventId,
    id: acquisitionId,
    kind: input.kind,
    operationKey: input.operationKey,
    ordinal: previous ? previous.ordinal + 1 : 0,
    ownerUserId: input.ownerUserId,
    ...(previous && { previousAcquisitionId: previous.id }),
    registrationId: input.registrationId,
    spotCount: input.spotCount,
    tenantId: input.tenantId,
    ...(input.transferId && { transferId: input.transferId }),
  });

  const paymentId = input.payment ? createId() : undefined;
  if (input.payment && paymentId) {
    yield* tx.insert(registrationAcquisitionPayments).values({
      acquisitionId,
      attachedAt: input.acquiredAt,
      eventId: input.eventId,
      id: paymentId,
      registrationId: input.registrationId,
      tenantId: input.tenantId,
      transactionId: input.payment.transactionId,
    });
  }

  const componentRows = input.components.map((component) => ({
    acquiredAt: input.acquiredAt,
    acquisitionId,
    ...(component.grossAmount > 0 &&
      paymentId && { acquisitionPaymentId: paymentId }),
    allocationKey: component.allocationKey,
    applicationFeeAmount: component.applicationFeeAmount,
    baseAmount: component.baseAmount,
    currency: input.currency,
    eventId: input.eventId,
    grossAmount: component.grossAmount,
    id: createId(),
    kind: component.kind,
    netAmount: component.netAmount,
    ...(component.kind === 'addon_lot' && {
      purchaseId: component.purchaseId,
      purchaseLotId: component.purchaseLotId,
    }),
    quantity: component.quantity,
    registrationId: input.registrationId,
    stripeFeeAmount: component.stripeFeeAmount,
    taxAmount: component.taxAmount,
    taxRateDisplayName: component.taxRateDisplayName,
    taxRateInclusive: component.taxRateInclusive,
    taxRatePercentage: component.taxRatePercentage,
    tenantId: input.tenantId,
  }));
  yield* tx.insert(registrationAcquisitionComponents).values(componentRows);
  return {
    acquisitionId,
    componentIds: componentRows.map(({ id }) => id),
    paymentId,
  };
});

export const lockCurrentRegistrationAcquisition = Effect.fn(
  'lockCurrentRegistrationAcquisition',
)(function* (
  tx: Pick<DatabaseClient, 'select'>,
  input: {
    readonly ownerUserId: string;
    readonly registrationId: string;
    readonly tenantId: string;
  },
) {
  // The caller holds the registration row lock. Every path then takes the
  // acquisition, payment, and component locks sequentially in this order.
  const rows = yield* tx
    .select()
    .from(registrationAcquisitions)
    .where(
      and(
        eq(registrationAcquisitions.tenantId, input.tenantId),
        eq(registrationAcquisitions.registrationId, input.registrationId),
      ),
    )
    .orderBy(desc(registrationAcquisitions.ordinal))
    .limit(1)
    .for('update');
  const acquisition = rows[0];
  if (!acquisition || acquisition.ownerUserId !== input.ownerUserId) {
    return yield* acquisitionError(
      'Current registration acquisition owner does not match',
    );
  }
  const payments = yield* tx
    .select()
    .from(registrationAcquisitionPayments)
    .where(eq(registrationAcquisitionPayments.acquisitionId, acquisition.id))
    .orderBy(registrationAcquisitionPayments.id)
    .for('update');
  const components = yield* tx
    .select()
    .from(registrationAcquisitionComponents)
    .where(eq(registrationAcquisitionComponents.acquisitionId, acquisition.id))
    .orderBy(registrationAcquisitionComponents.id)
    .for('update');
  return { acquisition, components, payments };
});

export const appendAddonLotAcquisitionComponent = Effect.fn(
  'appendAddonLotAcquisitionComponent',
)(function* (
  tx: AcquisitionTransaction,
  input: {
    readonly acquiredAt: Date;
    readonly component: SettledAcquisitionComponent;
    readonly currency: AcquisitionCurrency;
    readonly eventId: string;
    readonly ownerUserId: string;
    readonly payment?: AcquisitionPaymentInput | undefined;
    readonly registrationId: string;
    readonly tenantId: string;
  },
) {
  if (
    input.component.kind !== 'addon_lot' ||
    !validateSettledComponents({
      components: [
        {
          ...input.component,
          allocationKey: '__validation_registration__',
          applicationFeeAmount: 0,
          baseAmount: 0,
          grossAmount: 0,
          id: '__validation_registration__',
          kind: 'registration',
          netAmount: 0,
          quantity: 1,
          stripeFeeAmount: 0,
          taxAmount: 0,
          taxRateDisplayName: null,
          taxRateInclusive: null,
          taxRatePercentage: null,
        },
        input.component,
      ],
      ...(input.payment && { payment: input.payment }),
    })
  ) {
    return yield* acquisitionError('Add-on acquisition component is invalid');
  }

  const current = yield* lockCurrentRegistrationAcquisition(tx, {
    ownerUserId: input.ownerUserId,
    registrationId: input.registrationId,
    tenantId: input.tenantId,
  });
  if (current.acquisition.eventId !== input.eventId) {
    return yield* acquisitionError('Current acquisition event does not match');
  }

  if (input.payment) {
    yield* lockAndValidatePaymentSource(tx, {
      currency: input.currency,
      eventId: input.eventId,
      ownerUserId: input.ownerUserId,
      payment: input.payment,
      registrationId: input.registrationId,
      tenantId: input.tenantId,
    });
  }

  const purchaseLotId = input.component.purchaseLotId;
  const existingComponent = current.components.find(
    (component) => component.purchaseLotId === purchaseLotId,
  );
  const existingPayment = input.payment
    ? current.payments.find(
        ({ transactionId }) => transactionId === input.payment?.transactionId,
      )
    : undefined;
  if (existingComponent) {
    if (
      !componentMatches(
        existingComponent,
        input.component,
        input.component.grossAmount > 0 ? (existingPayment?.id ?? null) : null,
        input.currency,
      )
    ) {
      return yield* acquisitionError(
        'Existing add-on acquisition component does not match',
      );
    }
    return {
      acquisitionId: current.acquisition.id,
      componentId: existingComponent.id,
      paymentId: existingPayment?.id,
    };
  }

  if (input.payment && !existingPayment) {
    const paymentId = createId();
    yield* tx.insert(registrationAcquisitionPayments).values({
      acquisitionId: current.acquisition.id,
      attachedAt: input.acquiredAt,
      eventId: input.eventId,
      id: paymentId,
      registrationId: input.registrationId,
      tenantId: input.tenantId,
      transactionId: input.payment.transactionId,
    });
    const componentId = createId();
    yield* tx.insert(registrationAcquisitionComponents).values({
      acquiredAt: input.acquiredAt,
      acquisitionId: current.acquisition.id,
      acquisitionPaymentId: paymentId,
      allocationKey: input.component.allocationKey,
      applicationFeeAmount: input.component.applicationFeeAmount,
      baseAmount: input.component.baseAmount,
      currency: input.currency,
      eventId: input.eventId,
      grossAmount: input.component.grossAmount,
      id: componentId,
      kind: 'addon_lot',
      netAmount: input.component.netAmount,
      purchaseId: input.component.purchaseId,
      purchaseLotId: input.component.purchaseLotId,
      quantity: input.component.quantity,
      registrationId: input.registrationId,
      stripeFeeAmount: input.component.stripeFeeAmount,
      taxAmount: input.component.taxAmount,
      taxRateDisplayName: input.component.taxRateDisplayName,
      taxRateInclusive: input.component.taxRateInclusive,
      taxRatePercentage: input.component.taxRatePercentage,
      tenantId: input.tenantId,
    });
    return {
      acquisitionId: current.acquisition.id,
      componentId,
      paymentId,
    };
  }

  if (input.payment || input.component.grossAmount > 0) {
    return yield* acquisitionError(
      'Add-on acquisition payment attachment is inconsistent',
    );
  }
  const componentId = createId();
  yield* tx.insert(registrationAcquisitionComponents).values({
    acquiredAt: input.acquiredAt,
    acquisitionId: current.acquisition.id,
    allocationKey: input.component.allocationKey,
    applicationFeeAmount: 0,
    baseAmount: 0,
    currency: input.currency,
    eventId: input.eventId,
    grossAmount: 0,
    id: componentId,
    kind: 'addon_lot',
    netAmount: 0,
    purchaseId: input.component.purchaseId,
    purchaseLotId: input.component.purchaseLotId,
    quantity: input.component.quantity,
    registrationId: input.registrationId,
    stripeFeeAmount: 0,
    taxAmount: 0,
    taxRateDisplayName: input.component.taxRateDisplayName,
    taxRateInclusive: input.component.taxRateInclusive,
    taxRatePercentage: input.component.taxRatePercentage,
    tenantId: input.tenantId,
  });
  return {
    acquisitionId: current.acquisition.id,
    componentId,
    paymentId: undefined,
  };
});
