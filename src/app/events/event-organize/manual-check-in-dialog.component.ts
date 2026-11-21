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
  readonly mode: 'attendee' | 'guests';
  readonly registrationId: string;
}

export interface ManualCheckInDialogResult {
  readonly alreadyCheckedIn: boolean;
  readonly checkedInGuestCount: number;
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
      checkInMethod: 'manual',
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
  protected readonly guestCheckInCount = signal<null | number>(null);
  protected readonly title = computed(() =>
    this.data.mode === 'guests'
      ? `Check in guests of ${this.data.attendeeName}`
      : `Check in ${this.data.attendeeName}`,
  );
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
    const requested =
      this.guestCheckInCount() ??
      (this.data.mode === 'guests' && scanResult.attendeeCheckedIn ? 1 : 0);
    return Math.min(requested, scanResult.remainingGuestCount);
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

  /**
   * Confirm waits for the ticket to finish loading, so a reopened dialog
   * never confirms against cached details from before the last check-in.
   */
  protected readonly confirmDisabled = computed(() =>
    scanCheckInActionDisabled({
      allowCheckin: this.scanResultQuery.data()?.allowCheckin ?? false,
      completed: false,
      mutationPending:
        this.checkInMutation.isPending() || this.scanResultQuery.isFetching(),
      spotCount: this.selectedSpotCheckInCount(),
    }),
  );

  protected checkIn(): void {
    if (this.confirmDisabled()) {
      return;
    }

    const checkedInGuestCount = this.selectedGuestCheckInCount();
    this.dialogRef.disableClose = true;
    this.checkInMutation.mutate(
      {
        checkInMethod: 'manual',
        guestCheckInCount: checkedInGuestCount,
        registrationId: this.data.registrationId,
      },
      {
        onError: () => {
          this.dialogRef.disableClose = false;
        },
        onSuccess: (result) => {
          this.dialogRef.disableClose = false;
          this.dialogRef.close({
            alreadyCheckedIn: result.alreadyCheckedIn,
            checkedInGuestCount,
          });
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
    const clamped = scanGuestCheckInCountFromInput({
      inputValue: input.value,
      remainingGuestCount:
        this.scanResultQuery.data()?.remainingGuestCount ?? 0,
    });
    this.guestCheckInCount.set(clamped);
    const clampedValue = String(clamped);
    if (input.value !== clampedValue) {
      input.value = clampedValue;
    }
  }
}
