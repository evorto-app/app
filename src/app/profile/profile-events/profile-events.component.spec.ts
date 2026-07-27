import { describe, expect, it } from 'vitest';

import {
  isStripeCheckoutUrl,
  profileEventActionNote,
  profileEventAddonPaidAmount,
  profileEventAudienceLabel,
  profileEventContinuePaymentUrl,
  profileEventGuestLabel,
  profileEventNextStepLabel,
  profileEventPassLabel,
  registrationPaymentLabel,
  registrationRefundSourceLabel,
  registrationRefundStateLabel,
  registrationStatusLabel,
} from './profile-events.component';

describe('profile event labels', () => {
  it('prices only purchased add-on units and leaves included units free', () => {
    expect(
      profileEventAddonPaidAmount({
        purchasedQuantity: 2,
        unitPrice: 500,
      }),
    ).toBe(1000);
    expect(
      profileEventAddonPaidAmount({
        purchasedQuantity: 0,
        unitPrice: 500,
      }),
    ).toBeNull();
  });

  it('keeps profile event actions focused on implemented paths', () => {
    expect(
      profileEventActionNote({
        cancellationReason: null,
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
        cancellationReason: null,
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
        cancellationReason: null,
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
      cancellationReason: null,
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
        cancellationReason: null,
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
        cancellationReason: null,
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
        cancellationReason: null,
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
        cancellationReason: null,
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
      cancellationReason: null,
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

  it('explains every eligibility cancellation category after payment without hiding refund progress', () => {
    const actionNote = profileEventActionNote({
      cancellationReason: 'eligibilityChangedAfterPayment',
      checkInTime: null,
      checkoutUrl: null,
      organizingRegistration: false,
      paymentState: 'recorded',
      refunds: [
        {
          amount: 2500,
          currency: 'EUR',
          source: 'registration',
          state: 'pending',
          updatedAt: '2026-03-01T10:05:00.000Z',
        },
      ],
      status: 'CANCELLED',
    });

    expect(actionNote).toContain(
      'the event or registration option was no longer available to you when payment completed',
    );
    expect(actionNote).toContain('the event is no longer published');
    expect(actionNote).toContain('the option was removed');
    expect(actionNote).toContain(
      'your organization membership or roles changed',
    );
    expect(actionNote).toContain(
      'The full amount you paid was queued for refund to your original payment method',
    );
    expect(actionNote).toContain('Money has not necessarily been returned yet');
    expect(actionNote).toContain('Do not retry this payment');
    expect(actionNote).toContain(
      "After the refund, review the event's current status and options or contact the organizer",
    );
  });
});
