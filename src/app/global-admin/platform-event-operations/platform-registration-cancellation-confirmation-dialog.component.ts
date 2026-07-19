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
  const impact = `This cancels ${participantName}'s entire registration: the attendee place, ${guestCopy}, and every remaining included, free, or purchased add-on unit. Existing check-in and add-on handout history stays recorded. This action cannot be undone.`;

  if (!registration.cancellation.refund.required) {
    return {
      canConfirm: true,
      impact,
      refund:
        'No successful event payment is recorded, so no refund is required.',
      title: `Cancel ${participantName}'s registration?`,
    };
  }

  if (registration.cancellation.refund.method !== 'stripe') {
    return {
      canConfirm: false,
      impact,
      refund:
        'This paid registration is not linked to a Stripe payment. Paid event transactions are Stripe-only, so correct the payment record before cancelling.',
      title: `Cancellation blocked for ${participantName}`,
    };
  }

  const amount = registration.cancellation.refund.amount;
  const amountCopy =
    amount === null
      ? 'The exact refund will be calculated from the original Stripe payment when you confirm the cancellation.'
      : `${formatPlatformRegistrationRefundAmount(amount, registration.currency)} is currently expected. Evorto recalculates the exact refund from the original Stripe payment when you confirm the cancellation.`;
  const feeCopy = registration.cancellation.refund.feesIncluded
    ? 'The configured policy includes payment fees.'
    : 'The configured policy excludes payment fees.';

  return {
    canConfirm: true,
    impact,
    refund: `${amountCopy} ${feeCopy}`,
    title: `Cancel ${participantName}'s registration?`,
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
          <dt class="label-medium text-on-surface-variant">
            Registration option
          </dt>
          <dd class="body-medium">
            {{ data.registration.registrationOptionTitle }}
          </dd>
        </div>
        <div>
          <dt class="label-medium text-on-surface-variant">
            Operational reason
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
        Keep registration
      </button>
      <button
        mat-flat-button
        type="button"
        [disabled]="!copy.canConfirm"
        [mat-dialog-close]="true"
      >
        Confirm cancellation
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
