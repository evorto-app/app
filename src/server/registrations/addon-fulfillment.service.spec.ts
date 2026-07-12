import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  deriveRegistrationAddonRefundState,
  registrationAddonRefundClaimProgress,
  selectRegistrationAddonCancellation,
} from './addon-fulfillment.service';

describe('selectRegistrationAddonCancellation', () => {
  const lots = [
    {
      cancelledQuantity: 0,
      id: 'lot-a',
      quantity: 2,
      redeemedQuantity: 1,
    },
    {
      cancelledQuantity: 1,
      id: 'lot-b',
      quantity: 2,
      redeemedQuantity: 0,
    },
  ] as const;

  it('cancels unredeemed purchased lots before included quantities', () => {
    expect(
      selectRegistrationAddonCancellation({
        cancelledQuantity: 1,
        includedQuantity: 2,
        lots,
        quantity: 3,
        redeemedQuantity: 2,
      }),
    ).toEqual({
      includedQuantity: 1,
      lots: [
        { id: 'lot-a', quantity: 1 },
        { id: 'lot-b', quantity: 1 },
      ],
    });
  });

  it('never reallocates redeemed or already-cancelled quantities', () => {
    expect(
      selectRegistrationAddonCancellation({
        cancelledQuantity: 1,
        includedQuantity: 2,
        lots,
        quantity: 2,
        redeemedQuantity: 2,
      }),
    ).toEqual({
      includedQuantity: 0,
      lots: [
        { id: 'lot-a', quantity: 1 },
        { id: 'lot-b', quantity: 1 },
      ],
    });
  });

  it('rejects quantities beyond the exact unfulfilled remainder', () => {
    expect(
      selectRegistrationAddonCancellation({
        cancelledQuantity: 1,
        includedQuantity: 2,
        lots,
        quantity: 4,
        redeemedQuantity: 2,
      }),
    ).toBeUndefined();
  });

  it('rejects inconsistent included-versus-lot counters', () => {
    expect(
      selectRegistrationAddonCancellation({
        cancelledQuantity: 0,
        includedQuantity: 2,
        lots,
        quantity: 1,
        redeemedQuantity: 0,
      }),
    ).toBeUndefined();
  });
});

describe('deriveRegistrationAddonRefundState', () => {
  it('keeps purchased cancellation truth isolated from later included-only history', () => {
    expect(
      deriveRegistrationAddonRefundState({
        allocations: [
          {
            fulfillmentEventId: 'cancel-purchased',
            quantity: 1,
            source: 'purchased',
          },
          {
            fulfillmentEventId: 'cancel-included',
            quantity: 1,
            source: 'included',
          },
        ],
        cancelledQuantity: 2,
        events: [
          {
            id: 'cancel-purchased',
            refundDisposition: 'not_requested',
            refundRequested: false,
            type: 'cancelled',
          },
          {
            id: 'cancel-included',
            refundDisposition: 'no_monetary_refund_required',
            refundRequested: true,
            type: 'cancelled',
          },
        ],
        lots: [
          {
            cancelledQuantity: 1,
            grossAmount: 1000,
            quantity: 1,
            redeemedQuantity: 0,
            sourceTransactionId: 'paid-source',
          },
          {
            cancelledQuantity: 0,
            grossAmount: 0,
            quantity: 1,
            redeemedQuantity: 0,
            sourceTransactionId: null,
          },
        ],
        purchasedQuantity: 2,
        refunds: [],
      }),
    ).toEqual({
      refundAvailability: 'noMonetaryRefundRequired',
      refundStatus: 'cancelledWithoutRefund',
    });
  });

  it('keeps provider action requirements distinct from automatic processing', () => {
    expect(
      deriveRegistrationAddonRefundState({
        allocations: [
          {
            fulfillmentEventId: 'cancel-purchased',
            quantity: 1,
            source: 'purchased',
          },
        ],
        cancelledQuantity: 1,
        events: [
          {
            id: 'cancel-purchased',
            refundDisposition: 'claims_created',
            refundRequested: true,
            type: 'cancelled',
          },
        ],
        lots: [
          {
            cancelledQuantity: 1,
            grossAmount: 1000,
            quantity: 1,
            redeemedQuantity: 0,
            sourceTransactionId: 'paid-source',
          },
        ],
        purchasedQuantity: 1,
        refunds: [
          {
            fulfillmentEventId: 'cancel-purchased',
            manuallyCreated: false,
            method: 'stripe',
            quantity: 1,
            status: 'pending',
            stripeRefundAttempts: 1,
            stripeRefundClaimLeaseExpiresAt: null,
            stripeRefundClaimLeaseId: null,
            stripeRefundMaxAttempts: 8,
            stripeRefundNextAttemptAt: new Date('2026-07-10T12:10:00.000Z'),
            stripeRefundStatus: 'requires_action',
          },
        ],
      }),
    ).toEqual({
      refundAvailability: 'none',
      refundStatus: 'actionRequired',
    });
  });

  it('marks exhausted and orphaned automatic claims for scanner attention', () => {
    const scheduled = {
      fulfillmentEventId: 'cancel-purchased',
      manuallyCreated: false,
      method: 'stripe' as const,
      quantity: 1,
      status: 'pending' as const,
      stripeRefundAttempts: 1,
      stripeRefundClaimLeaseExpiresAt: null,
      stripeRefundClaimLeaseId: null,
      stripeRefundMaxAttempts: 8,
      stripeRefundNextAttemptAt: new Date('2026-07-10T12:10:00.000Z'),
      stripeRefundStatus: 'pending' as const,
    };

    expect(registrationAddonRefundClaimProgress([scheduled])).toBe('pending');
    expect(
      registrationAddonRefundClaimProgress([
        { ...scheduled, stripeRefundAttempts: 8 },
      ]),
    ).toBe('failed');
    expect(
      registrationAddonRefundClaimProgress([
        { ...scheduled, stripeRefundNextAttemptAt: null },
      ]),
    ).toBe('failed');
  });
});

describe('fulfillment concurrency source guards', () => {
  const source = readFileSync(
    new URL('addon-fulfillment.service.ts', import.meta.url),
    'utf8',
  );

  it('reads fulfillment state from one repeatable-read snapshot', () => {
    expect(source).toContain("accessMode: 'read only'");
    expect(source).toContain("isolationLevel: 'repeatable read'");
  });

  it('selects the latest active redemption rather than a reversed event', () => {
    expect(source).toContain("'active_redemption_reversal'");
    expect(source).toContain('notExists(');
    expect(source).toContain('reversal.reversesEventId');
  });

  it('guards active transfers after taking the registration lock', () => {
    const lockHelper = source.slice(
      source.indexOf("Effect.fn('lockFulfillmentRows')"),
      source.indexOf('export const cancelRemainingRegistrationAddons'),
    );
    expect(lockHelper.indexOf('.from(eventRegistrations)')).toBeGreaterThan(-1);
    expect(
      lockHelper.indexOf('ensureRegistrationMutationHasNoActiveTransfer'),
    ).toBeGreaterThan(lockHelper.indexOf('.from(eventRegistrations)'));
    expect(
      lockHelper.indexOf('.from(eventRegistrationAddonPurchases)'),
    ).toBeGreaterThan(
      lockHelper.indexOf('ensureRegistrationMutationHasNoActiveTransfer'),
    );
  });

  it('locks current acquisition provenance before direct cancellation rows', () => {
    const cancellation = source.slice(
      source.indexOf('export const cancelRegistrationAddon'),
    );
    const registrationLock = cancellation.indexOf('.from(eventRegistrations)');
    const acquisitionLock = cancellation.indexOf(
      'lockCurrentRegistrationAcquisition',
    );
    const purchaseLock = cancellation.indexOf(
      '.from(eventRegistrationAddonPurchases)',
    );

    expect(registrationLock).toBeGreaterThan(-1);
    expect(acquisitionLock).toBeGreaterThan(registrationLock);
    expect(purchaseLock).toBeGreaterThan(acquisitionLock);
    expect(cancellation).not.toContain(
      'registrationTransferRecipientAddonPayments',
    );
    expect(cancellation).not.toContain(
      'registrationTransferRecipientAddonRefundAllocations',
    );
    expect(cancellation).not.toContain(
      'ensureRegistrationTransferAddonPaymentAllocations',
    );
  });
});
