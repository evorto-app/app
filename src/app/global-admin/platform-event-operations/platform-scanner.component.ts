import type { PlatformRegistrationDetailRecord } from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';

import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injectable,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';
import { platformEventInstantToDisplayDateTime } from './platform-event-date-time';
import {
  formatPlatformRegistrationRefundAmount,
  PlatformRegistrationCancellationConfirmationData,
  PlatformRegistrationCancellationConfirmationDialogComponent,
} from './platform-registration-cancellation-confirmation-dialog.component';

export const registrationIdFromPlatformScannerInput = (
  value: string,
): string | undefined => {
  const normalized = value.trim();
  if (!normalized) return;
  try {
    const url = new URL(normalized);
    const match = /^\/scan\/registration\/([^/]+)$/.exec(url.pathname);
    return match?.[1];
  } catch {
    return /^[^\s/]+$/.test(normalized) ? normalized : undefined;
  }
};

export interface PlatformRegistrationStatusIssueCopy {
  readonly body: string;
  readonly title: string;
}

export const platformRegistrationStatusIssueCopy = (
  status: PlatformRegistrationDetailRecord['status'],
): null | PlatformRegistrationStatusIssueCopy => {
  switch (status) {
    case 'CANCELLED': {
      return {
        body: 'This ticket was cancelled and cannot be checked in. Do not ask the attendee to pay or register again. If the cancellation or refund looks wrong, review the existing registration and refund instead of creating a replacement.',
        title: 'Registration cancelled',
      };
    }
    case 'CONFIRMED': {
      return null;
    }
    case 'PENDING': {
      return {
        body: 'This ticket is not confirmed yet and cannot be checked in. Ask the attendee to open the event or Profile to see whether organizer approval or their existing payment is still needed. Do not start a second registration or payment from the scanner.',
        title: 'Registration pending',
      };
    }
    case 'WAITLIST': {
      return {
        body: 'This attendee does not have a confirmed spot yet and cannot be checked in. Review the waitlist and capacity. Do not take payment or create another registration from the scanner.',
        title: 'Registration on waitlist',
      };
    }
  }
};

export const platformRegistrationStatusLabel = (
  status: PlatformRegistrationDetailRecord['status'],
): string => {
  switch (status) {
    case 'CANCELLED': {
      return 'Cancelled';
    }
    case 'CONFIRMED': {
      return 'Confirmed';
    }
    case 'PENDING': {
      return 'Pending';
    }
    case 'WAITLIST': {
      return 'On waitlist';
    }
  }
};

export interface PlatformGuestCheckInSelection {
  readonly count: number;
  readonly error: string;
}

export const platformGuestCheckInSelection = ({
  inputValue,
  remainingGuestCount,
}: {
  inputValue: string;
  remainingGuestCount: number;
}): PlatformGuestCheckInSelection => {
  const maximum = Math.max(0, remainingGuestCount);
  const count = Number(inputValue);
  if (
    inputValue.trim().length === 0 ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > maximum
  ) {
    return {
      count: 0,
      error: `Enter a whole number from 0 to ${maximum}.`,
    };
  }

  return { count, error: '' };
};

export const platformGuestCheckInIssue = ({
  attendeeCheckedIn,
  selection,
}: {
  attendeeCheckedIn: boolean;
  selection: PlatformGuestCheckInSelection;
}): string => {
  if (selection.error) {
    return selection.error;
  }
  return attendeeCheckedIn && selection.count === 0
    ? 'Choose at least one guest to check in.'
    : '';
};

@Injectable({ providedIn: 'root' })
export class PlatformScannerOperations {
  private readonly rpc = AppRpc.injectClient();

  approve() {
    return this.rpc.platform.registrations.approve.mutationOptions();
  }

  cancel() {
    return this.rpc.platform.registrations.cancel.mutationOptions();
  }

  checkIn() {
    return this.rpc.platform.registrations.checkIn.mutationOptions();
  }

  findOne(targetTenantId: string, registrationId: string) {
    return this.rpc.platform.registrations.findOne.queryOptions({
      registrationId,
      targetTenantId,
    });
  }

  formOptions(targetTenantId: string) {
    return this.rpc.platform.events.formOptions.queryOptions({
      targetTenantId,
    });
  }

  list(targetTenantId: string, eventId: string | undefined) {
    return this.rpc.platform.registrations.list.queryOptions({
      eventId,
      limit: 100,
      offset: 0,
      targetTenantId,
    });
  }

  registrationFilter() {
    return this.rpc.queryFilter(['platform', 'registrations']);
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    PlatformTenantPageHeaderComponent,
    RouterLink,
  ],
  selector: 'app-platform-scanner',
  templateUrl: './platform-scanner.component.html',
})
export class PlatformScannerComponent {
  readonly eventId = input<string>();
  readonly registrationId = input<string>();
  readonly tenantId = input.required<string>();

  private readonly operations = inject(PlatformScannerOperations);
  protected readonly approveMutation = injectMutation(() =>
    this.operations.approve(),
  );
  protected readonly cancelMutation = injectMutation(() =>
    this.operations.cancel(),
  );
  protected readonly checkInMutation = injectMutation(() =>
    this.operations.checkIn(),
  );
  protected readonly guestCheckInValue = signal('0');
  protected readonly registrationQuery = injectQuery(() => ({
    ...this.operations.findOne(
      this.tenantId(),
      this.registrationId() ?? '__none__',
    ),
    enabled: Boolean(this.registrationId()),
  }));
  protected readonly guestCheckInSelection = computed(() =>
    platformGuestCheckInSelection({
      inputValue: this.guestCheckInValue(),
      remainingGuestCount:
        this.registrationQuery.data()?.remainingGuestCount ?? 0,
    }),
  );
  protected readonly guestCheckInIssue = computed(() => {
    const registration = this.registrationQuery.data();
    if (!registration) return '';
    return platformGuestCheckInIssue({
      attendeeCheckedIn: registration.attendeeCheckedIn,
      selection: this.guestCheckInSelection(),
    });
  });
  protected readonly lookupError = signal('');
  protected readonly lookupInteractive = signal(false);
  protected readonly lookupValue = signal('');
  protected readonly platformRegistrationStatusIssueCopy =
    platformRegistrationStatusIssueCopy;
  protected readonly platformRegistrationStatusLabel =
    platformRegistrationStatusLabel;
  protected readonly reason = signal('');
  protected readonly registrationsQuery = injectQuery(() =>
    this.operations.list(this.tenantId(), this.eventId()),
  );
  protected readonly targetTenantOptionsQuery = injectQuery(() =>
    this.operations.formOptions(this.tenantId()),
  );
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  constructor() {
    afterNextRender(() => this.lookupInteractive.set(true));
    effect(() => {
      this.registrationId();
      untracked(() => this.resetActionState());
    });
  }

  protected anyActionPending(): boolean {
    return (
      this.approveMutation.isPending() ||
      this.cancelMutation.isPending() ||
      this.checkInMutation.isPending()
    );
  }

  protected approve(): void {
    const registrationId = this.registrationId();
    const reason = this.reason().trim();
    if (!registrationId || !reason || this.anyActionPending()) return;

    void (async () => {
      try {
        await this.approveMutation.mutateAsync({
          reason,
          registrationId,
          targetTenantId: this.tenantId(),
        });
        await this.refreshRegistration();
        this.resetActionState();
        this.notifications.showSuccess('Registration approved');
      } catch {
        this.notifications.showError(
          'The registration could not be approved. Try again.',
        );
      }
    })();
  }

  protected cancel(): void {
    const registrationId = this.registrationId();
    const reason = this.reason().trim();
    if (
      !registrationId ||
      !reason ||
      this.anyActionPending() ||
      !this.registrationQuery.isSuccess()
    ) {
      return;
    }
    const registration = this.registrationQuery.data();

    void (async () => {
      const confirmed = await firstValueFrom(
        this.dialog
          .open<
            PlatformRegistrationCancellationConfirmationDialogComponent,
            PlatformRegistrationCancellationConfirmationData,
            boolean
          >(PlatformRegistrationCancellationConfirmationDialogComponent, {
            data: { reason, registration },
            width: 'min(38rem, calc(100vw - 2rem))',
          })
          .afterClosed(),
      );
      if (confirmed !== true || this.anyActionPending()) return;

      try {
        await this.cancelMutation.mutateAsync({
          reason,
          registrationId,
          targetTenantId: this.tenantId(),
        });
        await this.refreshRegistration();
        this.resetActionState();
        this.notifications.showSuccess('Registration cancelled');
      } catch {
        this.notifications.showError(
          'The registration could not be cancelled. Try again.',
        );
      }
    })();
  }

  protected checkIn(): void {
    const registrationId = this.registrationId();
    const reason = this.reason().trim();
    if (
      !registrationId ||
      !reason ||
      this.anyActionPending() ||
      this.guestCheckInIssue()
    )
      return;

    void (async () => {
      try {
        await this.checkInMutation.mutateAsync({
          guestCheckInCount: this.guestCheckInSelection().count,
          reason,
          registrationId,
          targetTenantId: this.tenantId(),
        });
        await this.refreshRegistration();
        this.resetActionState();
        this.notifications.showSuccess('Registration checked in');
      } catch {
        this.notifications.showError(
          'The registration could not be checked in. Try again.',
        );
      }
    })();
  }

  protected displayDateTime(value: string): string {
    return this.targetTenantOptionsQuery.isSuccess()
      ? platformEventInstantToDisplayDateTime(
          value,
          this.targetTenantOptionsQuery.data().timezone,
        )
      : '';
  }

  protected formatRefundAmount(
    registration: PlatformRegistrationDetailRecord,
  ): string {
    const amount = registration.cancellation.refund.amount;
    return amount === null
      ? ''
      : formatPlatformRegistrationRefundAmount(amount, registration.currency);
  }

  protected openLookup(event?: Event): void {
    event?.preventDefault();
    const registrationId = registrationIdFromPlatformScannerInput(
      this.lookupValue(),
    );
    if (!registrationId) {
      this.lookupError.set(
        'Paste the complete attendee ticket link or enter a registration ID.',
      );
      return;
    }
    this.lookupError.set('');
    void this.router.navigate([
      '/global-admin/tenants',
      this.tenantId(),
      'scanner',
      registrationId,
    ]);
  }

  protected setGuestCount(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.guestCheckInValue.set(event.target.value);
    }
  }

  protected setLookupValue(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.lookupValue.set(event.target.value);
    }
  }

  protected setReason(event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) {
      this.reason.set(event.target.value);
    }
  }

  private async refreshRegistration(): Promise<void> {
    await this.queryClient.invalidateQueries(
      this.operations.registrationFilter(),
    );
    await this.registrationQuery.refetch();
  }

  private resetActionState(): void {
    this.guestCheckInValue.set('0');
    this.reason.set('');
  }
}
