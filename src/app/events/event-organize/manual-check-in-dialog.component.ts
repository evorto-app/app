import type { EventCheckInMethod } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
} from '@angular/core';
import {
  disabled,
  form,
  FormField,
  max,
  min,
  validate,
} from '@angular/forms/signals';
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
  rpcTransportRetry,
  rpcTransportRetryDelay,
} from '../../core/rpc-transport-retry';
import {
  createScanCheckInOperationKey,
  scanCheckInActionDisabled,
  scanCheckInButtonLabel,
  scanCheckInRetryPayload,
  scanCheckInState,
  scanCheckInTimingIssueCopy,
  scanGuestInputLocked,
  scannerRegistrationErrorMessage,
  scanRegistrationStatusIssueCopy,
  scanSpotCountLabel,
} from '../../scanning/handle-registration/handle-registration.component';

export interface ManualCheckInDialogData {
  readonly attendeeName: string;
  readonly mode: 'attendee' | 'guests';
  readonly registrationId: string;
  /** The attendee picked from the list; a transfer can change the owner. */
  readonly userId: string;
}

export interface ManualCheckInDialogResult {
  readonly alreadyCheckedIn: boolean;
  readonly checkedInGuestCount: number;
}

interface ManualCheckInGuestModel {
  guestCount: number;
}

interface ManualCheckInPayload {
  readonly checkInMethod: EventCheckInMethod;
  readonly expectedAttendeeCheckedIn: boolean;
  readonly expectedCheckedInGuestCount: number;
  readonly expectedUserId?: string;
  readonly guestCheckInCount: number;
  readonly operationKey: string;
  readonly registrationId: string;
}

const hasErrorTag = (error: unknown, tag: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  '_tag' in error &&
  error._tag === tag;

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
  protected readonly scanResultQuery = injectQuery(() => ({
    ...this.rpc.events.registrationScanned.queryOptions({
      checkInMethod: 'manual',
      registrationId: this.data.registrationId,
    }),
    retry: rpcTransportRetry,
    retryDelay: rpcTransportRetryDelay,
  }));
  protected readonly checkInErrorMessage = computed(() =>
    manualCheckInErrorMessage(
      this.checkInMutation.error(),
      'Check-in could not be completed. Try again.',
    ),
  );
  /**
   * Offline, Query would pause the write and keep it pending, and the dialog
   * can't close while a write is pending. Send it anyway: transport failures
   * are retried a few times with the same operation key, then the dialog
   * offers Try again and can be closed.
   */
  protected readonly checkInMutation = injectMutation(() => ({
    ...this.rpc.events.checkInRegistration.mutationOptions(),
    networkMode: 'always' as const,
    retry: rpcTransportRetry,
    retryDelay: rpcTransportRetryDelay,
  }));
  protected readonly checkInState = computed(() =>
    scanCheckInState({
      error: this.checkInMutation.error(),
      failureCount: this.checkInMutation.failureCount(),
      isError: this.checkInMutation.isError(),
      isPaused: this.checkInMutation.isPaused(),
      isPending: this.checkInMutation.isPending(),
      isSuccess: this.checkInMutation.isSuccess(),
    }),
  );
  /** The server answered, but could not confirm whether the write was saved. */
  protected readonly checkInServerUnconfirmed = computed(
    () =>
      this.checkInState() === 'notConfirmed' &&
      hasErrorTag(
        this.checkInMutation.error(),
        'EventRegistrationInternalError',
      ),
  );
  /**
   * The ticket from the last successful lookup only. After a failed refresh
   * Query keeps the previous data, which must not enable confirmation.
   */
  private readonly ticket = computed(() =>
    this.scanResultQuery.isSuccess() ? this.scanResultQuery.data() : undefined,
  );
  /** The fresh ticket belongs to someone other than the picked attendee. */
  protected readonly ownerChanged = computed(() => {
    const ticket = this.ticket();
    return ticket !== undefined && ticket.user.id !== this.data.userId;
  });
  private readonly refreshListAfterOwnerChange = effect(() => {
    if (this.ownerChanged()) {
      void this.queryClient.invalidateQueries(
        this.rpc.queryFilter(['events', 'getOrganizeOverview']),
      );
    }
  });
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
    // The request already holds the count, and Try again resends it as it
    // was; editing it would mislead.
    disabled(schema.guestCount, () =>
      scanGuestInputLocked(this.checkInState()),
    );
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
   * Confirm needs a successful lookup with no fetch running or paused
   * offline, so a reopened dialog never confirms against cached details from
   * before the last check-in, and a failed or paused refresh never confirms
   * against stale ones. Try again after an unconfirmed check-in resends the
   * original request, so only a request in flight blocks it.
   */
  protected readonly confirmDisabled = computed(() => {
    if (this.checkInState() === 'notConfirmed') {
      return this.checkInMutation.isPending();
    }
    const ticket = this.ticket();
    return (
      !ticket ||
      this.ownerChanged() ||
      this.guestForm().invalid() ||
      scanCheckInActionDisabled({
        allowCheckin: ticket.allowCheckin,
        completed: false,
        mutationPending:
          this.checkInMutation.isPending() ||
          this.scanResultQuery.fetchStatus() !== 'idle',
        spotCount: this.selectedSpotCheckInCount(),
      })
    );
  });

  protected checkIn(): void {
    const resendPayload = scanCheckInRetryPayload(
      this.checkInState(),
      this.checkInMutation.variables(),
    );
    if (resendPayload) {
      // Resend the original request unchanged: the server recognizes its
      // operation key and never counts anyone twice.
      if (!this.checkInMutation.isPending()) {
        this.sendCheckIn(resendPayload);
      }
      return;
    }

    const ticket = this.ticket();
    if (!ticket || this.confirmDisabled()) {
      return;
    }
    // The expected state stays the one the organizer saw.
    this.sendCheckIn({
      checkInMethod: 'manual',
      expectedAttendeeCheckedIn: ticket.attendeeCheckedIn,
      expectedCheckedInGuestCount: ticket.checkedInGuestCount,
      expectedUserId: this.data.userId,
      guestCheckInCount: this.selectedGuestCheckInCount(),
      operationKey: createScanCheckInOperationKey(),
      registrationId: this.data.registrationId,
    });
  }

  private sendCheckIn(payload: ManualCheckInPayload): void {
    const queryKey = this.rpc.events.registrationScanned.queryKey({
      checkInMethod: 'manual',
      registrationId: payload.registrationId,
    });
    this.dialogRef.disableClose = true;
    this.checkInMutation.mutate(payload, {
      onError: (error) => {
        this.dialogRef.disableClose = false;
        // Another device changed the ticket: show its current state.
        if (hasErrorTag(error, 'EventRegistrationConflictError')) {
          void this.queryClient.invalidateQueries({ exact: true, queryKey });
        }
      },
      onSuccess: (result) => {
        this.dialogRef.disableClose = false;
        this.dialogRef.close({
          alreadyCheckedIn: result.alreadyCheckedIn,
          checkedInGuestCount: payload.guestCheckInCount,
        });
        // Only this ticket changed. A missing read after the commit still
        // means the check-in was recorded; the ticket is read again.
        if (result.registration) {
          this.queryClient.setQueryData(queryKey, result.registration);
        } else {
          void this.queryClient.invalidateQueries({ exact: true, queryKey });
        }
      },
    });
  }
}
