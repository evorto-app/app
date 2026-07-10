import { describe, expect, it } from 'vitest';

import {
  registrationAddonCancellationBlockedMessage,
  registrationAddonOperationKey,
  registrationAddonRefundStatusLabel,
  scanCheckInActionDisabled,
  scanCheckInButtonLabel,
  scanGuestCheckInCountFromInput,
  scanSpotCountLabel,
} from './handle-registration.component';

describe('registration add-on fulfillment copy', () => {
  it('explains every cancellation block without exposing an unusable action', () => {
    expect(registrationAddonCancellationBlockedMessage('none')).toBe('');
    expect(registrationAddonCancellationBlockedMessage('permission')).toBe(
      'Cancelling units requires Cancel registrations and add-ons access.',
    );
    expect(
      registrationAddonCancellationBlockedMessage('registrationStatus'),
    ).toBe('Add-on units can only be cancelled for a confirmed registration.');
    expect(registrationAddonCancellationBlockedMessage('noQuantity')).toBe(
      'No unredeemed units remain to cancel.',
    );
  });

  it('keeps retry keys stable for the same visible fulfillment intent', () => {
    expect(
      registrationAddonOperationKey({
        action: 'redeem',
        latestFulfillmentEventId: 'history-1',
        registrationAddonId: 'add-on-1',
      }),
    ).toBe('scanner-redeem:add-on-1:history-1');
    expect(
      registrationAddonOperationKey({
        action: 'undo',
        redemptionEventId: 'redemption-1',
      }),
    ).toBe('scanner-undo:redemption-1');
    expect(
      registrationAddonOperationKey({
        action: 'cancel',
        latestFulfillmentEventId: 'history-1',
        quantity: 2,
        refundRequested: true,
        registrationAddonId: 'add-on-1',
      }),
    ).toBe('scanner-cancel:add-on-1:history-1:2:refund');
    expect(
      registrationAddonOperationKey({
        action: 'cancel',
        latestFulfillmentEventId: 'history-1',
        quantity: 2,
        refundRequested: false,
        registrationAddonId: 'add-on-1',
      }),
    ).toBe('scanner-cancel:add-on-1:history-1:2:no-refund');
  });

  it('uses distinct keys for redeem A, undo A, and redeem B after the undo', () => {
    const redeemA = registrationAddonOperationKey({
      action: 'redeem',
      latestFulfillmentEventId: null,
      registrationAddonId: 'add-on-1',
    });
    const redeemARetry = registrationAddonOperationKey({
      action: 'redeem',
      latestFulfillmentEventId: null,
      registrationAddonId: 'add-on-1',
    });
    const undoA = registrationAddonOperationKey({
      action: 'undo',
      redemptionEventId: 'redemption-a',
    });
    const redeemB = registrationAddonOperationKey({
      action: 'redeem',
      latestFulfillmentEventId: 'undo-a',
      registrationAddonId: 'add-on-1',
    });

    expect(redeemARetry).toBe(redeemA);
    expect(redeemA).toBe('scanner-redeem:add-on-1:initial');
    expect(undoA).toBe('scanner-undo:redemption-a');
    expect(redeemB).toBe('scanner-redeem:add-on-1:undo-a');
    expect(new Set([redeemA, redeemB, undoA]).size).toBe(3);
  });

  it('keeps every durable refund state explicit', () => {
    expect(registrationAddonRefundStatusLabel('notApplicable')).toBe(
      'Not applicable',
    );
    expect(registrationAddonRefundStatusLabel('notRequested')).toBe(
      'No refund requested',
    );
    expect(registrationAddonRefundStatusLabel('pending')).toBe(
      'Refund processing',
    );
    expect(registrationAddonRefundStatusLabel('partiallyRefunded')).toBe(
      'Partially refunded',
    );
    expect(registrationAddonRefundStatusLabel('refunded')).toBe('Refunded');
    expect(registrationAddonRefundStatusLabel('failed')).toBe(
      'Refund needs attention',
    );
    expect(registrationAddonRefundStatusLabel('cancelledWithoutRefund')).toBe(
      'Cancelled without refund',
    );
    expect(registrationAddonRefundStatusLabel('notRequired')).toBe(
      'No monetary refund required',
    );
  });
});

describe('scanCheckInActionDisabled', () => {
  it('blocks check-in when unavailable, pending, or empty', () => {
    expect(
      scanCheckInActionDisabled({
        allowCheckin: false,
        completed: false,
        mutationPending: false,
        spotCount: 1,
      }),
    ).toBe(true);
    expect(
      scanCheckInActionDisabled({
        allowCheckin: true,
        completed: false,
        mutationPending: true,
        spotCount: 1,
      }),
    ).toBe(true);
    expect(
      scanCheckInActionDisabled({
        allowCheckin: true,
        completed: false,
        mutationPending: false,
        spotCount: 0,
      }),
    ).toBe(true);
    expect(
      scanCheckInActionDisabled({
        allowCheckin: true,
        completed: false,
        mutationPending: false,
        spotCount: 1,
      }),
    ).toBe(false);
    expect(
      scanCheckInActionDisabled({
        allowCheckin: true,
        completed: true,
        mutationPending: false,
        spotCount: 1,
      }),
    ).toBe(true);
  });
});

describe('scan check-in copy', () => {
  it('keeps the primary check-in action readable for one or more spots', () => {
    expect(
      scanCheckInButtonLabel({
        completed: false,
        pending: false,
        spotCount: 1,
      }),
    ).toBe('Confirm check-in');
    expect(
      scanCheckInButtonLabel({
        completed: false,
        pending: false,
        spotCount: 3,
      }),
    ).toBe('Confirm 3 check-ins');
  });

  it('keeps the pending action state short and active', () => {
    expect(
      scanCheckInButtonLabel({
        completed: false,
        pending: true,
        spotCount: 3,
      }),
    ).toBe('Checking in…');
  });

  it('shows completed check-ins as final', () => {
    expect(
      scanCheckInButtonLabel({
        completed: true,
        pending: false,
        spotCount: 1,
      }),
    ).toBe('Checked in');
  });

  it('uses singular and plural spot suffixes for guest check-in selection', () => {
    expect(scanSpotCountLabel(1)).toBe('1 spot now');
    expect(scanSpotCountLabel(3)).toBe('3 spots now');
  });
});

describe('scanGuestCheckInCountFromInput', () => {
  it('keeps guest check-in selection within the remaining guest count', () => {
    expect(
      scanGuestCheckInCountFromInput({
        inputValue: '2',
        remainingGuestCount: 3,
      }),
    ).toBe(2);
    expect(
      scanGuestCheckInCountFromInput({
        inputValue: '8',
        remainingGuestCount: 3,
      }),
    ).toBe(3);
  });

  it('normalizes blank, invalid, and negative guest selections to zero', () => {
    for (const inputValue of ['', 'not-a-number', '-2']) {
      expect(
        scanGuestCheckInCountFromInput({
          inputValue,
          remainingGuestCount: 3,
        }),
      ).toBe(0);
    }
  });
});
