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
  readonly dismissLabel: string;
  readonly impact: string;
  readonly title: string;
} => {
  if (actor === 'organizer') {
    const subject = participantName?.trim() || 'this attendee';

    if (status === 'PENDING' && !paymentPending) {
      return {
        confirmLabel: 'Withdraw application',
        dismissLabel: 'Go back',
        impact: `This immediately withdraws ${subject}'s pending application. It does not affect any confirmed places or start a refund. This action cannot be undone.`,
        title: `Withdraw ${subject}'s application?`,
      };
    }

    if (status === 'PENDING') {
      return {
        confirmLabel: 'Cancel sign-up',
        dismissLabel: 'Go back',
        impact: `This immediately cancels ${subject}'s pending sign-up and releases the places held for it. The unfinished payment will not confirm their place. This action cannot be undone.`,
        title: `Cancel ${subject}'s pending sign-up?`,
      };
    }

    if (status === 'WAITLIST') {
      return {
        confirmLabel: 'Remove from waitlist',
        dismissLabel: 'Keep on waitlist',
        impact: `This immediately removes ${subject} from the waitlist and gives up their current position. It does not cancel a confirmed ticket or start a refund. This action cannot be undone.`,
        title: `Remove ${subject} from the waitlist?`,
      };
    }

    return {
      confirmLabel: 'Cancel ticket',
      dismissLabel: 'Go back',
      impact: `This immediately cancels ${subject}'s ticket and releases the places it reserved. If a refund applies, it will be requested and may take time to appear. This action cannot be undone.`,
      title: `Cancel ${subject}'s ticket?`,
    };
  }

  if (status === 'WAITLIST') {
    return {
      confirmLabel: 'Leave waitlist',
      dismissLabel: 'Stay on waitlist',
      impact:
        'This immediately removes you from the waitlist and gives up your current position. This action cannot be undone.',
      title: 'Leave the waitlist?',
    };
  }

  if (status === 'PENDING') {
    return {
      confirmLabel: paymentPending ? 'Cancel sign-up' : 'Withdraw application',
      dismissLabel: 'Go back',
      impact: paymentPending
        ? 'This immediately cancels your pending sign-up and releases the places held for it. The unfinished payment will not confirm your place. This action cannot be undone.'
        : 'This immediately withdraws your pending application. It does not affect any confirmed places or start a refund. This action cannot be undone.',
      title: paymentPending
        ? 'Cancel your pending sign-up?'
        : 'Withdraw your application?',
    };
  }

  return {
    confirmLabel: 'Cancel ticket',
    dismissLabel: 'Go back',
    impact:
      'This immediately cancels your ticket and releases the places it reserved. If a refund applies, it will be requested and may take time to appear. You do not need to pay or sign up again. This action cannot be undone.',
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
        {{ copy.dismissLabel }}
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
