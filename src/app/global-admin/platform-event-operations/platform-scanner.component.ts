import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Injectable,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';

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
    DatePipe,
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
  protected readonly guestCheckInCount = signal(0);
  protected readonly lookupError = signal('');
  protected readonly lookupValue = signal('');
  protected readonly reason = signal('');
  protected readonly registrationQuery = injectQuery(() => ({
    ...this.operations.findOne(
      this.tenantId(),
      this.registrationId() ?? '__none__',
    ),
    enabled: Boolean(this.registrationId()),
  }));
  protected readonly registrationsQuery = injectQuery(() =>
    this.operations.list(this.tenantId(), this.eventId()),
  );
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

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
        this.reason.set('');
        this.notifications.showSuccess('Registration approved');
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to approve registration'),
        );
      }
    })();
  }

  protected cancel(): void {
    const registrationId = this.registrationId();
    const reason = this.reason().trim();
    if (!registrationId || !reason || this.anyActionPending()) return;

    void (async () => {
      try {
        await this.cancelMutation.mutateAsync({
          reason,
          registrationId,
          targetTenantId: this.tenantId(),
        });
        await this.refreshRegistration();
        this.reason.set('');
        this.notifications.showSuccess('Registration cancelled');
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to cancel registration'),
        );
      }
    })();
  }

  protected checkIn(): void {
    const registrationId = this.registrationId();
    const reason = this.reason().trim();
    if (!registrationId || !reason || this.anyActionPending()) return;

    void (async () => {
      try {
        await this.checkInMutation.mutateAsync({
          guestCheckInCount: this.guestCheckInCount(),
          reason,
          registrationId,
          targetTenantId: this.tenantId(),
        });
        await this.refreshRegistration();
        this.reason.set('');
        this.notifications.showSuccess('Registration checked in');
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to check in registration'),
        );
      }
    })();
  }

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Failed to inspect registration');
  }

  protected openLookup(): void {
    const registrationId = registrationIdFromPlatformScannerInput(
      this.lookupValue(),
    );
    if (!registrationId) {
      this.lookupError.set(
        'Enter a registration ID or a ticket URL ending in /scan/registration/{id}.',
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
      this.guestCheckInCount.set(Number(event.target.value));
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
}
