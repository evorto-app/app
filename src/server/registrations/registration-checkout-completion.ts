import type Stripe from 'stripe';

import { Database, type DatabaseClient } from '@db/index';
import {
  eventRegistrationAddonPurchaseLots,
  eventRegistrationOptions,
  eventRegistrations,
  registrationTransfers,
  transactions,
} from '@db/schema';
import { registrationSpotCount } from '@shared/registration-spots';
import { and, eq, sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { enqueueRegistrationConfirmedEmail } from '../notifications/email-delivery';
import { StripeClient } from '../stripe-client';
import { tenantOutboundUrl } from '../tenant-outbound-url';
import {
  type AcquisitionPaymentSettlement,
  establishRegistrationAcquisition,
  resolveStripeAcquisitionPaymentSettlement,
  settleAcquisitionComponentTerms,
} from './registration-acquisition-write';
import { finalizeRegistrationTransferCheckout } from './registration-transfer-finalization';

const initialCheckoutReconcileDelayMs = 5000;

export type RegistrationCheckoutCompletionErrorKind =
  'internal' | 'invalidBinding' | 'stateConflict';

export interface RegistrationCheckoutCompletionIdentity {
  readonly registrationId: string;
  readonly stripeAccountId: string;
  readonly stripeCheckoutSessionId: string;
  readonly tenantId: string;
  readonly transactionId: string;
}
export type RegistrationCheckoutCompletionStatus =
  'alreadyCompleted' | 'alreadyFinalized' | 'compensationQueued' | 'finalized';

export class RegistrationCheckoutCompletionError extends Schema.TaggedErrorClass<RegistrationCheckoutCompletionError>()(
  'RegistrationCheckoutCompletionError',
  {
    cause: Schema.optional(Schema.Defect()),
    kind: Schema.Literals(['internal', 'invalidBinding', 'stateConflict']),
    message: Schema.String,
    registrationId: Schema.String,
    transactionId: Schema.String,
  },
) {}

export const registrationCheckoutInitialReconcileAt = (
  now = new Date(),
): Date => new Date(now.getTime() + initialCheckoutReconcileDelayMs);

const failCompletionWithKind = (
  input: RegistrationCheckoutCompletionIdentity,
  kind: RegistrationCheckoutCompletionErrorKind,
  message: string,
  cause?: unknown,
) =>
  Effect.fail(
    new RegistrationCheckoutCompletionError({
      ...(cause !== undefined && { cause }),
      kind,
      message,
      registrationId: input.registrationId,
      transactionId: input.transactionId,
    }),
  );

const failCompletion = (
  input: RegistrationCheckoutCompletionIdentity,
  message: string,
  cause?: unknown,
) => failCompletionWithKind(input, 'internal', message, cause);

const failInvalidBinding = (
  input: RegistrationCheckoutCompletionIdentity,
  message: string,
  cause?: unknown,
) => failCompletionWithKind(input, 'invalidBinding', message, cause);

const failStateConflict = (
  input: RegistrationCheckoutCompletionIdentity,
  message: string,
  cause?: unknown,
) => failCompletionWithKind(input, 'stateConflict', message, cause);

export const registrationCheckoutPaymentIntentId = (
  session: Stripe.Checkout.Session,
): string | undefined =>
  typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;

export const registrationCheckoutPaymentOwnsClaim = (input: {
  readonly persistedAmount: number;
  readonly persistedCurrency: string;
  readonly sessionAmountTotal: null | number;
  readonly sessionCurrency: null | string;
}): boolean =>
  Number.isInteger(input.sessionAmountTotal) &&
  input.sessionAmountTotal === input.persistedAmount &&
  Boolean(input.sessionCurrency) &&
  input.sessionCurrency?.toUpperCase() === input.persistedCurrency;

export const registrationCheckoutTargetOwnsClaim = (input: {
  readonly registrationUserId: string;
  readonly targetUserId: string;
  readonly transferId: null | string;
}): boolean =>
  input.transferId !== null || input.targetUserId === input.registrationUserId;

const latestChargeId = (
  paymentIntent:
    | null
    | string
    | {
        latest_charge?: null | string | { id?: string | undefined };
      },
): string | undefined => {
  if (!paymentIntent || typeof paymentIntent === 'string') return undefined;
  const latestCharge = paymentIntent.latest_charge;
  return typeof latestCharge === 'string' ? latestCharge : latestCharge?.id;
};

const StripeInvalidRequestError = Schema.Struct({
  type: Schema.Literals(['StripeInvalidRequestError']),
});
const StripeMissingResourceCode = Schema.Struct({
  code: Schema.Literals(['resource_missing']),
});
const StripeMissingResourceRawCode = Schema.Struct({
  raw: StripeMissingResourceCode,
});

const isStripeMissingResourceError = (error: unknown): boolean =>
  Schema.is(StripeInvalidRequestError)(error) &&
  (Schema.is(StripeMissingResourceCode)(error) ||
    Schema.is(StripeMissingResourceRawCode)(error));

const checkoutNotificationEmail = (user: {
  communicationEmail: string;
  email: string;
}): string => user.communicationEmail.trim() || user.email;

export const registrationCheckoutMetadataOwnsClaim = (input: {
  readonly identity: RegistrationCheckoutCompletionIdentity;
  readonly paymentIntentId: string | undefined;
  readonly persistedPaymentIntentId: null | string;
  readonly session: Stripe.Checkout.Session;
  readonly transferId: null | string;
}): boolean => {
  const metadata = input.session.metadata ?? {};
  const metadataRegistrationId = metadata['registrationId'];
  const metadataTenantId = metadata['tenantId'];
  const metadataTransactionId = metadata['transactionId'];
  const hasAnyOwnershipMetadata = Boolean(
    metadataRegistrationId || metadataTenantId || metadataTransactionId,
  );
  const hasExactOwnershipMetadata =
    metadataRegistrationId === input.identity.registrationId &&
    metadataTenantId === input.identity.tenantId &&
    metadataTransactionId === input.identity.transactionId;

  if (hasAnyOwnershipMetadata && !hasExactOwnershipMetadata) return false;
  if (
    !hasAnyOwnershipMetadata &&
    (!input.paymentIntentId ||
      input.persistedPaymentIntentId !== input.paymentIntentId)
  ) {
    return false;
  }

  const metadataTransferId = metadata['transferId'];
  return input.transferId
    ? metadataTransferId === input.transferId || !hasAnyOwnershipMetadata
    : !metadataTransferId;
};

type RegistrationCheckoutTransaction = Pick<
  DatabaseClient,
  'insert' | 'select' | 'update'
>;

const establishPaidInitialRegistrationAcquisition = Effect.fn(
  'establishPaidInitialRegistrationAcquisition',
)(function* (
  tx: RegistrationCheckoutTransaction,
  input: RegistrationCheckoutCompletionIdentity & {
    readonly acquiredAt: Date;
    readonly currency: typeof transactions.$inferSelect.currency;
    readonly eventId: string;
    readonly guestCount: number;
    readonly ownerUserId: string;
    readonly paymentIntentId: string;
    readonly paymentSettlement: AcquisitionPaymentSettlement;
    readonly registration: {
      readonly appliedDiscountedPrice: null | number;
      readonly basePriceAtRegistration: null | number;
      readonly stripeTaxRateDisplayName: null | string;
      readonly stripeTaxRateInclusive: boolean | null;
      readonly stripeTaxRatePercentage: null | string;
    };
    readonly stripeChargeId: string;
  },
) {
  const lots = yield* tx
    .select({
      applicationFeeAmount:
        eventRegistrationAddonPurchaseLots.applicationFeeAmount,
      baseAmount: eventRegistrationAddonPurchaseLots.baseAmount,
      currency: eventRegistrationAddonPurchaseLots.currency,
      grossAmount: eventRegistrationAddonPurchaseLots.grossAmount,
      id: eventRegistrationAddonPurchaseLots.id,
      netAmount: eventRegistrationAddonPurchaseLots.netAmount,
      paymentAllocationFinalizedAt:
        eventRegistrationAddonPurchaseLots.paymentAllocationFinalizedAt,
      purchaseId: eventRegistrationAddonPurchaseLots.purchaseId,
      quantity: eventRegistrationAddonPurchaseLots.quantity,
      sourceLineKey: eventRegistrationAddonPurchaseLots.sourceLineKey,
      sourceTransactionId:
        eventRegistrationAddonPurchaseLots.sourceTransactionId,
      stripeFeeAmount: eventRegistrationAddonPurchaseLots.stripeFeeAmount,
      taxAmount: eventRegistrationAddonPurchaseLots.taxAmount,
      taxRateDisplayName: eventRegistrationAddonPurchaseLots.taxRateDisplayName,
      taxRateInclusive: eventRegistrationAddonPurchaseLots.taxRateInclusive,
      taxRatePercentage: eventRegistrationAddonPurchaseLots.taxRatePercentage,
    })
    .from(eventRegistrationAddonPurchaseLots)
    .where(
      and(
        eq(
          eventRegistrationAddonPurchaseLots.registrationId,
          input.registrationId,
        ),
        eq(eventRegistrationAddonPurchaseLots.tenantId, input.tenantId),
      ),
    )
    .orderBy(eventRegistrationAddonPurchaseLots.id)
    .for('update');
  if (
    lots.some(
      (lot) =>
        lot.currency !== input.currency ||
        (lot.baseAmount > 0
          ? lot.sourceTransactionId !== input.transactionId
          : lot.sourceTransactionId !== null),
    )
  ) {
    return yield* failStateConflict(
      input,
      'Registration add-on lot payment ownership changed before acquisition',
    );
  }

  const basePrice = input.registration.basePriceAtRegistration ?? 0;
  const effectivePrice = input.registration.appliedDiscountedPrice ?? basePrice;
  const settledComponents = settleAcquisitionComponentTerms({
    payment: input.paymentSettlement,
    terms: [
      {
        allocationKey: `registration-initial:${input.registrationId}`,
        baseAmount: effectivePrice + basePrice * input.guestCount,
        id: `registration:${input.registrationId}`,
        kind: 'registration',
        quantity: registrationSpotCount(input.guestCount),
        taxRateDisplayName: input.registration.stripeTaxRateDisplayName,
        taxRateInclusive: input.registration.stripeTaxRateInclusive,
        taxRatePercentage: input.registration.stripeTaxRatePercentage,
      },
      ...lots.map((lot) => ({
        allocationKey: lot.sourceLineKey,
        baseAmount: lot.baseAmount,
        id: `addon-lot:${lot.id}`,
        kind: 'addon_lot' as const,
        purchaseId: lot.purchaseId,
        purchaseLotId: lot.id,
        quantity: lot.quantity,
        taxRateDisplayName: lot.taxRateDisplayName,
        taxRateInclusive: lot.taxRateInclusive,
        taxRatePercentage: lot.taxRatePercentage,
      })),
    ],
  });
  if (!settledComponents) {
    return yield* failStateConflict(
      input,
      'Registration acquisition components do not settle to the Checkout payment',
    );
  }

  for (const lot of lots) {
    const component = settledComponents.find(
      ({ id }) => id === `addon-lot:${lot.id}`,
    );
    if (!component || component.kind !== 'addon_lot') {
      return yield* failStateConflict(
        input,
        'Registration add-on lot acquisition component is missing',
      );
    }
    if (
      (lot.applicationFeeAmount !== null &&
        lot.applicationFeeAmount !== component.applicationFeeAmount) ||
      (lot.grossAmount !== null && lot.grossAmount !== component.grossAmount) ||
      (lot.netAmount !== null && lot.netAmount !== component.netAmount) ||
      (lot.stripeFeeAmount !== null &&
        lot.stripeFeeAmount !== component.stripeFeeAmount) ||
      (lot.taxAmount !== null && lot.taxAmount !== component.taxAmount)
    ) {
      return yield* failStateConflict(
        input,
        'Registration add-on lot settlement changed before acquisition',
      );
    }
    yield* tx
      .update(eventRegistrationAddonPurchaseLots)
      .set({
        applicationFeeAmount: component.applicationFeeAmount,
        grossAmount: component.grossAmount,
        netAmount: component.netAmount,
        paymentAllocationFinalizedAt:
          lot.paymentAllocationFinalizedAt ?? input.acquiredAt,
        stripeFeeAmount: component.stripeFeeAmount,
        taxAmount: component.taxAmount,
      })
      .where(eq(eventRegistrationAddonPurchaseLots.id, lot.id));
  }

  yield* establishRegistrationAcquisition(tx, {
    acquiredAt: input.acquiredAt,
    components: settledComponents,
    currency: input.currency,
    eventId: input.eventId,
    kind: 'initial',
    operationKey: `registration-initial:${input.registrationId}`,
    ownerUserId: input.ownerUserId,
    payment: {
      settlement: input.paymentSettlement,
      stripeAccountId: input.stripeAccountId,
      stripeChargeId: input.stripeChargeId,
      stripePaymentIntentId: input.paymentIntentId,
      transactionId: input.transactionId,
      type: 'registration',
    },
    registrationId: input.registrationId,
    spotCount: registrationSpotCount(input.guestCount),
    tenantId: input.tenantId,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new RegistrationCheckoutCompletionError({
          cause,
          kind: 'stateConflict',
          message: 'Initial registration acquisition could not be persisted',
          registrationId: input.registrationId,
          transactionId: input.transactionId,
        }),
    ),
  );
});

/**
 * Applies the exact paid Checkout transition shared by webhooks, the scheduled
 * reconciler, and an explicit transfer retry. Stripe/network work is completed
 * before the database transaction acquires any row locks.
 */
export const completePaidRegistrationCheckout = Effect.fn(
  'completePaidRegistrationCheckout',
)(function* (
  input: RegistrationCheckoutCompletionIdentity,
  session: Stripe.Checkout.Session,
) {
  if (
    session.id !== input.stripeCheckoutSessionId ||
    session.status !== 'complete' ||
    session.payment_status !== 'paid'
  ) {
    return yield* failInvalidBinding(
      input,
      'Registration Checkout is not the exact completed and paid session',
    );
  }

  const paymentIntentId = registrationCheckoutPaymentIntentId(session);
  if (!paymentIntentId) {
    return yield* failInvalidBinding(
      input,
      'Registration Checkout payment intent is missing',
    );
  }
  const preflight = yield* Database.use((database) =>
    Effect.gen(function* () {
      const claims = yield* database
        .select({
          amount: transactions.amount,
          currency: transactions.currency,
          persistedPaymentIntentId: transactions.stripePaymentIntentId,
          transferId: registrationTransfers.id,
        })
        .from(transactions)
        .leftJoin(
          registrationTransfers,
          and(
            eq(
              registrationTransfers.recipientCheckoutTransactionId,
              transactions.id,
            ),
            eq(registrationTransfers.tenantId, transactions.tenantId),
          ),
        )
        .where(
          and(
            eq(transactions.id, input.transactionId),
            eq(transactions.eventRegistrationId, input.registrationId),
            eq(transactions.method, 'stripe'),
            eq(transactions.stripeAccountId, input.stripeAccountId),
            eq(
              transactions.stripeCheckoutSessionId,
              input.stripeCheckoutSessionId,
            ),
            eq(transactions.tenantId, input.tenantId),
            eq(transactions.type, 'registration'),
          ),
        )
        .limit(1);
      const claim = claims[0];
      if (!claim) return;

      if (
        !registrationCheckoutPaymentOwnsClaim({
          persistedAmount: claim.amount,
          persistedCurrency: claim.currency,
          sessionAmountTotal: session.amount_total,
          sessionCurrency: session.currency,
        })
      ) {
        return { type: 'paymentMismatch' as const };
      }

      if (
        !registrationCheckoutMetadataOwnsClaim({
          identity: input,
          paymentIntentId,
          persistedPaymentIntentId: claim.persistedPaymentIntentId,
          session,
          transferId: claim.transferId,
        })
      ) {
        return { type: 'ownershipMismatch' as const };
      }

      if (claim.transferId) {
        return {
          amount: claim.amount,
          currency: claim.currency,
          transferId: claim.transferId,
          type: 'transfer' as const,
        };
      }

      const [tenant, notificationContext] = yield* Effect.all([
        database.query.tenants.findFirst({
          columns: {
            domain: true,
            emailSenderEmail: true,
            emailSenderName: true,
            id: true,
            name: true,
          },
          where: { id: input.tenantId },
        }),
        database.query.eventRegistrations.findFirst({
          columns: {
            eventId: true,
            id: true,
            registrationOptionId: true,
          },
          where: { id: input.registrationId, tenantId: input.tenantId },
          with: {
            event: { columns: { title: true } },
            user: {
              columns: { communicationEmail: true, email: true },
            },
          },
        }),
      ]);
      if (!tenant || !notificationContext?.event || !notificationContext.user) {
        return { type: 'missingNotificationContext' as const };
      }
      return {
        amount: claim.amount,
        currency: claim.currency,
        notificationContext,
        tenant,
        type: 'direct' as const,
      };
    }),
  );
  if (!preflight) {
    return yield* failInvalidBinding(
      input,
      'Registration Checkout claim ownership does not match persisted state',
    );
  }
  if (preflight.type === 'ownershipMismatch') {
    return yield* failInvalidBinding(
      input,
      'Registration Checkout metadata ownership does not match persisted state',
    );
  }
  if (preflight.type === 'paymentMismatch') {
    return yield* failInvalidBinding(
      input,
      'Registration Checkout amount or currency does not match persisted payment terms',
    );
  }
  if (preflight.type === 'missingNotificationContext') {
    return yield* failCompletion(
      input,
      'Registration Checkout notification context is missing',
    );
  }

  const inlineChargeId = latestChargeId(session.payment_intent);
  const stripeChargeId =
    inlineChargeId ??
    (yield* Effect.gen(function* () {
      const stripe = yield* StripeClient;
      const paymentIntent = yield* Effect.tryPromise({
        catch: (cause) =>
          new RegistrationCheckoutCompletionError({
            cause,
            kind: isStripeMissingResourceError(cause)
              ? 'invalidBinding'
              : 'internal',
            message: isStripeMissingResourceError(cause)
              ? 'Stripe payment intent is missing during checkout completion'
              : 'Stripe payment intent could not be resolved during checkout completion',
            registrationId: input.registrationId,
            transactionId: input.transactionId,
          }),
        try: () =>
          stripe.paymentIntents.retrieve(
            paymentIntentId,
            { expand: ['latest_charge'] },
            { stripeAccount: input.stripeAccountId },
          ),
      });
      if (paymentIntent.id !== paymentIntentId) {
        return yield* failInvalidBinding(
          input,
          'Stripe payment intent ownership does not match Checkout',
        );
      }
      return latestChargeId(paymentIntent);
    }));
  if (!stripeChargeId) {
    return yield* failCompletion(
      input,
      'Registration Checkout charge is not available yet',
    );
  }
  const paymentSettlement = yield* resolveStripeAcquisitionPaymentSettlement({
    expectedCurrency: preflight.currency,
    expectedGrossAmount: preflight.amount,
    expectedPaymentIntentId: paymentIntentId,
    stripeAccountId: input.stripeAccountId,
    stripeChargeId,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new RegistrationCheckoutCompletionError({
          cause,
          kind: 'internal',
          message: 'Registration Checkout payment fees are not settled yet',
          registrationId: input.registrationId,
          transactionId: input.transactionId,
        }),
    ),
  );
  const completedAt = new Date();

  const notificationEventUrl =
    preflight.type === 'direct'
      ? yield* tenantOutboundUrl(
          preflight.tenant,
          `/events/${encodeURIComponent(preflight.notificationContext.eventId)}`,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new RegistrationCheckoutCompletionError({
                cause,
                kind: 'internal',
                message: 'Registration Checkout notification URL is invalid',
                registrationId: input.registrationId,
                transactionId: input.transactionId,
              }),
          ),
        )
      : undefined;

  return yield* Database.use((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        const lockedRegistrations = yield* tx
          .select({
            appliedDiscountedPrice: eventRegistrations.appliedDiscountedPrice,
            basePriceAtRegistration: eventRegistrations.basePriceAtRegistration,
            eventId: eventRegistrations.eventId,
            guestCount: eventRegistrations.guestCount,
            registrationOptionId: eventRegistrations.registrationOptionId,
            status: eventRegistrations.status,
            stripeTaxRateDisplayName: eventRegistrations.taxRateDisplayName,
            stripeTaxRateInclusive: eventRegistrations.taxRateInclusive,
            stripeTaxRatePercentage: eventRegistrations.taxRatePercentage,
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
        const lockedRegistration = lockedRegistrations[0];
        if (!lockedRegistration) {
          return yield* failStateConflict(
            input,
            'Registration Checkout registration no longer exists',
          );
        }

        const lockedTransactions = yield* tx
          .select({
            amount: transactions.amount,
            appFee: transactions.appFee,
            currency: transactions.currency,
            paymentIntentId: transactions.stripePaymentIntentId,
            status: transactions.status,
            stripeChargeId: transactions.stripeChargeId,
            stripeFee: transactions.stripeFee,
            stripeNetAmount: transactions.stripeNetAmount,
            targetUserId: transactions.targetUserId,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.id, input.transactionId),
              eq(transactions.eventRegistrationId, input.registrationId),
              eq(transactions.method, 'stripe'),
              eq(transactions.stripeAccountId, input.stripeAccountId),
              eq(
                transactions.stripeCheckoutSessionId,
                input.stripeCheckoutSessionId,
              ),
              eq(transactions.tenantId, input.tenantId),
              eq(transactions.type, 'registration'),
            ),
          )
          .for('update');
        const lockedTransaction = lockedTransactions[0];
        if (!lockedTransaction) {
          return yield* failStateConflict(
            input,
            'Registration Checkout transaction ownership changed',
          );
        }
        if (
          lockedTransaction.amount !== preflight.amount ||
          lockedTransaction.currency !== preflight.currency ||
          !registrationCheckoutPaymentOwnsClaim({
            persistedAmount: lockedTransaction.amount,
            persistedCurrency: lockedTransaction.currency,
            sessionAmountTotal: session.amount_total,
            sessionCurrency: session.currency,
          })
        ) {
          return yield* failStateConflict(
            input,
            'Registration Checkout amount or currency ownership changed',
          );
        }
        if (
          lockedTransaction.paymentIntentId &&
          paymentIntentId &&
          lockedTransaction.paymentIntentId !== paymentIntentId
        ) {
          return yield* failStateConflict(
            input,
            'Registration Checkout payment intent ownership changed',
          );
        }
        if (!lockedTransaction.targetUserId) {
          return yield* failStateConflict(
            input,
            'Registration Checkout target ownership is missing',
          );
        }
        const targetUserId = lockedTransaction.targetUserId;
        if (
          !registrationCheckoutTargetOwnsClaim({
            registrationUserId: lockedRegistration.userId,
            targetUserId,
            transferId:
              preflight.type === 'transfer' ? preflight.transferId : null,
          }) ||
          (lockedTransaction.appFee !== null &&
            lockedTransaction.appFee !==
              paymentSettlement.applicationFeeAmount) ||
          (lockedTransaction.stripeChargeId !== null &&
            lockedTransaction.stripeChargeId !== stripeChargeId) ||
          (lockedTransaction.stripeFee !== null &&
            lockedTransaction.stripeFee !==
              paymentSettlement.stripeFeeAmount) ||
          (lockedTransaction.stripeNetAmount !== null &&
            lockedTransaction.stripeNetAmount !==
              paymentSettlement.stripeNetAmount)
        ) {
          return yield* failStateConflict(
            input,
            'Registration Checkout settled payment ownership changed',
          );
        }
        if (
          lockedTransaction.status !== 'pending' &&
          lockedTransaction.status !== 'successful'
        ) {
          return yield* failStateConflict(
            input,
            'Paid Registration Checkout transaction is no longer completable',
          );
        }

        if (lockedTransaction.status === 'pending') {
          const completedTransactions = yield* tx
            .update(transactions)
            .set({
              appFee: paymentSettlement.applicationFeeAmount,
              status: 'successful',
              stripeChargeId,
              stripeCheckoutCancellationRequestedAt: null,
              stripeCheckoutReconcileLastError: null,
              stripeCheckoutReconcileLeaseExpiresAt: null,
              stripeCheckoutReconcileLeaseId: null,
              stripeCheckoutReconcileNextAt: null,
              stripeFee: paymentSettlement.stripeFeeAmount,
              stripeNetAmount: paymentSettlement.stripeNetAmount,
              stripePaymentIntentId: paymentIntentId,
            })
            .where(
              and(
                eq(transactions.id, input.transactionId),
                eq(transactions.amount, preflight.amount),
                eq(transactions.currency, preflight.currency),
                eq(transactions.eventRegistrationId, input.registrationId),
                eq(transactions.method, 'stripe'),
                eq(transactions.stripeAccountId, input.stripeAccountId),
                eq(transactions.status, 'pending'),
                eq(
                  transactions.stripeCheckoutSessionId,
                  input.stripeCheckoutSessionId,
                ),
                eq(transactions.tenantId, input.tenantId),
                eq(transactions.type, 'registration'),
              ),
            )
            .returning({ id: transactions.id });
          if (completedTransactions.length !== 1) {
            return yield* failStateConflict(
              input,
              'Locked pending registration transaction could not be completed',
            );
          }
        } else {
          yield* tx
            .update(transactions)
            .set({
              appFee: paymentSettlement.applicationFeeAmount,
              stripeChargeId,
              stripeFee: paymentSettlement.stripeFeeAmount,
              stripeNetAmount: paymentSettlement.stripeNetAmount,
            })
            .where(eq(transactions.id, input.transactionId));
        }

        const transferFinalization =
          yield* finalizeRegistrationTransferCheckout(tx, {
            registrationId: input.registrationId,
            tenantId: input.tenantId,
            transactionId: input.transactionId,
          });
        if (transferFinalization !== 'notTransfer') {
          return transferFinalization;
        }
        if (preflight.type === 'transfer') {
          return yield* failStateConflict(
            input,
            'Registration transfer mapping changed during Checkout completion',
          );
        }

        if (
          lockedTransaction.status === 'successful' &&
          lockedRegistration.status === 'CONFIRMED'
        ) {
          yield* establishPaidInitialRegistrationAcquisition(tx, {
            ...input,
            acquiredAt: completedAt,
            currency: lockedTransaction.currency,
            eventId: lockedRegistration.eventId,
            guestCount: lockedRegistration.guestCount,
            ownerUserId: targetUserId,
            paymentIntentId,
            paymentSettlement,
            registration: lockedRegistration,
            stripeChargeId,
          });
          return 'alreadyCompleted' as const;
        }
        if (lockedRegistration.status !== 'PENDING') {
          return yield* failStateConflict(
            input,
            'Paid Registration Checkout registration is no longer pending',
          );
        }

        const updatedRegistrations = yield* tx
          .update(eventRegistrations)
          .set({ status: 'CONFIRMED' })
          .where(
            and(
              eq(eventRegistrations.id, input.registrationId),
              eq(eventRegistrations.status, 'PENDING'),
              eq(eventRegistrations.tenantId, input.tenantId),
            ),
          )
          .returning({
            eventId: eventRegistrations.eventId,
            guestCount: eventRegistrations.guestCount,
            registrationOptionId: eventRegistrations.registrationOptionId,
          });
        const updatedRegistration = updatedRegistrations[0];
        if (!updatedRegistration) {
          return yield* failStateConflict(
            input,
            'Locked pending registration could not be confirmed',
          );
        }
        const registeredSpotCount = registrationSpotCount(
          updatedRegistration.guestCount,
        );
        yield* tx
          .update(eventRegistrationOptions)
          .set({
            confirmedSpots: sql`${eventRegistrationOptions.confirmedSpots} + ${registeredSpotCount}`,
            reservedSpots: sql`GREATEST(${eventRegistrationOptions.reservedSpots} - ${registeredSpotCount}, 0)`,
          })
          .where(
            and(
              eq(
                eventRegistrationOptions.id,
                updatedRegistration.registrationOptionId,
              ),
              eq(eventRegistrationOptions.eventId, updatedRegistration.eventId),
            ),
          );

        yield* establishPaidInitialRegistrationAcquisition(tx, {
          ...input,
          acquiredAt: completedAt,
          currency: lockedTransaction.currency,
          eventId: updatedRegistration.eventId,
          guestCount: updatedRegistration.guestCount,
          ownerUserId: targetUserId,
          paymentIntentId,
          paymentSettlement,
          registration: lockedRegistration,
          stripeChargeId,
        });

        if (
          preflight.notificationContext.eventId !==
            updatedRegistration.eventId ||
          preflight.notificationContext.registrationOptionId !==
            updatedRegistration.registrationOptionId
        ) {
          return yield* failStateConflict(
            input,
            'Confirmed registration notification context is stale',
          );
        }
        if (!notificationEventUrl) {
          return yield* failCompletion(
            input,
            'Confirmed registration notification URL is missing',
          );
        }
        yield* enqueueRegistrationConfirmedEmail(tx, {
          eventTitle: preflight.notificationContext.event.title,
          registrationId: input.registrationId,
          tenant: preflight.tenant,
          ticketUrl: notificationEventUrl,
          to: checkoutNotificationEmail(preflight.notificationContext.user),
        });
        return 'finalized' as const;
      }),
    ),
  );
});
