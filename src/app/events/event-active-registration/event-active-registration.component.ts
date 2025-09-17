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
import { MatSnackBar } from '@angular/material/snack-bar';
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
    }[]
  >();
  
  private readonly trpc = injectTRPC();
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly queryClient = inject(QueryClient);

  private readonly cancelPendingRegistrationMutation = injectMutation(() =>
    this.trpc.events.cancelPendingRegistration.mutationOptions(),
  );

  private readonly cancelRegistrationMutation = injectMutation(() =>
    this.trpc.events.cancelRegistration.mutationOptions(),
  );

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

  cancelConfirmedRegistration(registration: { id: string; registrationOptionTitle: string }) {
    const dialogRef = this.dialog.open(CancelRegistrationDialogComponent, {
      data: { registrationTitle: registration.registrationOptionTitle },
      width: '500px',
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.cancelRegistrationMutation.mutate(
          {
            registrationId: registration.id,
            reason: result.reason,
            reasonNote: result.reasonNote,
          },
          {
            onSuccess: async (response) => {
              let message = 'Registration cancelled successfully';
              if (response.refunded && response.refundAmount > 0) {
                message += `. Refund of ${response.refundAmount / 100} will be processed.`;
              }
              
              this.snackBar.open(message, 'Close', { duration: 5000 });

              await this.queryClient.invalidateQueries({
                queryKey: this.trpc.events.getRegistrationStatus.pathKey(),
              });
            },
            onError: (error) => {
              this.snackBar.open(`Failed to cancel registration: ${error.message}`, 'Close', {
                duration: 5000,
              });
            },
          },
        );
      }
    });
  }
}
