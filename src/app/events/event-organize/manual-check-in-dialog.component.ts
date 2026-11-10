import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RpcForbiddenError } from '@shared/errors/rpc-errors';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import {
  scanCheckInActionDisabled,
  scanCheckInButtonLabel,
  scanCheckInTimingIssueCopy,
  scanGuestCheckInCountFromInput,
  scannerRegistrationErrorMessage,
  scanRegistrationStatusIssueCopy,
  scanSpotCountLabel,
} from '../../scanning/handle-registration/handle-registration.component';

export interface ManualCheckInDialogData {
  readonly attendeeName: string;
  readonly registrationId: string;
}

export interface ManualCheckInDialogResult {
  readonly alreadyCheckedIn: boolean;
}

export const manualCheckInErrorMessage = (
  error: unknown,
  fallback: string,
): string =>
  error instanceof RpcForbiddenError
    ? 'You cannot check in tickets for this event.'
    : scannerRegistrationErrorMessage(error, fallback);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormFieldModule,
    MatInputModule,
  ],
  selector: 'app-manual-check-in-dialog',
  templateUrl: './manual-check-in-dialog.component.html',
})
export class ManualCheckInDialogComponent {
  protected readonly data = inject<ManualCheckInDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<
      MatDialogRef<ManualCheckInDialogComponent, ManualCheckInDialogResult>
    >(MatDialogRef);
  private readonly queryClient = inject(QueryClient);
  private readonly rpc = AppRpc.injectClient();
  protected readonly scanResultQuery = injectQuery(() =>
    this.rpc.events.registrationScanned.queryOptions({
      registrationId: this.data.registrationId,
    }),
  );
  protected readonly checkInErrorMessage = computed(() =>
    manualCheckInErrorMessage(
      this.checkInMutation.error(),
      'Check-in could not be completed. Try again.',
    ),
  );
  protected readonly checkInMutation = injectMutation(() =>
    this.rpc.events.checkInRegistration.mutationOptions(),
  );
  protected readonly guestCheckInCount = signal(0);
  protected readonly queryErrorMessage = computed(() => {
    const error = this.scanResultQuery.error();
    if (error === null) {
      return '';
    }
    return manualCheckInErrorMessage(
      error,
      'The ticket could not be loaded. Close this dialog and try again.',
    );
  });
  protected readonly scanCheckInActionDisabled = scanCheckInActionDisabled;
  protected readonly scanCheckInButtonLabel = scanCheckInButtonLabel;
  protected readonly scanCheckInTimingIssueCopy = scanCheckInTimingIssueCopy;
  protected readonly scanRegistrationStatusIssueCopy =
    scanRegistrationStatusIssueCopy;
  protected readonly scanSpotCountLabel = scanSpotCountLabel;
  protected readonly selectedGuestCheckInCount = computed(() => {
    const scanResult = this.scanResultQuery.data();
    if (!scanResult) {
      return 0;
    }
    return Math.min(this.guestCheckInCount(), scanResult.remainingGuestCount);
  });
  protected readonly selectedSpotCheckInCount = computed(() => {
    const scanResult = this.scanResultQuery.data();
    if (!scanResult) {
      return 0;
    }
    return (
      (scanResult.attendeeCheckedIn ? 0 : 1) + this.selectedGuestCheckInCount()
    );
  });

  protected checkIn(): void {
    const scanResult = this.scanResultQuery.data();
    if (
      scanCheckInActionDisabled({
        allowCheckin: scanResult?.allowCheckin ?? false,
        completed: false,
        mutationPending: this.checkInMutation.isPending(),
        spotCount: this.selectedSpotCheckInCount(),
      })
    ) {
      return;
    }

    this.dialogRef.disableClose = true;
    this.checkInMutation.mutate(
      {
        guestCheckInCount: this.selectedGuestCheckInCount(),
        registrationId: this.data.registrationId,
      },
      {
        onError: () => {
          this.dialogRef.disableClose = false;
        },
        onSuccess: (result) => {
          this.dialogRef.disableClose = false;
          this.dialogRef.close({ alreadyCheckedIn: result.alreadyCheckedIn });
          void this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['events', 'registrationScanned']),
          );
        },
      },
    );
  }

  protected updateGuestCheckInCount(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    this.guestCheckInCount.set(
      scanGuestCheckInCountFromInput({
        inputValue: input.value,
        remainingGuestCount:
          this.scanResultQuery.data()?.remainingGuestCount ?? 0,
      }),
    );
    const clampedValue = String(this.guestCheckInCount());
    if (input.value !== clampedValue) {
      input.value = clampedValue;
    }
  }
}
