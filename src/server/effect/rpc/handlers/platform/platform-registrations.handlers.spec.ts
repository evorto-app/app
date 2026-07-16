import { describe, expect, it } from '@effect/vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  platformRegistrationActiveTransferPredicate,
  platformRegistrationCancellationBlockedReason,
  platformRegistrationCancellationRefundPreview,
} from './platform-registrations.handlers';

const transferredRegistration = () => ({
  acquisition: {
    eventId: 'event-1',
    ownerUserId: 'user-recipient',
    spotCount: 2,
  },
  allocations: [],
  components: [
    {
      acquisitionPaymentId: 'payment-recipient',
      applicationFeeAmount: 100,
      currency: 'EUR' as const,
      grossAmount: 1200,
      id: 'component-registration',
      kind: 'registration' as const,
      netAmount: 1000,
      purchaseId: null,
      purchaseLotId: null,
      quantity: 2,
      stripeFeeAmount: 100,
    },
    {
      acquisitionPaymentId: 'payment-recipient',
      applicationFeeAmount: 50,
      currency: 'EUR' as const,
      grossAmount: 600,
      id: 'component-addon',
      kind: 'addon_lot' as const,
      netAmount: 500,
      purchaseId: 'purchase-addon',
      purchaseLotId: 'lot-addon',
      quantity: 2,
      stripeFeeAmount: 50,
    },
  ],
  eventId: 'event-1',
  expectedSpotCount: 2,
  lots: [
    {
      cancelledQuantity: 0,
      id: 'lot-addon',
      purchaseId: 'purchase-addon',
      quantity: 2,
      redeemedQuantity: 1,
    },
  ],
  ownerUserId: 'user-recipient',
  payments: [
    {
      id: 'payment-recipient',
      transactionId: 'transaction-recipient',
    },
  ],
  purchases: [
    {
      cancelledQuantity: 0,
      id: 'purchase-addon',
      includedQuantity: 0,
      purchasedQuantity: 2,
      redeemedQuantity: 1,
    },
  ],
  refundFeesOnCancellation: false,
  transactions: [
    {
      amount: 2600,
      appFee: 200,
      currency: 'EUR' as const,
      eventId: 'event-1',
      id: 'transaction-former-owner',
      method: 'stripe' as const,
      status: 'successful' as const,
      stripeAccountId: 'account-1',
      stripeChargeId: 'charge-former-owner',
      stripeFee: 200,
      stripeNetAmount: 2200,
      stripePaymentIntentId: 'intent-former-owner',
      targetUserId: 'user-former-owner',
      type: 'registration' as const,
    },
    {
      amount: 1800,
      appFee: 150,
      currency: 'EUR' as const,
      eventId: 'event-1',
      id: 'transaction-recipient',
      method: 'stripe' as const,
      status: 'successful' as const,
      stripeAccountId: 'account-1',
      stripeChargeId: 'charge-recipient',
      stripeFee: 150,
      stripeNetAmount: 1500,
      stripePaymentIntentId: 'intent-recipient',
      targetUserId: 'user-recipient',
      type: 'registration' as const,
    },
  ],
});

describe('platform registration cancellation refund preview', () => {
  it('blocks platform cancellation for an active source transfer', () => {
    const predicate = platformRegistrationActiveTransferPredicate({
      registrationId: 'registration-1',
      tenantId: 'tenant-1',
    });
    if (!predicate) throw new Error('Expected an active-transfer predicate');
    const query = new PgDialect().sqlToQuery(predicate);

    expect(query.params).toEqual([
      'tenant-1',
      'registration-1',
      'open',
      'checkout_pending',
      'refund_pending',
      'refund_failed',
      'registration-1',
      'checkout_pending',
    ]);
    expect(
      platformRegistrationCancellationBlockedReason({
        activeTransfer: true,
        checkInTime: null,
        eventStart: new Date('2030-01-02T00:00:00.000Z'),
        now: new Date('2030-01-01T00:00:00.000Z'),
        pendingAddonPayment: false,
        pendingStripePayment: null,
        refundBlockedReason: null,
        status: 'CONFIRMED',
      }),
    ).toContain('active registration transfer');
  });

  it('uses the recipient acquisition and only the unfulfilled add-on entitlement after transfer', () => {
    const preview = platformRegistrationCancellationRefundPreview(
      transferredRegistration(),
    );

    expect(preview).toEqual({
      blockedReason: null,
      refund: {
        amount: 1250,
        feesIncluded: false,
        method: 'stripe',
        required: true,
      },
    });
  });

  it('fails closed instead of exposing a payment from a different current owner', () => {
    const fixture = transferredRegistration();
    const preview = platformRegistrationCancellationRefundPreview({
      ...fixture,
      acquisition: {
        ...fixture.acquisition,
        ownerUserId: 'user-former-owner',
      },
    });

    expect(preview.blockedReason).toContain(
      "current attendee's refundable payment",
    );
    expect(preview.refund).toEqual({
      amount: null,
      feesIncluded: false,
      method: null,
      required: false,
    });
  });

  it('fails closed when current payment settlement no longer matches its components', () => {
    const fixture = transferredRegistration();
    const preview = platformRegistrationCancellationRefundPreview({
      ...fixture,
      transactions: fixture.transactions.map((transaction) =>
        transaction.id === 'transaction-recipient'
          ? { ...transaction, amount: transaction.amount + 1 }
          : transaction,
      ),
    });

    expect(preview.blockedReason).not.toBeNull();
    expect(preview.refund.required).toBe(false);
  });

  it('fails closed when refund history exceeds the current cancellation entitlement', () => {
    const fixture = transferredRegistration();
    for (const allocations of [
      [{ componentId: 'component-registration', quantity: 1 }],
      [{ componentId: 'component-addon', quantity: 1 }],
    ]) {
      const preview = platformRegistrationCancellationRefundPreview({
        ...fixture,
        allocations,
      });

      expect(preview.blockedReason).not.toBeNull();
      expect(preview.refund.required).toBe(false);
    }
  });

  it('fails closed when add-on purchase aggregates no longer match their lots', () => {
    const fixture = transferredRegistration();
    const preview = platformRegistrationCancellationRefundPreview({
      ...fixture,
      purchases: fixture.purchases.map((purchase) => ({
        ...purchase,
        purchasedQuantity: purchase.purchasedQuantity + 1,
      })),
    });

    expect(preview.blockedReason).not.toBeNull();
    expect(preview.refund.required).toBe(false);
  });
});
