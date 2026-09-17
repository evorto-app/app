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

import { TENANT_FORMATTING_LOCALE } from '../../../types/custom/tenant';

export interface PlatformRegistrationCancellationConfirmationCopy {
  readonly canConfirm: boolean;
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
  const impact = `This cancels ${participantName}'s entire ticket: the attendee place, ${guestCopy}, and every remaining included, free, or purchased add-on unit. Existing check-in and add-on handout history stays recorded. This action cannot be undone.`;

  if (!registration.cancellation.available) {
    return {
      canConfirm: false,
      impact:
        'No cancellation will be made. The ticket and any held places remain unchanged.',
      refund:
        registration.cancellation.blockedReason ??
        'Cancellation is unavailable. Review the current ticket and payment details before trying again.',
      title: `Cancellation blocked for ${participantName}`,
    };
  }

  if (!registration.cancellation.refund.required) {
    return {
      canConfirm: true,
      impact,
      refund: 'No completed event payment was found, so no refund is needed.',
      title: `Cancel ${participantName}'s ticket?`,
    };
  }

  if (registration.cancellation.refund.method !== 'stripe') {
    return {
      canConfirm: false,
      impact,
      refund:
        "Evorto cannot find a completed card payment for this paid ticket, so it cannot calculate a safe refund. Check the attendee's payment in Finance before cancelling.",
      title: `Cancellation blocked for ${participantName}`,
    };
  }

  const amount = registration.cancellation.refund.amount;
  const amountCopy =
    amount === null
      ? 'The exact refund will be calculated from the original card payment when you confirm the cancellation.'
      : `${formatPlatformRegistrationRefundAmount(amount, registration.currency)} is currently expected. Evorto recalculates the exact refund from the original card payment when you confirm the cancellation.`;
  const feeCopy = registration.cancellation.refund.feesIncluded
    ? 'Payment fees are included in the refund.'
    : 'Payment fees are not included in the refund.';

  return {
    canConfirm: true,
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
            Reason for cancellation
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
        <h3 class="title-small">Refund outcome</h3>
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
        Go back
      </button>
      <button
        mat-flat-button
        type="button"
        [disabled]="!copy.canConfirm"
        [mat-dialog-close]="true"
      >
        Cancel ticket
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
