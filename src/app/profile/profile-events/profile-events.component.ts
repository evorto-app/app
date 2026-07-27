import type { UsersEventSummaryRecord } from '@shared/rpc-contracts/app-rpcs/users.rpcs';

import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faCalendarDays } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { TenantDatePipe } from '../../core/tenant-date.pipe';

type ProfileEventRefund = UsersEventSummaryRecord['refunds'][number];

export const profileEventGuestLabel = (guestCount: number): null | string => {
  if (guestCount <= 0) {
    return null;
  }

  return guestCount === 1
    ? 'Includes 1 guest'
    : `Includes ${guestCount} guests`;
};

export const profileEventAddonPaidAmount = (addOnPurchase: {
  purchasedQuantity: number;
  unitPrice: number;
}): null | number =>
  addOnPurchase.purchasedQuantity > 0 && addOnPurchase.unitPrice > 0
    ? addOnPurchase.purchasedQuantity * addOnPurchase.unitPrice
    : null;

export const profileEventAudienceLabel = (event: {
  organizingRegistration: boolean;
}): string =>
  event.organizingRegistration ? 'Organizer/helper' : 'Participant';

export const profileEventPassLabel = (event: {
  organizingRegistration: boolean;
}): string => (event.organizingRegistration ? 'Pass' : 'Ticket');

export const profileEventNextStepLabel = (event: {
  checkoutUrl: null | string;
  paymentState: 'cancelled' | 'notRequired' | 'pending' | 'recorded';
  status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
}): null | string => {
  if (event.status === 'CANCELLED') {
    return null;
  }

  if (profileEventContinuePaymentUrl(event)) {
    return 'Finish the checkout payment to confirm your spot.';
  }

  if (event.paymentState === 'pending') {
    return 'Your payment link is being prepared. Refresh shortly or open the event page for the latest status.';
  }

  return null;
};

export const isStripeCheckoutUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com';
  } catch {
    return false;
  }
};

export const profileEventContinuePaymentUrl = (event: {
  checkoutUrl: null | string;
  paymentState: 'cancelled' | 'notRequired' | 'pending' | 'recorded';
  status?: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
}): null | string => {
  if (
    event.status === 'CANCELLED' ||
    event.paymentState !== 'pending' ||
    !event.checkoutUrl ||
    !isStripeCheckoutUrl(event.checkoutUrl)
  ) {
    return null;
  }

  return event.checkoutUrl;
};

export const profileEventActionNote = (event: {
  cancellationReason: UsersEventSummaryRecord['cancellationReason'];
  checkInTime?: null | string;
  checkoutUrl: null | string;
  organizingRegistration: boolean;
  paymentState: 'cancelled' | 'notRequired' | 'pending' | 'recorded';
  refunds?: readonly ProfileEventRefund[];
  status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
}): string => {
  if (event.status === 'CANCELLED') {
    const eligibilityChangedCopy =
      event.cancellationReason === 'eligibilityChangedAfterPayment'
        ? 'Your registration was cancelled because the event or registration option was no longer available to you when payment completed. This can happen if the event is no longer published, the option was removed, or your organization membership or roles changed. The full amount you paid was queued for refund to your original payment method.'
        : null;
    const refunds = event.refunds ?? [];
    const completedClaims = refunds.filter(
      ({ state }) => state === 'succeeded',
    ).length;
    const progress =
      refunds.length > 1
        ? ` ${completedClaims} of ${refunds.length} refunds ${completedClaims === 1 ? 'is' : 'are'} complete.`
        : '';
    if (
      refunds.length > 0 &&
      refunds.every(({ state }) => state === 'succeeded')
    ) {
      return eligibilityChangedCopy
        ? `${eligibilityChangedCopy} Every recorded refund has completed.`
        : 'Your registration is cancelled and every recorded refund completed.';
    }

    const guidance: string[] = [];
    const needsOrganizerFollowUp = refunds.some(
      ({ state }) => state === 'actionRequired' || state === 'needsAttention',
    );
    if (needsOrganizerFollowUp) {
      guidance.push('at least one refund needs organizer follow-up');
    }
    if (refunds.some(({ state }) => state === 'retrying')) {
      guidance.push('at least one refund is retrying automatically');
    }
    if (refunds.some(({ state }) => state === 'pending')) {
      guidance.push('at least one refund is queued or processing');
    }
    if (guidance.length > 0) {
      const organizerFollowUp = needsOrganizerFollowUp
        ? ' Contact the organizer for an update.'
        : '';
      const eligibilityRetryGuidance =
        " Do not retry this payment. After the refund, review the event's current status and options or contact the organizer.";
      const refundProgress = `Refund status: ${guidance.join('; ')}. Money has not necessarily been returned yet.${organizerFollowUp}${eligibilityRetryGuidance}${progress}`;
      return eligibilityChangedCopy
        ? `${eligibilityChangedCopy} ${refundProgress}`
        : `Your registration remains cancelled, but ${guidance.join('; ')}. Money has not necessarily been returned yet.${organizerFollowUp} Do not pay or register again to retry it.${progress}`;
    }

    return eligibilityChangedCopy
      ? `${eligibilityChangedCopy} No refund is currently recorded for this registration; contact the organizer for an update.`
      : 'Your registration is cancelled. No refund is recorded for this registration.';
  }

  if (profileEventContinuePaymentUrl(event)) {
    if (event.organizingRegistration) {
      return 'Continue payment from this card to confirm your organizer/helper registration. Organizer access starts after payment succeeds.';
    }

    return 'Continue payment from this card, or open the event page for registration details.';
  }

  switch (event.status) {
    case 'CONFIRMED': {
      if (event.checkInTime) {
        if (event.organizingRegistration) {
          return 'You are checked in. Open the event page for organizer/helper pass details. Cancellation is no longer available after check-in.';
        }

        return 'You are checked in. Open the event page for ticket details. Cancellation is no longer available; a transfer preserves the existing attendee and guest check-in history.';
      }

      if (event.organizingRegistration) {
        return 'Open the event page for your organizer/helper pass, event management access, and current cancellation details.';
      }

      return "Open the event page for ticket access and to see whether cancellation or transfer is currently available. A transfer may be free or require the recipient to pay, based on current prices and the recipient's eligible discounts.";
    }
    case 'PENDING': {
      if (event.paymentState === 'pending') {
        if (event.organizingRegistration) {
          return 'Payment setup is still in progress. Open the event page for the latest payment link. Organizer access starts only after payment succeeds.';
        }

        return 'Payment setup is still in progress. Open the event page for the latest payment link and current cancellation status.';
      }

      if (event.organizingRegistration) {
        return 'Open the event page for organizer/helper application and cancellation status. Organizer access starts only after approval and any required payment.';
      }

      return 'Open the event page for pending-registration details and current cancellation status.';
    }
    case 'WAITLIST': {
      return 'Open the event page for waitlist details and current cancellation status.';
    }
  }
};

export const registrationPaymentLabel = (
  paymentState: 'cancelled' | 'notRequired' | 'pending' | 'recorded',
): string => {
  switch (paymentState) {
    case 'cancelled': {
      return 'Payment cancelled';
    }
    case 'notRequired': {
      return 'No payment required';
    }
    case 'pending': {
      return 'Payment pending';
    }
    case 'recorded': {
      return 'Payment recorded';
    }
  }
};

export const registrationStatusLabel = (
  status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST',
): string => {
  switch (status) {
    case 'CANCELLED': {
      return 'Cancelled';
    }
    case 'CONFIRMED': {
      return 'Confirmed';
    }
    case 'PENDING': {
      return 'Pending';
    }
    case 'WAITLIST': {
      return 'Waitlist';
    }
  }
};

export const registrationRefundStateLabel = (
  state: ProfileEventRefund['state'],
): string => {
  switch (state) {
    case 'actionRequired':
    case 'needsAttention': {
      return 'Contact organizer for refund update';
    }
    case 'pending': {
      return 'Refund queued';
    }
    case 'retrying': {
      return 'Refund retrying';
    }
    case 'succeeded': {
      return 'Refund completed';
    }
  }
};

export const registrationRefundSourceLabel = (
  source: ProfileEventRefund['source'],
): string =>
  source === 'registration' ? 'Registration payment' : 'Add-on payment';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    FontAwesomeModule,
    MatButtonModule,
    RouterLink,
    TenantDatePipe,
  ],
  selector: 'app-profile-events',
  templateUrl: './profile-events.component.html',
})
export class ProfileEventsComponent {
  protected readonly faCalendarDays = faCalendarDays;
  protected readonly profileEventActionNote = profileEventActionNote;
  protected readonly profileEventAddonPaidAmount = profileEventAddonPaidAmount;
  protected readonly profileEventAudienceLabel = profileEventAudienceLabel;
  protected readonly profileEventContinuePaymentUrl =
    profileEventContinuePaymentUrl;
  protected readonly profileEventGuestLabel = profileEventGuestLabel;
  protected readonly profileEventNextStepLabel = profileEventNextStepLabel;
  protected readonly profileEventPassLabel = profileEventPassLabel;
  protected readonly registrationPaymentLabel = registrationPaymentLabel;
  protected readonly registrationRefundSourceLabel =
    registrationRefundSourceLabel;
  protected readonly registrationRefundStateLabel =
    registrationRefundStateLabel;
  protected readonly registrationStatusLabel = registrationStatusLabel;
  private readonly rpc = AppRpc.injectClient();
  protected readonly userEventsQuery = injectQuery(() =>
    this.rpc.users.events.queryOptions(),
  );
}
