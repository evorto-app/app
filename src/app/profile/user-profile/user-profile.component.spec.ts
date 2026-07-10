import { describe, expect, it } from 'vitest';

import {
  isBrowsingOutsideHomeTenant,
  isStripeCheckoutUrl,
  profileEditActionDisabled,
  profileEventActionNote,
  profileEventContinuePaymentUrl,
  profileEventDetailActionLabel,
  profileEventGuestLabel,
  profileEventNextStepLabel,
  profileReceiptStatusLabel,
  profileSectionFromFragment,
  profileUserAfterEdit,
  registrationPaymentLabel,
  registrationStatusLabel,
} from './user-profile.component';

describe('profile home tenant state', () => {
  it('warns only when the current tenant differs from an explicit home tenant', () => {
    expect(isBrowsingOutsideHomeTenant('tenant-home', 'tenant-away')).toBe(
      true,
    );
    expect(isBrowsingOutsideHomeTenant('tenant-home', 'tenant-home')).toBe(
      false,
    );
    expect(isBrowsingOutsideHomeTenant(undefined, 'tenant-away')).toBe(false);
  });
});
import {
  esnCardActionDisabled,
  esnCardActionLabel,
  esnCardMutationErrorMessage,
  esnCardSaveDisabled,
  esnCardStatusLabel,
  esnCardSubmitPayloadFromIdentifier,
} from './user-profile.esn-card';

describe('profile event labels', () => {
  it('labels the event-details action without claiming profile ticket handling', () => {
    expect(profileEventDetailActionLabel()).toBe('Open event page');
  });

  it('keeps profile event actions focused on implemented paths', () => {
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: null,
        paymentState: 'recorded',
        status: 'CONFIRMED',
      }),
    ).toBe(
      'Open the event page for ticket access, participant cancellation, and unpaid self-service transfer when available.',
    );
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: null,
        paymentState: 'notRequired',
        status: 'PENDING',
      }),
    ).toBe(
      'Open the event page for pending-registration details and available cancellation actions.',
    );
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: null,
        paymentState: 'notRequired',
        status: 'WAITLIST',
      }),
    ).toBe(
      'Open the event page for waitlist details and the leave-waitlist action.',
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
      'You are checked in. Open the event page for ticket details. Cancellation and transfer are no longer available after check-in.',
    );
  });

  it('points pending checkout registrations at the implemented profile action', () => {
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        paymentState: 'pending',
        status: 'PENDING',
      }),
    ).toBe(
      'Continue payment from this card, or open the event page for registration details.',
    );
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: null,
        paymentState: 'pending',
        status: 'PENDING',
      }),
    ).toBe(
      'Payment setup is still in progress. Open the event page for the latest payment link or to cancel the registration.',
    );
  });

  it('shows the payment continuation or setup next step while payment is pending', () => {
    expect(
      profileEventNextStepLabel({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        paymentState: 'pending',
      }),
    ).toBe('Finish the checkout payment to confirm your spot.');
    expect(
      profileEventNextStepLabel({
        checkoutUrl: null,
        paymentState: 'pending',
      }),
    ).toBe(
      'Your payment link is being prepared. Refresh shortly or open the event page for the latest status.',
    );
    expect(
      profileEventNextStepLabel({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        paymentState: 'recorded',
      }),
    ).toBeNull();
    expect(
      profileEventNextStepLabel({
        checkoutUrl: 'javascript:alert(1)',
        paymentState: 'pending',
      }),
    ).toBe(
      'Your payment link is being prepared. Refresh shortly or open the event page for the latest status.',
    );
  });

  it('renders the payment continuation action only for pending checkout registrations', () => {
    expect(
      profileEventContinuePaymentUrl({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        paymentState: 'pending',
      }),
    ).toBe('https://checkout.stripe.com/pay/cs_test_123');
    expect(
      profileEventContinuePaymentUrl({
        checkoutUrl: null,
        paymentState: 'pending',
      }),
    ).toBeNull();
    expect(
      profileEventContinuePaymentUrl({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        paymentState: 'recorded',
      }),
    ).toBeNull();
    expect(
      profileEventContinuePaymentUrl({
        checkoutUrl: 'https://checkout.stripe.com.evil.example/pay',
        paymentState: 'pending',
      }),
    ).toBeNull();
  });

  it('only treats Stripe Checkout HTTPS URLs as continuation links', () => {
    expect(
      isStripeCheckoutUrl('https://checkout.stripe.com/pay/cs_test_123'),
    ).toBe(true);
    expect(
      isStripeCheckoutUrl('http://checkout.stripe.com/pay/cs_test_123'),
    ).toBe(false);
    expect(
      isStripeCheckoutUrl('https://checkout.stripe.com.evil.example/pay'),
    ).toBe(false);
    expect(isStripeCheckoutUrl('javascript:alert(1)')).toBe(false);
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

  it('merges saved profile fields into the visible profile cache', () => {
    expect(
      profileUserAfterEdit(
        {
          communicationEmail: 'old@example.com',
          email: 'login@example.com',
          firstName: 'Old',
          iban: null,
          id: 'user-1',
          lastName: 'Name',
          paypalEmail: null,
        },
        {
          communicationEmail: 'new@example.com',
          firstName: 'New',
          iban: 'DE89370400440532013000',
          lastName: 'Person',
          paypalEmail: null,
        },
      ),
    ).toEqual({
      communicationEmail: 'new@example.com',
      email: 'login@example.com',
      firstName: 'New',
      iban: 'DE89370400440532013000',
      id: 'user-1',
      lastName: 'Person',
      paypalEmail: null,
    });
  });
});

describe('profile receipt labels', () => {
  it('keeps submitted receipt statuses readable on profile cards', () => {
    expect(profileReceiptStatusLabel('approved')).toBe('Approved');
    expect(profileReceiptStatusLabel('refunded')).toBe('Reimbursed');
    expect(profileReceiptStatusLabel('rejected')).toBe('Rejected');
    expect(profileReceiptStatusLabel('submitted')).toBe('Submitted');
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
