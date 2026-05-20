import { describe, expect, it } from 'vitest';

import {
  esnCardActionDisabled,
  esnCardActionLabel,
  esnCardMutationErrorMessage,
  esnCardSaveDisabled,
  esnCardStatusLabel,
  esnCardSubmitPayloadFromIdentifier,
  profileEditActionDisabled,
  profileEventActionNote,
  profileEventContinuePaymentUrl,
  profileEventDetailActionLabel,
  profileEventGuestLabel,
  profileEventNextStepLabel,
  profileReceiptAmountLabel,
  profileReceiptStatusLabel,
  profileSectionFromFragment,
  registrationPaymentLabel,
  registrationStatusLabel,
} from './user-profile.component';

describe('profile event labels', () => {
  it('labels the event-details action without claiming profile ticket handling', () => {
    expect(profileEventDetailActionLabel()).toBe('Open event page');
  });

  it('keeps deferred profile event actions explicit', () => {
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: null,
        paymentState: 'recorded',
        status: 'CONFIRMED',
      }),
    ).toBe(
      'Open the event page for ticket access, participant cancellation, and unpaid self-service transfer when available. Automatic refunds, paid transfer, and resale are not automatic yet.',
    );
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: null,
        paymentState: 'notRequired',
        status: 'PENDING',
      }),
    ).toBe(
      'Open the event page for pending-registration details and available cancellation actions. Self-service transfer/resale is not available yet.',
    );
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: null,
        paymentState: 'notRequired',
        status: 'WAITLIST',
      }),
    ).toBe(
      'Open the event page for waitlist details and the leave-waitlist action. Transfer/resale is not available for waitlist registrations.',
    );
  });

  it('does not advertise cancellation or transfer after check-in', () => {
    expect(
      profileEventActionNote({
        checkInTime: '2026-02-01T10:30:00.000Z',
        checkoutUrl: null,
        paymentState: 'recorded',
        status: 'CONFIRMED',
      }),
    ).toBe(
      'You are checked in. Open the event page for ticket details. Cancellation and transfer are no longer available after check-in. Automatic refunds, paid transfer, and resale are not automatic yet.',
    );
  });

  it('points pending checkout registrations at the implemented profile action', () => {
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: 'https://checkout.stripe.test/pay',
        paymentState: 'pending',
        status: 'PENDING',
      }),
    ).toBe(
      'Continue payment from this card, or open the event page for registration details. Cancellation after confirmation is handled on the event page.',
    );
  });

  it('shows the payment continuation next step only when a checkout link exists', () => {
    expect(
      profileEventNextStepLabel({
        checkoutUrl: 'https://checkout.stripe.test/pay',
        paymentState: 'pending',
      }),
    ).toBe('Finish the checkout payment to confirm your spot.');
    expect(
      profileEventNextStepLabel({
        checkoutUrl: null,
        paymentState: 'pending',
      }),
    ).toBeNull();
    expect(
      profileEventNextStepLabel({
        checkoutUrl: 'https://checkout.stripe.test/pay',
        paymentState: 'recorded',
      }),
    ).toBeNull();
  });

  it('renders the payment continuation action only for pending checkout registrations', () => {
    expect(
      profileEventContinuePaymentUrl({
        checkoutUrl: 'https://checkout.stripe.test/pay',
        paymentState: 'pending',
      }),
    ).toBe('https://checkout.stripe.test/pay');
    expect(
      profileEventContinuePaymentUrl({
        checkoutUrl: null,
        paymentState: 'pending',
      }),
    ).toBeNull();
    expect(
      profileEventContinuePaymentUrl({
        checkoutUrl: 'https://checkout.stripe.test/pay',
        paymentState: 'recorded',
      }),
    ).toBeNull();
  });

  it('labels guest quantities only when a registration includes guests', () => {
    expect(profileEventGuestLabel(0)).toBeNull();
    expect(profileEventGuestLabel(1)).toBe('Includes 1 guest');
    expect(profileEventGuestLabel(2)).toBe('Includes 2 guests');
  });

  it('keeps registration payment states readable', () => {
    expect(registrationPaymentLabel('cancelled')).toBe('Payment cancelled');
    expect(registrationPaymentLabel('notRequired')).toBe('No payment required');
    expect(registrationPaymentLabel('pending')).toBe('Payment pending');
    expect(registrationPaymentLabel('recorded')).toBe('Payment recorded');
  });

  it('keeps registration status labels aligned with persisted states', () => {
    expect(registrationStatusLabel('CONFIRMED')).toBe('Confirmed');
    expect(registrationStatusLabel('PENDING')).toBe('Pending');
    expect(registrationStatusLabel('WAITLIST')).toBe('Waitlist');
  });
});

describe('profile ESN card messages', () => {
  it('keeps ESN card action labels aligned with pending states', () => {
    expect(esnCardActionLabel('refresh', false)).toBe('Refresh');
    expect(esnCardActionLabel('refresh', true)).toBe('Refreshing...');
    expect(esnCardActionLabel('remove', false)).toBe('Remove');
    expect(esnCardActionLabel('remove', true)).toBe('Removing...');
    expect(esnCardActionLabel('save', false)).toBe('Save ESN card');
    expect(esnCardActionLabel('save', true)).toBe('Checking ESN card...');
  });

  it('keeps ESN card save disabled while invalid, submitting, or validating', () => {
    expect(
      esnCardSaveDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      esnCardSaveDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      esnCardSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      esnCardSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });

  it('blocks ESN card actions while any card write is pending', () => {
    expect(
      esnCardActionDisabled({
        deletePending: true,
        refreshPending: false,
        upsertPending: false,
      }),
    ).toBe(true);
    expect(
      esnCardActionDisabled({
        deletePending: false,
        refreshPending: true,
        upsertPending: false,
      }),
    ).toBe(true);
    expect(
      esnCardActionDisabled({
        deletePending: false,
        refreshPending: false,
        upsertPending: true,
      }),
    ).toBe(true);
    expect(
      esnCardActionDisabled({
        deletePending: false,
        refreshPending: false,
        upsertPending: false,
      }),
    ).toBe(false);
  });

  it('keeps persisted ESN card statuses readable in profile cards', () => {
    expect(esnCardStatusLabel('expired')).toBe('Expired');
    expect(esnCardStatusLabel('invalid')).toBe('Invalid');
    expect(esnCardStatusLabel('unverified')).toBe('Needs verification');
    expect(esnCardStatusLabel('verified')).toBe('Verified');
  });

  it('trims the ESN card identifier before submitting the upsert mutation', () => {
    expect(esnCardSubmitPayloadFromIdentifier('  ABCD1234  ')).toEqual({
      identifier: 'ABCD1234',
      type: 'esnCard',
    });
  });

  it('uses readable fallback messages for save, refresh, and remove failures', () => {
    expect(esnCardMutationErrorMessage('save', null)).toBe(
      'Could not validate ESN card',
    );
    expect(esnCardMutationErrorMessage('refresh', null)).toBe(
      'Could not refresh ESN card',
    );
    expect(esnCardMutationErrorMessage('remove', null)).toBe(
      'Could not remove ESN card',
    );
  });

  it('prefers provider and RPC messages over generic fallback text', () => {
    expect(
      esnCardMutationErrorMessage('save', {
        message: 'ESNcard validation provider is unavailable',
      }),
    ).toBe('ESNcard validation provider is unavailable');
    expect(
      esnCardMutationErrorMessage('refresh', {
        _tag: 'RpcBadRequestError',
      }),
    ).toBe('Bad Request');
  });
});

describe('profile edit actions', () => {
  it('blocks profile edit while an update is pending', () => {
    expect(
      profileEditActionDisabled({
        mutationPending: false,
      }),
    ).toBe(false);
    expect(
      profileEditActionDisabled({
        mutationPending: true,
      }),
    ).toBe(true);
  });
});

describe('profile receipt labels', () => {
  it('keeps submitted receipt statuses readable on profile cards', () => {
    expect(profileReceiptStatusLabel('approved')).toBe('Approved');
    expect(profileReceiptStatusLabel('refunded')).toBe('Reimbursed');
    expect(profileReceiptStatusLabel('rejected')).toBe('Rejected');
    expect(profileReceiptStatusLabel('submitted')).toBe('Submitted');
  });

  it('formats submitted receipt card amounts from cents', () => {
    expect(profileReceiptAmountLabel(0)).toBe('0.00 €');
    expect(profileReceiptAmountLabel(100)).toBe('1.00 €');
    expect(profileReceiptAmountLabel(12_345)).toBe('123.45 €');
  });
});

describe('profile section fragments', () => {
  it('keeps ESN discounts hidden until the tenant provider is enabled', () => {
    expect(profileSectionFromFragment('discounts', false)).toBe('overview');
    expect(profileSectionFromFragment('discounts', true)).toBe('discounts');
  });

  it('routes stable non-provider-gated fragments directly', () => {
    expect(profileSectionFromFragment('events', false)).toBe('events');
    expect(profileSectionFromFragment('receipts', false)).toBe('receipts');
    expect(profileSectionFromFragment(null, true)).toBe('overview');
    expect(profileSectionFromFragment('unknown', true)).toBe('overview');
  });
});
