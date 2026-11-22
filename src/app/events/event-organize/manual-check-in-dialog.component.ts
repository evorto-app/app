import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
} from '@angular/core';
import { form, FormField, max, min, validate } from '@angular/forms/signals';
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

interface ManualCheckInGuestModel {
  guestCount: number;
}

/**
 * Guests mode opens on a checked-in attendee to check in a later guest, so it
 * starts at one guest; checking in the attendee starts with no guests.
 */
const manualCheckInDefaultGuestCount = ({
  attendeeCheckedIn,
  mode,
  remainingGuestCount,
}: {
  readonly attendeeCheckedIn: boolean;
  readonly mode: ManualCheckInDialogData['mode'];
  readonly remainingGuestCount: number;
}): number =>
  mode === 'guests' && attendeeCheckedIn ? Math.min(1, remainingGuestCount) : 0;

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
    FormField,
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
  /**
   * The ticket from the last successful lookup only. After a failed refresh
   * Query keeps the previous data, which must not enable confirmation.
   */
  private readonly ticket = computed(() =>
    this.scanResultQuery.isSuccess() ? this.scanResultQuery.data() : undefined,
  );
  private readonly defaultGuestCount = computed(() => {
    const ticket = this.ticket();
    return ticket
      ? manualCheckInDefaultGuestCount({
          attendeeCheckedIn: ticket.attendeeCheckedIn,
          mode: this.data.mode,
          remainingGuestCount: ticket.remainingGuestCount,
        })
      : 0;
  });
  private readonly guestModel = linkedSignal<ManualCheckInGuestModel>(() => ({
    guestCount: this.defaultGuestCount(),
  }));
  protected readonly remainingGuestCount = computed(
    () => this.ticket()?.remainingGuestCount ?? 0,
  );
  protected readonly guestForm = form(this.guestModel, (schema) => {
    min(schema.guestCount, 0);
    max(schema.guestCount, () => this.remainingGuestCount());
    validate(schema.guestCount, ({ value }) =>
      Number.isSafeInteger(value())
        ? undefined
        : {
            kind: 'wholeNumber',
            message: `Enter a whole number from 0 to ${this.remainingGuestCount()}.`,
          },
    );
  });
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
  protected readonly selectedGuestCheckInCount = computed(() =>
    this.guestForm.guestCount().valid() ? this.guestModel().guestCount : 0,
  );
  protected readonly selectedSpotCheckInCount = computed(() => {
    const ticket = this.ticket();
    if (!ticket) {
      return 0;
    }
    return (
      (ticket.attendeeCheckedIn ? 0 : 1) + this.selectedGuestCheckInCount()
    );
  });

  /**
   * Confirm needs a successful lookup that has finished loading, so a
   * reopened dialog never confirms against cached details from before the
   * last check-in, and a failed refresh never confirms against stale ones.
   */
  protected readonly confirmDisabled = computed(() => {
    const ticket = this.ticket();
    return (
      !ticket ||
      this.guestForm().invalid() ||
      scanCheckInActionDisabled({
        allowCheckin: ticket.allowCheckin,
        completed: false,
        mutationPending:
          this.checkInMutation.isPending() || this.scanResultQuery.isFetching(),
        spotCount: this.selectedSpotCheckInCount(),
      })
    );
  });

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
}
