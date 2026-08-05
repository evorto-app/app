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
}): string => (event.organizingRegistration ? 'Organizer/helper' : 'Attendee');

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
    return 'Finish payment to confirm your place.';
  }

  if (event.paymentState === 'pending') {
    return 'Payment is not ready yet. Open the event page to check the current payment option. Your place is not confirmed.';
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
        ? 'Your sign-up was cancelled because you were no longer able to join when payment finished. The event may no longer be published, the sign-up choice may have been removed, or your access in the organization may have changed. A full refund has been requested for the payment method you used.'
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
        ? `${eligibilityChangedCopy} All refunds are complete.`
        : 'Your sign-up is cancelled and all refunds are complete.';
    }

    const guidance: string[] = [];
    const needsOrganizerFollowUp = refunds.some(
      ({ state }) => state === 'actionRequired' || state === 'needsAttention',
    );
    if (needsOrganizerFollowUp) {
      guidance.push('at least one refund needs help from the organizer');
    }
    if (refunds.some(({ state }) => state === 'retrying')) {
      guidance.push('at least one refund is delayed');
    }
    if (refunds.some(({ state }) => state === 'pending')) {
      guidance.push('at least one refund has been requested');
    }
    if (guidance.length > 0) {
      const organizerFollowUp = needsOrganizerFollowUp
        ? ' Contact the organizer for an update.'
        : '';
      const eligibilityRetryGuidance =
        ' Do not make this payment again. After the refund, check whether you can still sign up or contact the organizer.';
      const refundProgress = `${guidance.join('; ')}. The money may not have reached your account yet.${organizerFollowUp}${eligibilityRetryGuidance}${progress}`;
      return eligibilityChangedCopy
        ? `${eligibilityChangedCopy} ${refundProgress}`
        : `Your sign-up remains cancelled, but ${guidance.join('; ')}. The money may not have reached your account yet.${organizerFollowUp} Do not pay or sign up again while you wait.${progress}`;
    }

    return eligibilityChangedCopy
      ? `${eligibilityChangedCopy} Evorto does not show a refund for this sign-up. Contact the organizer for an update.`
      : 'Your sign-up is cancelled. No refund is shown for it.';
  }

  if (profileEventContinuePaymentUrl(event)) {
    if (event.organizingRegistration) {
      return 'Finish payment here to confirm your organizer/helper place. Organizer tools become available after payment succeeds.';
    }

    return 'Finish payment here, or open the event page for your sign-up details.';
  }

  switch (event.status) {
    case 'CONFIRMED': {
      if (event.checkInTime) {
        if (event.organizingRegistration) {
          return 'You are checked in. Open the event page for organizer/helper pass details. You can no longer cancel after check-in.';
        }

        return 'You are checked in. Open the event page for ticket details. You can no longer cancel, but you can still transfer the ticket and its existing check-ins.';
      }

      if (event.organizingRegistration) {
        return 'Open the event page for your organizer/helper pass, organizer tools, and cancellation details.';
      }

      return 'Open the event page for your ticket and to see whether you can cancel or transfer it. A transfer may be free, or the recipient may need to pay, based on current prices and the discounts available to them.';
    }
    case 'PENDING': {
      if (event.paymentState === 'pending') {
        if (event.organizingRegistration) {
          return 'Payment is not ready yet. Open the event page to check the current payment option. Your organizer/helper place is not confirmed, and organizer tools are not available.';
        }

        return 'Payment is not ready yet. Open the event page to check the current payment option. Your place is not confirmed.';
      }

      if (event.organizingRegistration) {
        return 'Open the event page for your organizer/helper application and whether you can cancel it. Organizer tools become available after approval and any required payment.';
      }

      return 'Open the event page for details about your pending sign-up and whether you can cancel it.';
    }
    case 'WAITLIST': {
      return 'Open the event page for waitlist details and whether you can leave it.';
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
      return 'Payment not finished';
    }
    case 'recorded': {
      return 'Paid';
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
      return 'Waiting for confirmation';
    }
    case 'WAITLIST': {
      return 'On waitlist';
    }
  }
};

export const registrationRefundStateLabel = (
  state: ProfileEventRefund['state'],
): string => {
  switch (state) {
    case 'actionRequired':
    case 'needsAttention': {
      return 'Contact the organizer';
    }
    case 'pending': {
      return 'Refund requested';
    }
    case 'retrying': {
      return 'Refund delayed';
    }
    case 'succeeded': {
      return 'Refund complete';
    }
  }
};

export const registrationRefundSourceLabel = (
  source: ProfileEventRefund['source'],
): string => (source === 'registration' ? 'Event payment' : 'Add-on payment');

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
