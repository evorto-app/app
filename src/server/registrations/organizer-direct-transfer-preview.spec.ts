import { describe, expect, it } from 'vitest';

import {
  type OrganizerDirectTransferPreviewVersion,
  organizerDirectTransferPreviewVersion,
} from './organizer-direct-transfer-preview';

const previewState = (): OrganizerDirectTransferPreviewVersion => ({
  acquisitionId: 'acquisition-1',
  addOns: [
    {
      addonId: 'addon-1',
      cancelledQuantity: 0,
      currentUnitPrice: 0,
      description: 'Workshop materials',
      includedQuantity: 1,
      purchasedQuantity: 1,
      purchaseId: 'purchase-1',
      quantity: 2,
      redeemedQuantity: 0,
      title: 'Workshop kit',
    },
    {
      addonId: 'addon-2',
      cancelledQuantity: 0,
      currentUnitPrice: 0,
      description: null,
      includedQuantity: 1,
      purchasedQuantity: 0,
      purchaseId: 'purchase-2',
      quantity: 1,
      redeemedQuantity: 1,
      title: 'Dinner',
    },
  ],
  checkedInGuestCount: 1,
  checkInTime: new Date('2026-07-12T16:00:00.000Z'),
  guestCount: 2,
  guestUnitPrice: 0,
  lockedState: {
    acquisition: '{"id":"acquisition-1","ownerUserId":"source-1"}',
    acquisitionComponents: ['component-b', 'component-a'],
    acquisitionPayments: ['payment-b', 'payment-a'],
    addOnLots: ['lot-b', 'lot-a'],
    discountCards: ['card-b', 'card-a'],
    discounts: ['discount-b', 'discount-a'],
    pricing: '{"basePrice":0,"recipientPrice":0}',
    sourceRefunds: ['refund-b', 'refund-a'],
    sourceTransactions: ['transaction-b', 'transaction-a'],
    targetRoleIds: ['role-b', 'role-a'],
    taxRates: ['tax-b', 'tax-a'],
  },
  registrationId: 'registration-1',
  registrationOptionId: 'option-1',
  registrationOptionTitle: 'Participant',
  sourceUserId: 'source-1',
  targetUserId: 'target-1',
});

describe('organizerDirectTransferPreviewVersion', () => {
  it('is deterministic when repeated locked rows arrive in a different order', () => {
    const original = previewState();
    const reordered: OrganizerDirectTransferPreviewVersion = {
      ...original,
      addOns: original.addOns.toReversed(),
      lockedState: {
        ...original.lockedState,
        acquisitionComponents:
          original.lockedState.acquisitionComponents.toReversed(),
        acquisitionPayments:
          original.lockedState.acquisitionPayments.toReversed(),
        addOnLots: original.lockedState.addOnLots.toReversed(),
        discountCards: original.lockedState.discountCards.toReversed(),
        discounts: original.lockedState.discounts.toReversed(),
        sourceRefunds: original.lockedState.sourceRefunds.toReversed(),
        sourceTransactions:
          original.lockedState.sourceTransactions.toReversed(),
        targetRoleIds: original.lockedState.targetRoleIds.toReversed(),
        taxRates: original.lockedState.taxRates.toReversed(),
      },
    };

    expect(organizerDirectTransferPreviewVersion(reordered)).toBe(
      organizerDirectTransferPreviewVersion(original),
    );
  });

  it('changes whenever reviewed identity, bundle, fulfillment, or pricing state changes', () => {
    const original = previewState();
    const originalVersion = organizerDirectTransferPreviewVersion(original);
    const [firstAddOn, secondAddOn] = original.addOns;
    expect(firstAddOn).toBeDefined();
    expect(secondAddOn).toBeDefined();
    if (!firstAddOn || !secondAddOn) return;

    const changedStates: OrganizerDirectTransferPreviewVersion[] = [
      { ...original, targetUserId: 'target-2' },
      { ...original, sourceUserId: 'source-2' },
      { ...original, registrationId: 'registration-2' },
      { ...original, checkInTime: new Date('2026-07-12T16:05:00.000Z') },
      { ...original, checkedInGuestCount: 2 },
      { ...original, guestCount: 3 },
      {
        ...original,
        addOns: [{ ...firstAddOn, redeemedQuantity: 1 }, secondAddOn],
      },
      {
        ...original,
        addOns: [{ ...firstAddOn, currentUnitPrice: 500 }, secondAddOn],
      },
      {
        ...original,
        lockedState: {
          ...original.lockedState,
          acquisition: '{"id":"acquisition-2","ownerUserId":"source-1"}',
        },
      },
      {
        ...original,
        lockedState: {
          ...original.lockedState,
          sourceTransactions: ['transaction-c'],
        },
      },
      {
        ...original,
        lockedState: {
          ...original.lockedState,
          pricing: '{"basePrice":1200,"recipientPrice":0}',
        },
      },
      {
        ...original,
        lockedState: {
          ...original.lockedState,
          discountCards: ['card-c'],
        },
      },
    ];

    for (const changed of changedStates) {
      expect(organizerDirectTransferPreviewVersion(changed)).not.toBe(
        originalVersion,
      );
    }
  });
});
