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
  protected readonly checkInCompleted = signal(false);
  private readonly rpc = AppRpc.injectClient();
  protected readonly checkInMutation = injectMutation(() =>
    this.rpc.events.checkInRegistration.mutationOptions(),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly guestCheckInCount = signal(0);
  protected readonly scanResultQuery = injectQuery(() =>
    this.rpc.events.registrationScanned.queryOptions({
      registrationId: this.registrationId(),
    }),
  );
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
  protected readonly startsSoon = computed(() => {
    const scanResult = this.scanResultQuery.data();
    if (!scanResult) return false;
    return DateTime.fromISO(scanResult.event.start).diffNow('hours').hours < 1;
  });
  private readonly queryClient = inject(QueryClient);

  checkIn() {
    const scanResult = this.scanResultQuery.data();
    if (
      !scanResult?.allowCheckin ||
      this.selectedSpotCheckInCount() < 1 ||
      this.checkInMutation.isPending()
    )
      return;

    this.checkInMutation.mutate(
      {
        guestCheckInCount: this.selectedGuestCheckInCount(),
        registrationId: this.registrationId(),
      },
      {
        onSuccess: async () => {
          this.checkInCompleted.set(true);
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
    const nextGuestCount = Number.parseInt(input.value, 10);
    const remainingGuestCount =
      this.scanResultQuery.data()?.remainingGuestCount ?? 0;
    this.guestCheckInCount.set(
      Math.max(
        0,
        Math.min(
          Number.isNaN(nextGuestCount) ? 0 : nextGuestCount,
          remainingGuestCount,
        ),
      ),
    );
  }

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Unknown error');
  }
}
