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
  readonly confirmLabel: string;
  readonly impact: string;
  readonly title: string;
} => {
  if (actor === 'organizer') {
    const subject = participantName?.trim() || 'this participant';

    if (status === 'PENDING' && !paymentPending) {
      return {
        confirmLabel: 'Confirm cancellation',
        impact: `This immediately withdraws ${subject}'s pending application. It does not release confirmed capacity or start a refund. This action cannot be undone.`,
        title: `Cancel ${subject}'s registration?`,
      };
    }

    if (status === 'PENDING') {
      return {
        confirmLabel: 'Confirm cancellation',
        impact: `This immediately cancels ${subject}'s pending registration and releases its reserved capacity. It does not complete a payment. This action cannot be undone.`,
        title: `Cancel ${subject}'s registration?`,
      };
    }

    return {
      confirmLabel: 'Confirm cancellation',
      impact: `This immediately cancels ${subject}'s registration and releases its reserved capacity. If a payment exists, Evorto starts the applicable refund workflow, which may still require operator follow-up. This action cannot be undone.`,
      title: `Cancel ${subject}'s registration?`,
    };
  }

  if (status === 'WAITLIST') {
    return {
      confirmLabel: 'Leave waitlist',
      impact:
        'This immediately removes your registration and gives up your current waitlist position. This action cannot be undone.',
      title: 'Leave the waitlist?',
    };
  }

  if (status === 'PENDING') {
    return {
      confirmLabel: 'Confirm cancellation',
      impact: paymentPending
        ? 'This immediately cancels your pending registration and releases its reserved capacity. It does not complete a payment. This action cannot be undone.'
        : 'This immediately withdraws your pending application. It does not release confirmed capacity or start a refund. This action cannot be undone.',
      title: 'Cancel your pending registration?',
    };
  }

  return {
    confirmLabel: 'Confirm cancellation',
    impact:
      'This immediately cancels your confirmed registration and releases its reserved capacity. If a payment exists, Evorto starts the applicable refund workflow, which may still require operator follow-up. This action cannot be undone.',
    title: 'Cancel your registration?',
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
        Keep registration
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
