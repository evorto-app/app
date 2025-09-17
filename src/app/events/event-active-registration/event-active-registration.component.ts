import { NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';
import { CancelRegistrationDialogComponent } from './cancel-registration-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, NgOptimizedImage],
  selector: 'app-event-active-registration',
  styles: ``,
  templateUrl: './event-active-registration.component.html',
})
export class EventActiveRegistrationComponent {
  public readonly registrations = input.required<
    {
      checkoutUrl: null | string | undefined;
      id: string;
      paymentPending: boolean;
      registeredDescription: null | string | undefined;
      registrationOptionTitle: string;
      status: string;
      effectiveCancellationPolicy?: any;
      eventStart?: Date;
    }[]
  >();
  private readonly trpc = injectTRPC();
  private readonly dialog = inject(MatDialog);
  private readonly cancelPendingRegistrationMutation = injectMutation(() =>
    this.trpc.events.cancelPendingRegistration.mutationOptions(),
  );

  private readonly queryClient = inject(QueryClient);

  cancelPendingRegistration(registration: { id: string }) {
    this.cancelPendingRegistrationMutation.mutate(
      {
        registrationId: registration.id,
      },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.events.getRegistrationStatus.pathKey(),
          });
        },
      },
    );
  }

  cancelConfirmedRegistration(registration: { 
    id: string; 
    effectiveCancellationPolicy?: any;
    eventStart?: Date;
  }) {
    const dialogRef = this.dialog.open(CancelRegistrationDialogComponent, {
      width: '500px',
      data: {
        registrationId: registration.id,
        policy: registration.effectiveCancellationPolicy,
        eventStart: registration.eventStart,
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        // Registration was cancelled, refresh the data
        this.queryClient.invalidateQueries({
          queryKey: this.trpc.events.getRegistrationStatus.pathKey(),
        });
      }
    });
  }

  canCancelRegistration(registration: {
    effectiveCancellationPolicy?: any;
    eventStart?: Date;
  }): boolean {
    if (!registration.effectiveCancellationPolicy || !registration.eventStart) {
      return false;
    }

    const policy = registration.effectiveCancellationPolicy;
    if (!policy.allowCancellation) {
      return false;
    }

    const cutoffTime = new Date(registration.eventStart);
    cutoffTime.setDate(cutoffTime.getDate() - policy.cutoffDays);
    cutoffTime.setHours(cutoffTime.getHours() - policy.cutoffHours);

    return new Date() < cutoffTime;
  }
}
