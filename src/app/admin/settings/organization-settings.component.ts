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
  schema,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  type AdminTenantOrganizationSettingsSnapshot,
  adminTenantOrganizationSettingsSnapshot,
} from '@shared/tenant-settings-snapshot';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import type { SupportedTenantTimezone } from '../../../types/custom/tenant';
import type { GoogleLocationType } from '../../../types/location';

import { isIanaTimezone } from '../../../types/custom/tenant';
import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { tenantTimezoneOptions } from '../../core/geography-labels';
import { NotificationService } from '../../core/notification.service';
import { LocationSelectorField } from '../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import { tenantIdentityRows as buildTenantIdentityRows } from './organization-settings.identity';
import {
  initializedTenant,
  isTenantSettingsConflict,
  optionalTrimmed,
  readTenantSettings,
  tenantSettingsInteractionReady,
  tenantSettingsSaveDenial,
  tenantSettingsSaveDisabled,
  type TenantSettingsSaveOutcome,
  tenantSettingsShouldHydrate,
} from './settings-form';

export interface OrganizationSettingsModel {
  defaultLocation: GoogleLocationType | null;
  emailSenderEmail: string;
  emailSenderName: string;
  timezone: SupportedTenantTimezone;
}

export const tenantTimezoneValidationError = (timezone: string) =>
  isIanaTimezone(timezone)
    ? undefined
    : {
        kind: 'ianaTimezone',
        message: 'Enter a recognized city or region time zone.',
      };

export const organizationSettingsFormSchema = schema<OrganizationSettingsModel>(
  (settings) => {
    validate(settings.timezone, ({ value }) =>
      tenantTimezoneValidationError(value()),
    );
  },
);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
    LocationSelectorField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    RouterLink,
  ],
  selector: 'app-organization-settings',
  templateUrl: './organization-settings.component.html',
})
export class OrganizationSettingsComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly saveOutcome = signal<null | TenantSettingsSaveOutcome>(
    null,
  );
  protected readonly settingsPhase = signal<'reading' | 'saving' | null>(null);
  protected readonly settingsLocked = computed(
    () => this.settingsPhase() !== null || this.saveOutcome() !== null,
  );
  private readonly model = signal<OrganizationSettingsModel>({
    defaultLocation: null,
    emailSenderEmail: '',
    emailSenderName: '',
    timezone: 'Europe/Berlin',
  });
  protected readonly settingsForm = form(this.model, (settings) => {
    apply(settings, organizationSettingsFormSchema);
    disabled(settings, () => this.settingsLocked());
  });
  protected readonly settingsInteractionReady =
    tenantSettingsInteractionReady();
  private readonly configService = inject(ConfigService);
  private readonly currentTenant = computed(() =>
    initializedTenant(this.configService),
  );
  protected readonly tenantIdentityRows = computed(() =>
    buildTenantIdentityRows(this.currentTenant()),
  );
  protected readonly tenantSettingsSaveDisabled = tenantSettingsSaveDisabled;
  protected readonly timezoneOptions = tenantTimezoneOptions;
  private readonly rpc = AppRpc.injectClient();
  protected readonly updateMutation = injectMutation(() =>
    this.rpc.admin.tenant.updateOrganizationSettings.mutationOptions(),
  );
  private readonly document = inject(DOCUMENT);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  // Signal Forms excludes disabled fields from its dirty state.
  private readonly retainedSettingsDirty = signal(false);
  private expectedSettings: AdminTenantOrganizationSettingsSnapshot | null =
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
      const settings = formState().value();
      const reloadRequired =
        this.currentTenant().timezone !== settings.timezone;
      this.retainedSettingsDirty.set(this.hasUnsavedSettingsChanges());
      this.settingsPhase.set('saving');
      try {
        try {
          await this.updateMutation.mutateAsync({
            defaultLocation: settings.defaultLocation,
            emailSenderEmail: optionalTrimmed(settings.emailSenderEmail),
            emailSenderName: optionalTrimmed(settings.emailSenderName),
            expectedSettings,
            timezone: settings.timezone,
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
        this.notifications.showSuccess('Organization settings updated');
        if (reloadRequired) {
          this.document.defaultView?.location.reload();
        }
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
        defaultLocation: tenant.defaultLocation ?? null,
        emailSenderEmail: tenant.emailSenderEmail ?? '',
        emailSenderName: tenant.emailSenderName ?? '',
        timezone: tenant.timezone,
      });
      this.expectedSettings = adminTenantOrganizationSettingsSnapshot(tenant);
      this.settingsForm().reset();
      this.retainedSettingsDirty.set(false);
    });
  }
}
