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
      'Open the event page for your ticket and to see whether you can cancel or transfer it. A transfer may be free, or the recipient may need to pay, based on current prices and the discounts available to them.',
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
      'Open the event page for details about your pending sign-up and whether you can cancel it.',
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
      'Open the event page for waitlist details and whether you can leave it.',
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
      'You are checked in. Open the event page for ticket details. You can no longer cancel, but you can still transfer the ticket and its existing check-ins.',
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
      'Finish payment here, or open the event page for your sign-up details.',
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
      'Payment is not ready yet. Open the event page to check the current payment option. Your place is not confirmed.',
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
      'Open the event page for your organizer/helper pass, organizer tools, and cancellation details.',
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
      'Open the event page for your organizer/helper application and whether you can cancel it. Organizer tools become available after approval and any required payment.',
    );

    expect(profileEventAudienceLabel({ organizingRegistration: false })).toBe(
      'Attendee',
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
    ).toBe('Finish payment to confirm your place.');
    expect(
      profileEventNextStepLabel({
        checkoutUrl: null,
        paymentState: 'pending',
        status: 'PENDING',
      }),
    ).toBe(
      'Payment is not ready yet. Open the event page to check the current payment option. Your place is not confirmed.',
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
      'Payment is not ready yet. Open the event page to check the current payment option. Your place is not confirmed.',
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
    expect(registrationPaymentLabel('pending')).toBe('Payment not finished');
    expect(registrationPaymentLabel('recorded')).toBe('Paid');
  });

  it('keeps registration status labels aligned with persisted states', () => {
    expect(registrationStatusLabel('CANCELLED')).toBe('Cancelled');
    expect(registrationStatusLabel('CONFIRMED')).toBe('Confirmed');
    expect(registrationStatusLabel('PENDING')).toBe('Waiting for confirmation');
    expect(registrationStatusLabel('WAITLIST')).toBe('On waitlist');
  });

  it('keeps participant refund sources and states actionable', () => {
    expect(registrationRefundSourceLabel('registration')).toBe('Event payment');
    expect(registrationRefundSourceLabel('addon')).toBe('Add-on payment');
    expect(registrationRefundStateLabel('actionRequired')).toBe(
      'Contact the organizer',
    );
    expect(registrationRefundStateLabel('pending')).toBe('Refund requested');
    expect(registrationRefundStateLabel('retrying')).toBe('Refund delayed');
    expect(registrationRefundStateLabel('needsAttention')).toBe(
      'Contact the organizer',
    );
    expect(registrationRefundStateLabel('succeeded')).toBe('Refund complete');
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
    ).toContain('The money may not have reached your account yet');
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
      'Your sign-up remains cancelled, but at least one refund needs help from the organizer. The money may not have reached your account yet. Contact the organizer for an update. Do not pay or sign up again while you wait. 1 of 2 refunds is complete.',
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
      'at least one refund needs help from the organizer',
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
      'you were no longer able to join when payment finished',
    );
    expect(actionNote).toContain('The event may no longer be published');
    expect(actionNote).toContain('the sign-up choice may have been removed');
    expect(actionNote).toContain(
      'your access in the organization may have changed',
    );
    expect(actionNote).toContain(
      'A full refund has been requested for the payment method you used',
    );
    expect(actionNote).toContain(
      'The money may not have reached your account yet',
    );
    expect(actionNote).toContain('Do not make this payment again');
    expect(actionNote).toContain(
      'After the refund, check whether you can still sign up or contact the organizer',
    );
  });
});
