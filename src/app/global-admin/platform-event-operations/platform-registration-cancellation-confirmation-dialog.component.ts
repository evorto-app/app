import type { PlatformRegistrationDetailRecord } from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import {
  registrationCancellationActionLabel,
  registrationCancellationKind,
} from '@shared/registration-cancellation';

import { TENANT_FORMATTING_LOCALE } from '../../../types/custom/tenant';

export interface PlatformRegistrationCancellationConfirmationCopy {
  readonly actionLabel: string;
  readonly canConfirm: boolean;
  readonly dismissLabel: string;
  readonly impact: string;
  readonly refund: string;
  readonly title: string;
}

export interface PlatformRegistrationCancellationConfirmationData {
  readonly reason: string;
  readonly registration: PlatformRegistrationDetailRecord;
}

export const formatPlatformRegistrationRefundAmount = (
  amountInMinorUnits: number,
  currency: PlatformRegistrationDetailRecord['currency'],
): string =>
  new Intl.NumberFormat(TENANT_FORMATTING_LOCALE, {
    currency,
    style: 'currency',
  }).format(amountInMinorUnits / 100);

export const platformRegistrationCancellationConfirmationCopy = ({
  registration,
}: PlatformRegistrationCancellationConfirmationData): PlatformRegistrationCancellationConfirmationCopy => {
  const participantName =
    `${registration.attendee.firstName} ${registration.attendee.lastName}`.trim() ||
    'this attendee';
  const guestCopy =
    registration.guestCount === 1
      ? '1 guest place'
      : `${registration.guestCount} guest places`;
  if (registration.status === 'CANCELLED') {
    return {
      actionLabel: 'Sign-up already ended',
      canConfirm: false,
      dismissLabel: 'Close',
      impact: `${participantName}'s sign-up has already ended. No further change can be made here.`,
      refund:
        'Review the existing cancellation if its payment outcome looks wrong.',
      title: 'Sign-up already ended',
    };
  }

  const kind = registrationCancellationKind({
    paymentPending: registration.paymentPending,
    status: registration.status,
  });
  const actionLabel = registrationCancellationActionLabel(kind);
  const impact = (() => {
    switch (kind) {
      case 'application': {
        return `This withdraws ${participantName}'s pending application. It does not affect a confirmed place or start a refund. This action cannot be undone.`;
      }
      case 'pendingSignUp': {
        return `This cancels ${participantName}'s pending sign-up, releases the attendee place and ${guestCopy} held for it, and removes its add-on choices. The unfinished payment will not confirm the place. This action cannot be undone.`;
      }
      case 'ticket': {
        return `This cancels ${participantName}'s entire ticket: the attendee place, ${guestCopy}, and every remaining included, free, or purchased add-on item. Existing check-in and add-on handout history stays recorded. This action cannot be undone.`;
      }
      case 'waitlist': {
        return `This removes ${participantName} from the waitlist and gives up their current position. It does not cancel a confirmed ticket or start a refund. This action cannot be undone.`;
      }
    }
  })();

  if (kind !== 'ticket' && registration.cancellation.refund.required) {
    return {
      actionLabel,
      canConfirm: false,
      dismissLabel: 'Go back',
      impact,
      refund:
        'The saved payment outcome does not match this sign-up status. Nothing was changed. Review the sign-up and payment before trying again.',
      title: `${actionLabel} unavailable for ${participantName}`,
    };
  }

  if (!registration.cancellation.refund.required) {
    return {
      actionLabel,
      canConfirm: true,
      dismissLabel: kind === 'waitlist' ? 'Keep on waitlist' : 'Go back',
      impact,
      refund:
        kind === 'pendingSignUp'
          ? 'No completed payment was found. The unfinished payment will be stopped, so no refund is needed.'
          : 'No completed payment needs to be refunded.',
      title:
        kind === 'application'
          ? `Withdraw ${participantName}'s application?`
          : kind === 'pendingSignUp'
            ? `Cancel ${participantName}'s pending sign-up?`
            : kind === 'waitlist'
              ? `Remove ${participantName} from the waitlist?`
              : `Cancel ${participantName}'s ticket?`,
    };
  }

  if (registration.cancellation.refund.method !== 'stripe') {
    return {
      actionLabel,
      canConfirm: false,
      dismissLabel: 'Go back',
      impact,
      refund:
        'This ticket could not be matched to its original payment. The ticket was not cancelled, the attendee keeps their place, and no refund was started. Review the payment before trying again.',
      title: `Ticket could not be cancelled for ${participantName}`,
    };
  }

  const amount = registration.cancellation.refund.amount;
  const amountCopy =
    amount === null
      ? 'The exact refund will be calculated from the original payment when you confirm the cancellation.'
      : `${formatPlatformRegistrationRefundAmount(amount, registration.currency)} is currently expected. Evorto recalculates the exact refund from the original payment when you confirm the cancellation.`;
  const feeCopy = registration.cancellation.refund.feesIncluded
    ? 'The organization cancellation rules include payment fees.'
    : 'The organization cancellation rules exclude payment fees.';

  return {
    actionLabel,
    canConfirm: true,
    dismissLabel: 'Go back',
    impact,
    refund: `${amountCopy} ${feeCopy}`,
    title: `Cancel ${participantName}'s ticket?`,
  };
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
  ],
  selector: 'app-platform-registration-cancellation-confirmation-dialog',
  template: `
    <h2 mat-dialog-title>{{ copy.title }}</h2>
    <mat-dialog-content class="grid gap-5">
      <p class="body-medium">{{ copy.impact }}</p>

      <dl class="grid gap-3 sm:grid-cols-2">
        <div>
          <dt class="label-medium text-on-surface-variant">Attendee</dt>
          <dd class="body-medium">
            {{ data.registration.attendee.email }}
          </dd>
        </div>
        <div>
          <dt class="label-medium text-on-surface-variant">Event</dt>
          <dd class="body-medium">{{ data.registration.event.title }}</dd>
        </div>
        <div>
          <dt class="label-medium text-on-surface-variant">Sign-up choice</dt>
          <dd class="body-medium">
            {{ data.registration.registrationOptionTitle }}
          </dd>
        </div>
        <div>
          <dt class="label-medium text-on-surface-variant">
            Reason for this action
          </dt>
          <dd class="body-medium">{{ data.reason }}</dd>
        </div>
      </dl>

      <section
        class="p-4"
        [class.bg-error-container]="!copy.canConfirm"
        [class.bg-surface-container]="copy.canConfirm"
        [class.text-on-error-container]="!copy.canConfirm"
        [attr.role]="copy.canConfirm ? null : 'alert'"
      >
        <h3 class="title-small">What happens to the payment</h3>
        <p class="body-medium mt-1">{{ copy.refund }}</p>
      </section>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        type="button"
        [mat-dialog-close]="false"
        cdkFocusInitial
      >
        {{ copy.dismissLabel }}
      </button>
      <button
        mat-flat-button
        type="button"
        [disabled]="!copy.canConfirm"
        [mat-dialog-close]="true"
      >
        {{ copy.actionLabel }}
      </button>
    </mat-dialog-actions>
  `,
})
export class PlatformRegistrationCancellationConfirmationDialogComponent {
  protected readonly data =
    inject<PlatformRegistrationCancellationConfirmationData>(MAT_DIALOG_DATA);
  protected readonly copy = platformRegistrationCancellationConfirmationCopy(
    this.data,
  );
}
