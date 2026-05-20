import { describe, expect, it } from 'vitest';

import {
  esnCardMutationErrorMessage,
  esnCardSubmitPayloadFromIdentifier,
  profileEventActionNote,
  profileEventContinuePaymentUrl,
  profileEventDetailActionLabel,
  profileEventGuestLabel,
  profileEventNextStepLabel,
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
        checkoutUrl: null,
        paymentState: 'recorded',
        status: 'CONFIRMED',
      }),
    ).toBe(
      'Open the event page for ticket access and participant cancellation when the event still allows it. Automatic refunds and transfer/resale are not implemented yet.',
    );
    expect(
      profileEventActionNote({
        checkoutUrl: null,
        paymentState: 'notRequired',
        status: 'PENDING',
      }),
    ).toBe(
      'Open the event page for pending-registration details and available cancellation actions. Transfer/resale is not implemented yet.',
    );
    expect(
      profileEventActionNote({
        checkoutUrl: null,
        paymentState: 'notRequired',
        status: 'WAITLIST',
      }),
    ).toBe(
      'Open the event page for waitlist details and the leave-waitlist action. Transfer/resale is not available for waitlist registrations.',
    );
  });

  it('points pending checkout registrations at the implemented profile action', () => {
    expect(
      profileEventActionNote({
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
