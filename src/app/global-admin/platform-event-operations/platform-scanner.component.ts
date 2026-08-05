import type { EventCheckInTimingIssue } from '@shared/event-check-in';
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
import { Router } from '@angular/router';
import {
  registrationCancellationActionLabel,
  registrationCancellationCompletedLabel,
  registrationCancellationFailureMessage,
  registrationCancellationKind,
} from '@shared/registration-cancellation';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { tenantTimezoneLabel } from '../../core/geography-labels';
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

export const platformScannerNavigationErrorMessage =
  'The ticket could not be opened. Check that this organization still exists, then try again.';

export interface PlatformRegistrationStatusIssueCopy {
  readonly body: string;
  readonly title: string;
}

export const platformCheckInTimingIssueCopy = (
  issue: EventCheckInTimingIssue | null,
): null | PlatformRegistrationStatusIssueCopy => {
  switch (issue) {
    case 'ended': {
      return {
        body: 'The event ended more than two hours ago, so check-in is closed. The attendee was not checked in.',
        title: 'Check-in closed',
      };
    }
    case 'notOpen': {
      return {
        body: 'Check-in opens one hour before the event starts.',
        title: 'Check-in not open',
      };
    }
    case null: {
      return null;
    }
  }
};

export const platformRegistrationStatusIssueCopy = (
  status: PlatformRegistrationDetailRecord['status'],
): null | PlatformRegistrationStatusIssueCopy => {
  switch (status) {
    case 'CANCELLED': {
      return {
        body: 'This sign-up has ended and cannot be checked in. Do not ask the attendee to pay or sign up again. If the cancellation or refund looks wrong, review the existing sign-up instead of creating a replacement.',
        title: 'Sign-up ended',
      };
    }
    case 'CONFIRMED': {
      return null;
    }
    case 'PENDING': {
      return {
        body: 'This ticket is not confirmed yet and cannot be checked in. Ask the attendee to open the event or Profile to see whether organizer approval or their existing payment is still needed. Do not start another sign-up or payment here.',
        title: 'Sign-up pending',
      };
    }
    case 'WAITLIST': {
      return {
        body: 'This attendee does not have a confirmed place yet and cannot be checked in. Review the waitlist and available places. Do not take payment or start another sign-up here.',
        title: 'On waitlist',
      };
    }
  }
};

export const platformRegistrationCancellationActionLabel = (
  registration: Pick<
    PlatformRegistrationDetailRecord,
    'paymentPending' | 'status'
  >,
): string => {
  if (registration.status === 'CANCELLED') return 'Sign-up ended';
  return registrationCancellationActionLabel(
    registrationCancellationKind({
      paymentPending: registration.paymentPending,
      status: registration.status,
    }),
  );
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
  ],
  selector: 'app-platform-scanner',
  templateUrl: './platform-scanner.component.html',
})
export class PlatformScannerComponent {
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
  protected readonly lookupNavigationFailed = signal(false);
  protected readonly lookupPending = signal(false);
  protected readonly lookupValue = signal('');
  protected readonly platformCheckInTimingIssueCopy =
    platformCheckInTimingIssueCopy;
  protected readonly platformRegistrationCancellationActionLabel =
    platformRegistrationCancellationActionLabel;
  protected readonly platformRegistrationStatusIssueCopy =
    platformRegistrationStatusIssueCopy;
  protected readonly platformRegistrationStatusLabel =
    platformRegistrationStatusLabel;
  protected readonly reason = signal('');
  protected readonly targetTenantOptionsQuery = injectQuery(() =>
    this.operations.formOptions(this.tenantId()),
  );
  protected readonly tenantTimezoneLabel = tenantTimezoneLabel;
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
        this.notifications.showSuccess('Sign-up approved');
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            'The sign-up could not be approved. Try again.',
            ['RpcBadRequestError'],
          ),
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
    if (registration.status === 'CANCELLED') return;
    const cancellationKind = registrationCancellationKind({
      paymentPending: registration.paymentPending,
      status: registration.status,
    });
    const expectedPaymentPending = registration.paymentPending;
    const expectedStatus = registration.status;

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
          expectedPaymentPending,
          expectedStatus,
          reason,
          registrationId,
          targetTenantId: this.tenantId(),
        });
        await this.refreshRegistration();
        this.resetActionState();
        this.notifications.showSuccess(
          registrationCancellationCompletedLabel(cancellationKind),
        );
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            registrationCancellationFailureMessage(cancellationKind),
            ['RpcBadRequestError'],
          ),
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
        this.notifications.showSuccess('Ticket checked in');
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            'The ticket could not be checked in. Try again.',
            ['RpcBadRequestError', 'EventCheckInUnavailableError'],
          ),
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
        'Paste the complete attendee ticket link or enter a ticket number.',
      );
      this.lookupNavigationFailed.set(false);
      return;
    }
    this.lookupError.set('');
    this.lookupNavigationFailed.set(false);
    void this.navigateToRegistration(registrationId);
  }

  protected setGuestCount(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.guestCheckInValue.set(event.target.value);
    }
  }

  protected setLookupValue(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    this.lookupValue.set(event.target.value);
    this.lookupError.set('');
    this.lookupNavigationFailed.set(false);
  }

  protected setReason(event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) {
      this.reason.set(event.target.value);
    }
  }

  private async navigateToRegistration(registrationId: string): Promise<void> {
    if (this.lookupPending()) return;

    this.lookupPending.set(true);
    try {
      const navigated = await this.router.navigate([
        '/global-admin/tenants',
        this.tenantId(),
        'scanner',
        registrationId,
      ]);
      if (!navigated) {
        this.lookupError.set(platformScannerNavigationErrorMessage);
        this.lookupNavigationFailed.set(true);
      }
    } catch {
      this.lookupError.set(platformScannerNavigationErrorMessage);
      this.lookupNavigationFailed.set(true);
    } finally {
      this.lookupPending.set(false);
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
