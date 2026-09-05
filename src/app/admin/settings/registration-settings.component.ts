import type { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';

import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  apply,
  disabled,
  form,
  FormField,
  required,
  schema,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { maximumPostgresInteger } from '@shared/schema-utilities';
import {
  type AdminTenantRegistrationSettingsSnapshot,
  adminTenantRegistrationSettingsSnapshot,
} from '@shared/tenant-settings-snapshot';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import {
  initializedTenant,
  isTenantSettingsConflict,
  readTenantSettings,
  tenantSettingsInteractionReady,
  tenantSettingsSaveDenial,
  tenantSettingsSaveDisabled,
  type TenantSettingsSaveOutcome,
  tenantSettingsShouldHydrate,
} from './settings-form';

export interface RegistrationSettingsModel {
  cancellationDeadlineHoursBeforeStart: number;
  maxActiveRegistrationsPerUser: number;
  transferDeadlineHoursBeforeStart: number;
}

export const nonNegativeIntegerValidationError = (value: number) => {
  if (!Number.isInteger(value)) {
    return {
      kind: 'integer',
      message: 'Enter a whole number.',
    };
  }
  if (value < 0) {
    return {
      kind: 'nonNegative',
      message: 'Enter zero or more.',
    };
  }
  if (value > maximumPostgresInteger) {
    return {
      kind: 'maximum',
      message: 'Enter a value no greater than 2,147,483,647.',
    };
  }
  return;
};

export const registrationSettingsFormSchema = schema<RegistrationSettingsModel>(
  (settings) => {
    required(settings.maxActiveRegistrationsPerUser, {
      message: 'Enter an active sign-up limit.',
    });
    validate(settings.maxActiveRegistrationsPerUser, ({ value }) =>
      nonNegativeIntegerValidationError(value()),
    );
    required(settings.cancellationDeadlineHoursBeforeStart, {
      message: 'Enter a cancellation deadline.',
    });
    validate(settings.cancellationDeadlineHoursBeforeStart, ({ value }) =>
      nonNegativeIntegerValidationError(value()),
    );
    required(settings.transferDeadlineHoursBeforeStart, {
      message: 'Enter a transfer deadline.',
    });
    validate(settings.transferDeadlineHoursBeforeStart, ({ value }) =>
      nonNegativeIntegerValidationError(value()),
    );
  },
);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    RouterLink,
  ],
  selector: 'app-registration-settings',
  templateUrl: './registration-settings.component.html',
})
export class RegistrationSettingsComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly saveOutcome = signal<null | TenantSettingsSaveOutcome>(
    null,
  );
  protected readonly settingsPhase = signal<'reading' | 'saving' | null>(null);
  protected readonly settingsLocked = computed(
    () => this.settingsPhase() !== null || this.saveOutcome() !== null,
  );
  private readonly model = signal<RegistrationSettingsModel>({
    cancellationDeadlineHoursBeforeStart: 120,
    maxActiveRegistrationsPerUser: 0,
    transferDeadlineHoursBeforeStart: 0,
  });
  protected readonly settingsForm = form(this.model, (settings) => {
    apply(settings, registrationSettingsFormSchema);
    disabled(settings, () => this.settingsLocked());
  });
  protected readonly settingsInteractionReady =
    tenantSettingsInteractionReady();
  protected readonly tenantSettingsSaveDisabled = tenantSettingsSaveDisabled;
  private readonly rpc = AppRpc.injectClient();
  protected readonly updateMutation = injectMutation(() =>
    this.rpc.admin.tenant.updateRegistrationSettings.mutationOptions(),
  );
  private readonly configService = inject(ConfigService);
  private readonly currentTenant = computed(() =>
    initializedTenant(this.configService),
  );
  private readonly document = inject(DOCUMENT);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  // Signal Forms excludes disabled fields from its dirty state.
  private readonly retainedSettingsDirty = signal(false);
  private expectedSettings: AdminTenantRegistrationSettingsSnapshot | null =
    null;

  constructor() {
    effect(() => {
      this.hydrateFromTenant(this.currentTenant());
    });
  }

  public hasUnsavedSettingsChanges(): boolean {
    return this.retainedSettingsDirty() || this.settingsForm().dirty();
  }

  protected reloadSettings(): void {
    if (this.settingsPhase() !== null || this.saveOutcome() === null) return;
    this.document.defaultView?.location.reload();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const expectedSettings = this.expectedSettings;
    if (
      !expectedSettings ||
      tenantSettingsSaveDisabled({
        formInvalid: this.settingsForm().invalid(),
        formSubmitting: this.settingsForm().submitting(),
        interactionReady: this.settingsInteractionReady(),
        mutationPending:
          this.updateMutation.isPending() || this.settingsLocked(),
      })
    ) {
      return;
    }

    await submit(this.settingsForm, async (formState) => {
      if (this.settingsLocked()) return;
      this.retainedSettingsDirty.set(this.hasUnsavedSettingsChanges());
      this.settingsPhase.set('saving');
      try {
        try {
          await this.updateMutation.mutateAsync({
            ...formState().value(),
            expectedSettings,
          });
        } catch (error) {
          if (isTenantSettingsConflict(error)) {
            this.saveOutcome.set('stale');
            return;
          }
          const denial = tenantSettingsSaveDenial(error);
          if (denial) {
            this.notifications.showError(denial);
          } else {
            this.saveOutcome.set('unknown');
          }
          return;
        }
        this.settingsPhase.set('reading');
        try {
          const readState = await readTenantSettings(this.queryClient, [
            this.rpc.queryFilter(['config', 'tenant']),
          ]);
          if (readState === 'paused') {
            this.saveOutcome.set('saved-read-paused');
            return;
          }
        } catch {
          this.saveOutcome.set('saved-read-failed');
          return;
        }
        this.settingsForm().reset();
        this.retainedSettingsDirty.set(false);
        this.notifications.showSuccess('Sign-up rules updated');
      } finally {
        this.settingsPhase.set(null);
      }
    });
  }

  private hydrateFromTenant(tenant: ClientTenantConfig): void {
    if (
      this.settingsLocked() ||
      !tenantSettingsShouldHydrate(this.hasUnsavedSettingsChanges())
    ) {
      return;
    }
    untracked(() => {
      this.model.set({
        cancellationDeadlineHoursBeforeStart:
          tenant.cancellationDeadlineHoursBeforeStart,
        maxActiveRegistrationsPerUser: tenant.maxActiveRegistrationsPerUser,
        transferDeadlineHoursBeforeStart:
          tenant.transferDeadlineHoursBeforeStart,
      });
      this.expectedSettings = adminTenantRegistrationSettingsSnapshot(tenant);
      this.settingsForm().reset();
      this.retainedSettingsDirty.set(false);
    });
  }
}
