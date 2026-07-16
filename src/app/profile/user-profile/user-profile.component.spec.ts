import { describe, expect, it } from 'vitest';

import {
  isBrowsingOutsideHomeTenant,
  isStripeCheckoutUrl,
  profileEditActionDisabled,
  profileEventActionNote,
  profileEventAudienceLabel,
  profileEventContinuePaymentUrl,
  profileEventDetailActionLabel,
  profileEventGuestLabel,
  profileEventNextStepLabel,
  profileEventPassLabel,
  profileSectionFromFragment,
  profileTransferClaimPath,
  profileUserAfterEdit,
  registrationPaymentLabel,
  registrationRefundSourceLabel,
  registrationRefundStateLabel,
  registrationStatusLabel,
} from './user-profile.component';

describe('profile account actions', () => {
  it('links the transfer claim action to the manual-code entry page', () => {
    expect(profileTransferClaimPath).toBe('/registration-transfers');
  });
});

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
        organizingRegistration: false,
        paymentState: 'recorded',
        status: 'CONFIRMED',
      }),
    ).toBe(
      "Open the event page for ticket access and to see whether cancellation or transfer is currently available. A transfer may be free or require the recipient to pay, based on current prices and the recipient's eligible discounts.",
    );
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: null,
        organizingRegistration: false,
        paymentState: 'notRequired',
        status: 'PENDING',
      }),
    ).toBe(
      'Open the event page for pending-registration details and current cancellation status.',
    );
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: null,
        organizingRegistration: false,
        paymentState: 'notRequired',
        status: 'WAITLIST',
      }),
    ).toBe(
      'Open the event page for waitlist details and current cancellation status.',
    );
  });

  it('explains that a checked-in registration can transfer with its history', () => {
    const actionNote = profileEventActionNote({
      checkInTime: '2026-02-01T10:30:00.000Z',
      checkoutUrl: null,
      organizingRegistration: false,
      paymentState: 'recorded',
      status: 'CONFIRMED',
    });

    expect(actionNote).toBe(
      'You are checked in. Open the event page for ticket details. Cancellation is no longer available; a transfer preserves the existing attendee and guest check-in history.',
    );
    expect(actionNote).not.toContain(
      'transfer is no longer available after check-in',
    );
  });

  it('points pending checkout registrations at the implemented profile action', () => {
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        organizingRegistration: false,
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
        organizingRegistration: false,
        paymentState: 'pending',
        status: 'PENDING',
      }),
    ).toBe(
      'Payment setup is still in progress. Open the event page for the latest payment link and current cancellation status.',
    );
  });

  it('identifies organizer/helper registrations and their available pass', () => {
    const organizerRegistration = { organizingRegistration: true };

    expect(profileEventAudienceLabel(organizerRegistration)).toBe(
      'Organizer/helper',
    );
    expect(profileEventPassLabel(organizerRegistration)).toBe('Pass');
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: null,
        organizingRegistration: true,
        paymentState: 'notRequired',
        status: 'CONFIRMED',
      }),
    ).toBe(
      'Open the event page for your organizer/helper pass, event management access, and current cancellation details.',
    );
    expect(
      profileEventActionNote({
        checkInTime: null,
        checkoutUrl: null,
        organizingRegistration: true,
        paymentState: 'notRequired',
        status: 'PENDING',
      }),
    ).toBe(
      'Open the event page for organizer/helper application and cancellation status. Organizer access starts only after approval and any required payment.',
    );

    expect(profileEventAudienceLabel({ organizingRegistration: false })).toBe(
      'Participant',
    );
    expect(profileEventPassLabel({ organizingRegistration: false })).toBe(
      'Ticket',
    );
  });

  it('shows the payment continuation or setup next step while payment is pending', () => {
    expect(
      profileEventNextStepLabel({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        paymentState: 'pending',
        status: 'PENDING',
      }),
    ).toBe('Finish the checkout payment to confirm your spot.');
    expect(
      profileEventNextStepLabel({
        checkoutUrl: null,
        paymentState: 'pending',
        status: 'PENDING',
      }),
    ).toBe(
      'Your payment link is being prepared. Refresh shortly or open the event page for the latest status.',
    );
    expect(
      profileEventNextStepLabel({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        paymentState: 'recorded',
        status: 'CONFIRMED',
      }),
    ).toBeNull();
    expect(
      profileEventNextStepLabel({
        checkoutUrl: 'javascript:alert(1)',
        paymentState: 'pending',
        status: 'PENDING',
      }),
    ).toBe(
      'Your payment link is being prepared. Refresh shortly or open the event page for the latest status.',
    );
    expect(
      profileEventNextStepLabel({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_stale',
        paymentState: 'pending',
        status: 'CANCELLED',
      }),
    ).toBeNull();
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

  it('never offers Checkout again for a cancelled registration', () => {
    expect(
      profileEventContinuePaymentUrl({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        paymentState: 'pending',
        status: 'CANCELLED',
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
    expect(registrationStatusLabel('CANCELLED')).toBe('Cancelled');
    expect(registrationStatusLabel('CONFIRMED')).toBe('Confirmed');
    expect(registrationStatusLabel('PENDING')).toBe('Pending');
    expect(registrationStatusLabel('WAITLIST')).toBe('Waitlist');
  });

  it('keeps participant refund sources and states actionable', () => {
    expect(registrationRefundSourceLabel('registration')).toBe(
      'Registration payment',
    );
    expect(registrationRefundSourceLabel('addon')).toBe('Add-on payment');
    expect(registrationRefundStateLabel('actionRequired')).toBe(
      'Contact organizer for refund update',
    );
    expect(registrationRefundStateLabel('pending')).toBe('Refund queued');
    expect(registrationRefundStateLabel('retrying')).toBe('Refund retrying');
    expect(registrationRefundStateLabel('needsAttention')).toBe(
      'Contact organizer for refund update',
    );
    expect(registrationRefundStateLabel('succeeded')).toBe('Refund completed');
  });

  it('keeps cancelled registrations visible with honest refund next steps', () => {
    const baseRefund = {
      amount: 2500,
      currency: 'EUR' as const,
      source: 'registration' as const,
      updatedAt: '2026-03-01T10:05:00.000Z',
    };
    const cancelledEvent = {
      checkInTime: null,
      checkoutUrl: null,
      organizingRegistration: false,
      paymentState: 'recorded' as const,
      status: 'CANCELLED' as const,
    };

    expect(
      profileEventActionNote({
        ...cancelledEvent,
        refunds: [{ ...baseRefund, state: 'pending' }],
      }),
    ).toContain('Money has not necessarily been returned yet');
    expect(
      profileEventActionNote({
        ...cancelledEvent,
        refunds: [
          { ...baseRefund, state: 'succeeded' },
          {
            ...baseRefund,
            source: 'addon',
            state: 'needsAttention',
          },
        ],
      }),
    ).toBe(
      'Your registration remains cancelled, but at least one refund needs organizer follow-up. Money has not necessarily been returned yet. Contact the organizer for an update. Do not pay or register again to retry it. 1 of 2 refunds is complete.',
    );
    const mixedFollowUp = profileEventActionNote({
      ...cancelledEvent,
      refunds: [
        { ...baseRefund, state: 'needsAttention' },
        {
          ...baseRefund,
          source: 'addon',
          state: 'actionRequired',
        },
      ],
    });
    expect(mixedFollowUp).toContain(
      'at least one refund needs organizer follow-up',
    );
    expect(mixedFollowUp).toContain('Contact the organizer for an update.');
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
      "We couldn't check this ESN card. Check the number and try again.",
    );
    expect(esnCardMutationErrorMessage('refresh', null)).toBe(
      "We couldn't refresh this ESN card. Try again.",
    );
    expect(esnCardMutationErrorMessage('remove', null)).toBe(
      "We couldn't remove this ESN card. Try again.",
    );
  });

  it('maps provider and RPC failures to product language', () => {
    expect(
      esnCardMutationErrorMessage('save', {
        message: 'ESNcard validation provider is unavailable',
      }),
    ).toBe("We couldn't check this ESN card. Check the number and try again.");
    expect(
      esnCardMutationErrorMessage('refresh', {
        _tag: 'RpcBadRequestError',
        reason: 'provider-timeout',
      }),
    ).toBe(
      'ESN card verification is temporarily unavailable. Try again later.',
    );
    expect(
      esnCardMutationErrorMessage('save', {
        _tag: 'DiscountCardConflictError',
      }),
    ).toBe(
      'This ESN card is already linked to another account in this organization.',
    );
    expect(
      esnCardMutationErrorMessage('refresh', {
        _tag: 'DiscountCardNotFoundError',
      }),
    ).toBe(
      'This ESN card is no longer saved. Reload the page to see your current cards.',
    );
    expect(
      esnCardMutationErrorMessage('save', { _tag: 'RpcForbiddenError' }),
    ).toBe('ESN card discounts are not available for this organization.');
    expect(
      esnCardMutationErrorMessage('refresh', {
        _tag: 'RpcInternalServerError',
      }),
    ).toBe(
      'ESN card verification is temporarily unavailable. Try again later.',
    );
    expect(
      esnCardMutationErrorMessage('remove', {
        _tag: 'RpcUnauthorizedError',
      }),
    ).toBe('Your session expired. Sign in again to manage your ESN card.');
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
