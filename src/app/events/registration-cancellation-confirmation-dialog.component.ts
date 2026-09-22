import type { EventsRegistrationStatus } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';

export interface RegistrationCancellationConfirmationData {
  readonly actor: 'organizer' | 'participant';
  readonly participantName?: string;
  readonly paymentPending: boolean;
  readonly status: EventsRegistrationStatus;
}

export const registrationCancellationConfirmationCopy = ({
  actor,
  participantName,
  paymentPending,
  status,
}: RegistrationCancellationConfirmationData): {
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly impact: string;
  readonly title: string;
} => {
  if (actor === 'organizer') {
    const subject = participantName?.trim() || 'this participant';

    if (status === 'WAITLIST') {
      return {
        cancelLabel: 'Go back',
        confirmLabel: 'Remove from waitlist',
        impact: `This immediately removes ${subject} from the waitlist. No confirmed place is released and no refund is started. This action cannot be undone.`,
        title: `Remove ${subject} from the waitlist?`,
      };
    }

    if (status === 'PENDING' && !paymentPending) {
      return {
        cancelLabel: 'Go back',
        confirmLabel: 'Withdraw application',
        impact: `This immediately withdraws ${subject}'s application. No confirmed place is released and no refund is started. This action cannot be undone.`,
        title: `Withdraw ${subject}'s application?`,
      };
    }

    if (status === 'PENDING') {
      return {
        cancelLabel: 'Go back',
        confirmLabel: 'Cancel sign-up',
        impact: `This immediately cancels ${subject}'s pending sign-up and releases the place being held for them. It does not complete a payment. This action cannot be undone.`,
        title: `Cancel ${subject}'s pending sign-up?`,
      };
    }

    return {
      cancelLabel: 'Go back',
      confirmLabel: 'Cancel ticket',
      impact: `This immediately cancels ${subject}'s ticket and releases their place. If a refund applies, it will be requested and may take time to appear. This action cannot be undone.`,
      title: `Cancel ${subject}'s ticket?`,
    };
  }

  if (status === 'WAITLIST') {
    return {
      cancelLabel: 'Stay on waitlist',
      confirmLabel: 'Leave waitlist',
      impact:
        'This immediately removes you from the waitlist and gives up your current position. This action cannot be undone.',
      title: 'Leave the waitlist?',
    };
  }

  if (status === 'PENDING') {
    return {
      cancelLabel: 'Go back',
      confirmLabel: paymentPending ? 'Cancel sign-up' : 'Withdraw application',
      impact: paymentPending
        ? 'This immediately cancels your pending sign-up and releases the place being held for you. It does not complete a payment. This action cannot be undone.'
        : 'This immediately withdraws your pending application. It does not affect any confirmed places or start a refund. This action cannot be undone.',
      title: paymentPending
        ? 'Cancel your pending sign-up?'
        : 'Withdraw your application?',
    };
  }

  return {
    cancelLabel: 'Go back',
    confirmLabel: 'Cancel ticket',
    impact:
      'This immediately cancels your ticket and releases your place. If a refund applies, it will be requested and may take time to appear. Do not pay or sign up again to retry it. This action cannot be undone.',
    title: 'Cancel your ticket?',
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
  selector: 'app-registration-cancellation-confirmation-dialog',
  template: `
    <h2 mat-dialog-title>{{ copy.title }}</h2>
    <mat-dialog-content>
      <p>{{ copy.impact }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        type="button"
        [mat-dialog-close]="false"
        cdkFocusInitial
      >
        {{ copy.cancelLabel }}
      </button>
      <button mat-flat-button type="button" [mat-dialog-close]="true">
        {{ copy.confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
})
export class RegistrationCancellationConfirmationDialogComponent {
  private readonly data =
    inject<RegistrationCancellationConfirmationData>(MAT_DIALOG_DATA);
  protected readonly copy = registrationCancellationConfirmationCopy(this.data);
}
