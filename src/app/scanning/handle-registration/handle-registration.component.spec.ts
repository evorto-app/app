import { describe, expect, it, vi } from 'vitest';

import {
  registrationAddonCancellationBlockedMessage,
  registrationAddonCancellationSuccessMessage,
  registrationAddonOperationKey,
  registrationAddonQuantitySummary,
  RegistrationAddonRedeemIntentStore,
  registrationAddonRefundStatusLabel,
  scanCheckInActionDisabled,
  scanCheckInButtonLabel,
  scanCheckInTimingIssueCopy,
  scanGuestCheckInCountFromInput,
  scannerRegistrationErrorMessage,
  scanRegistrationStatusIssueCopy,
  scanSpotCountLabel,
} from './handle-registration.component';

describe('scanner registration error messages', () => {
  it('shows check-in and registration outcomes without exposing internal failures', () => {
    const fallback = 'Check-in could not be completed. Try again.';
    expect(
      scannerRegistrationErrorMessage(
        {
          _tag: 'EventCheckInUnavailableError',
          message: 'Check-in opens one hour before this event starts.',
        },
        fallback,
      ),
    ).toBe('Check-in opens one hour before this event starts.');
    expect(
      scannerRegistrationErrorMessage(
        {
          _tag: 'EventRegistrationInternalError',
          message: 'database failed',
        },
        fallback,
      ),
    ).toBe(fallback);
  });
});

describe('registration add-on fulfillment copy', () => {
  it('explains every cancellation block without exposing an unusable action', () => {
    expect(registrationAddonCancellationBlockedMessage('none')).toBe('');
    expect(registrationAddonCancellationBlockedMessage('permission')).toBe(
      'You cannot cancel these items. Ask someone who manages tickets and add-ons for this event.',
    );
    expect(
      registrationAddonCancellationBlockedMessage('registrationStatus'),
    ).toBe('Add-on items can be cancelled only while the ticket is confirmed.');
    expect(registrationAddonCancellationBlockedMessage('noQuantity')).toBe(
      'No unused items remain to cancel.',
    );
  });

  it('keeps retry keys stable for the same visible fulfillment intent', () => {
    expect(
      registrationAddonOperationKey({
        action: 'redeem',
        intentNonce: 'intent-a',
        latestFulfillmentEventId: 'history-1',
        registrationAddonId: 'add-on-1',
      }),
    ).toBe('scanner-redeem:add-on-1:intent-a');
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

  it('reuses one intent nonce for retry and isolates clients on the same snapshot', () => {
    const snapshot = {
      latestFulfillmentEventId: '11111111-1111-4111-8111-111111111111',
      registrationAddonId: '22222222-2222-4222-8222-222222222222',
    } as const;
    const organizerANonce = vi.fn(() => 'a'.repeat(32));
    const organizerBNonce = vi.fn(() => 'b'.repeat(32));
    const organizerAStore = new RegistrationAddonRedeemIntentStore(
      organizerANonce,
    );
    const organizerBStore = new RegistrationAddonRedeemIntentStore(
      organizerBNonce,
    );
    const organizerAIntent = organizerAStore.forSnapshot(snapshot);
    const organizerBIntent = organizerBStore.forSnapshot(snapshot);
    const organizerAFirstAttempt =
      registrationAddonOperationKey(organizerAIntent);
    const organizerARetry = registrationAddonOperationKey(
      organizerAStore.forSnapshot(snapshot),
    );
    const organizerBFirstAttempt =
      registrationAddonOperationKey(organizerBIntent);

    expect(organizerANonce).toHaveBeenCalledOnce();
    expect(organizerBNonce).toHaveBeenCalledOnce();
    expect(organizerARetry).toBe(organizerAFirstAttempt);
    expect(organizerBFirstAttempt).not.toBe(organizerAFirstAttempt);
    expect(organizerAFirstAttempt).toBe(
      `scanner-redeem:22222222-2222-4222-8222-222222222222:${'a'.repeat(32)}`,
    );
    expect(organizerAFirstAttempt.length).toBeLessThanOrEqual(100);
  });

  it('retries a commit-then-response-loss with the same key until success or changed fulfillment state', () => {
    const createNonce = vi
      .fn<() => string>()
      .mockReturnValueOnce('committed-intent')
      .mockReturnValueOnce('after-state-change')
      .mockReturnValueOnce('after-success');
    const store = new RegistrationAddonRedeemIntentStore(createNonce);
    const snapshot = {
      latestFulfillmentEventId: 'history-1',
      registrationAddonId: 'add-on-1',
    } as const;

    const committedRequest = registrationAddonOperationKey(
      store.forSnapshot(snapshot),
    );
    // The server committed, but the component received a transport failure and
    // therefore deliberately does not call complete().
    const responseLossRetry = registrationAddonOperationKey(
      store.forSnapshot(snapshot),
    );
    const sameSnapshotAfterRefetch = registrationAddonOperationKey(
      store.forSnapshot({ ...snapshot }),
    );
    const afterChangedFulfillment = registrationAddonOperationKey(
      store.forSnapshot({
        ...snapshot,
        latestFulfillmentEventId: 'history-2',
      }),
    );
    store.complete(snapshot.registrationAddonId);
    const afterKnownSuccess = registrationAddonOperationKey(
      store.forSnapshot(snapshot),
    );

    expect(responseLossRetry).toBe(committedRequest);
    expect(sameSnapshotAfterRefetch).toBe(committedRequest);
    expect(afterChangedFulfillment).not.toBe(committedRequest);
    expect(afterKnownSuccess).not.toBe(afterChangedFulfillment);
    expect(createNonce).toHaveBeenCalledTimes(3);
  });

  it('keeps every durable refund state explicit', () => {
    expect(registrationAddonRefundStatusLabel('actionRequired')).toBe(
      'Refund needs review',
    );
    expect(registrationAddonRefundStatusLabel('notApplicable')).toBe(
      'Not applicable',
    );
    expect(registrationAddonRefundStatusLabel('notRequested')).toBe(
      'No refund requested',
    );
    expect(registrationAddonRefundStatusLabel('pending')).toBe(
      'Refund in progress',
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
      'No refund needed',
    );
  });

  it('explains every cancellation outcome without suggesting a duplicate action', () => {
    expect(registrationAddonCancellationSuccessMessage('actionRequired')).toBe(
      'The items were cancelled, but the refund needs attention. Do not cancel them or charge again. Ask an administrator to review this ticket.',
    );
    expect(
      registrationAddonCancellationSuccessMessage('cancelledWithoutRefund'),
    ).toBe('The items were cancelled without a refund, as requested.');
    expect(registrationAddonCancellationSuccessMessage('failed')).toBe(
      'The items were cancelled, but the refund needs attention. Do not cancel them or charge again. Ask an administrator to review this ticket.',
    );
    expect(registrationAddonCancellationSuccessMessage('notApplicable')).toBe(
      'The items were cancelled. No refund applies to this add-on.',
    );
    expect(registrationAddonCancellationSuccessMessage('notRequested')).toBe(
      'The items were cancelled. No refund was requested.',
    );
    expect(registrationAddonCancellationSuccessMessage('notRequired')).toBe(
      'The items were cancelled. No refund was needed.',
    );
    expect(
      registrationAddonCancellationSuccessMessage('partiallyRefunded'),
    ).toBe(
      'The items were cancelled. Part of the refund is complete; the rest is still in progress.',
    );
    expect(registrationAddonCancellationSuccessMessage('pending')).toBe(
      'The items were cancelled. The refund has started.',
    );
    expect(registrationAddonCancellationSuccessMessage('refunded')).toBe(
      'The items were cancelled and refunded.',
    );
  });

  it('summarizes settled add-on sources without repeating remaining counts', () => {
    expect(
      registrationAddonQuantitySummary({
        includedQuantity: 2,
        purchasedQuantity: 1,
      }),
    ).toBe('2 included · 1 purchased');
    expect(
      registrationAddonQuantitySummary({
        includedQuantity: 0,
        purchasedQuantity: 1,
      }),
    ).toBe('1 purchased');
    expect(
      registrationAddonQuantitySummary({
        includedQuantity: 0,
        purchasedQuantity: 0,
      }),
    ).toBe('No items');
  });
});

describe('scan registration status copy', () => {
  it('keeps confirmed registrations free of a status warning', () => {
    expect(scanRegistrationStatusIssueCopy('CONFIRMED')).toBeNull();
  });

  it('explains cancelled tickets without asking the attendee to pay again', () => {
    const copy = scanRegistrationStatusIssueCopy('CANCELLED');

    expect(copy).toEqual({
      body: 'This sign-up has ended and cannot be checked in. Do not ask the attendee to pay or sign up again. If the cancellation or refund looks wrong, review the existing sign-up instead of creating a replacement.',
      title: 'Sign-up ended',
    });
    expect(copy?.body).not.toContain('check if they paid');
  });

  it('distinguishes pending approval or payment from a duplicate payment', () => {
    expect(scanRegistrationStatusIssueCopy('PENDING')).toEqual({
      body: 'This ticket is not confirmed yet and cannot be checked in. Ask the attendee to open the event or Profile to see whether organizer approval or their existing payment is still needed. Do not start another sign-up or payment from the scanner.',
      title: 'Sign-up pending',
    });
  });

  it('explains that a waitlisted attendee has no confirmed place', () => {
    expect(scanRegistrationStatusIssueCopy('WAITLIST')).toEqual({
      body: 'This attendee does not have a confirmed place yet and cannot be checked in. Ask an organizer to review the waitlist and available places. Do not take payment or start another sign-up from the scanner.',
      title: 'On waitlist',
    });
  });
});

describe('scan check-in timing copy', () => {
  it('distinguishes a future event from a closed event', () => {
    expect(scanCheckInTimingIssueCopy('notOpen')).toEqual({
      body: 'Check-in opens one hour before the event starts.',
      title: 'Check-in not open',
    });
    expect(scanCheckInTimingIssueCopy('ended')).toEqual({
      body: 'The event ended more than two hours ago, so check-in is closed. The attendee was not checked in.',
      title: 'Check-in closed',
    });
    expect(scanCheckInTimingIssueCopy(null)).toBeNull();
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
    expect(scanSpotCountLabel(1)).toBe('1 place now');
    expect(scanSpotCountLabel(3)).toBe('3 places now');
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
