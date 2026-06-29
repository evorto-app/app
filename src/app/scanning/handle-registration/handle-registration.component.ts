import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { DateTime } from 'luxon';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';

export const scanCheckInButtonLabel = ({
  completed,
  pending,
  spotCount,
}: {
  completed: boolean;
  pending: boolean;
  spotCount: number;
}): string => {
  if (pending) {
    return 'Checking in...';
  }

  if (completed) {
    return 'Checked in';
  }

  return spotCount > 1 ? `Confirm ${spotCount} check-ins` : 'Confirm check-in';
};

export const scanSpotCountLabel = (spotCount: number): string =>
  spotCount === 1 ? '1 spot now' : `${spotCount} spots now`;

export const scanCheckInActionDisabled = ({
  allowCheckin,
  completed,
  mutationPending,
  spotCount,
}: {
  allowCheckin: boolean;
  completed: boolean;
  mutationPending: boolean;
  spotCount: number;
}): boolean => !allowCheckin || completed || mutationPending || spotCount < 1;

export const scanGuestCheckInCountFromInput = ({
  inputValue,
  remainingGuestCount,
}: {
  inputValue: string;
  remainingGuestCount: number;
}): number => {
  const nextGuestCount = Number.parseInt(inputValue, 10);
  return Math.max(
    0,
    Math.min(
      Number.isNaN(nextGuestCount) ? 0 : nextGuestCount,
      remainingGuestCount,
    ),
  );
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FaDuotoneIconComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    RouterLink,
    DatePipe,
  ],
  selector: 'app-handle-registration',
  styles: ``,
  templateUrl: './handle-registration.component.html',
})
export class HandleRegistrationComponent {
  public readonly registrationId = input.required<string>();
  private readonly rpc = AppRpc.injectClient();
  protected readonly checkInMutation = injectMutation(() =>
    this.rpc.events.checkInRegistration.mutationOptions(),
  );
  protected readonly scanResultQuery = injectQuery(() =>
    this.rpc.events.registrationScanned.queryOptions({
      registrationId: this.registrationId(),
    }),
  );
  protected readonly guestCheckInCount = signal(0);
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
  private readonly localCheckInCompleted = signal(false);
  protected readonly checkInCompleted = computed(
    () =>
      this.localCheckInCompleted() ||
      (this.checkInMutation.isSuccess() &&
        this.selectedSpotCheckInCount() === 0),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly scanCheckInActionDisabled = scanCheckInActionDisabled;
  protected readonly scanCheckInButtonLabel = scanCheckInButtonLabel;
  protected readonly scanSpotCountLabel = scanSpotCountLabel;
  protected readonly startsSoon = computed(() => {
    const scanResult = this.scanResultQuery.data();
    if (!scanResult) return false;
    return DateTime.fromISO(scanResult.event.start).diffNow('hours').hours < 1;
  });
  private readonly queryClient = inject(QueryClient);

  checkIn() {
    const scanResult = this.scanResultQuery.data();
    if (
      scanCheckInActionDisabled({
        allowCheckin: scanResult?.allowCheckin ?? false,
        completed: this.checkInCompleted(),
        mutationPending: this.checkInMutation.isPending(),
        spotCount: this.selectedSpotCheckInCount(),
      })
    )
      return;

    this.checkInMutation.mutate(
      {
        guestCheckInCount: this.selectedGuestCheckInCount(),
        registrationId: this.registrationId(),
      },
      {
        onSuccess: async () => {
          this.localCheckInCompleted.set(true);
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['events', 'registrationScanned']),
          );
        },
      },
    );
  }

  updateGuestCheckInCount(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const remainingGuestCount =
      this.scanResultQuery.data()?.remainingGuestCount ?? 0;
    this.guestCheckInCount.set(
      scanGuestCheckInCountFromInput({
        inputValue: input.value,
        remainingGuestCount,
      }),
    );
  }

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Unknown error');
  }
}
