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
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import type {
  SupportedTenantTimezone,
  Tenant,
} from '../../../types/custom/tenant';
import type { GoogleLocationType } from '../../../types/location';

import { isIanaTimezone } from '../../../types/custom/tenant';
import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { tenantTimezoneOptions } from '../../core/geography-labels';
import { NotificationService } from '../../core/notification.service';
import { LocationSelectorField } from '../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import { tenantIdentityRows as buildTenantIdentityRows } from './organization-settings.identity';
import {
  initializedTenant,
  optionalTrimmed,
  tenantSettingsInteractionReady,
  tenantSettingsSaveDisabled,
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
  private readonly model = signal<OrganizationSettingsModel>({
    defaultLocation: null,
    emailSenderEmail: '',
    emailSenderName: '',
    timezone: 'Europe/Berlin',
  });
  protected readonly settingsForm = form(
    this.model,
    organizationSettingsFormSchema,
  );
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

  constructor() {
    effect(() => {
      this.hydrateFromTenant(this.currentTenant());
    });
  }

  public hasUnsavedSettingsChanges(): boolean {
    return this.settingsForm().dirty();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (
      tenantSettingsSaveDisabled({
        formInvalid: this.settingsForm().invalid(),
        formSubmitting: this.settingsForm().submitting(),
        interactionReady: this.settingsInteractionReady(),
        mutationPending: this.updateMutation.isPending(),
      })
    ) {
      return;
    }

    await submit(this.settingsForm, async (formState) => {
      const settings = formState().value();
      const reloadRequired =
        this.currentTenant().timezone !== settings.timezone;
      try {
        await this.updateMutation.mutateAsync({
          defaultLocation: settings.defaultLocation,
          emailSenderEmail: optionalTrimmed(settings.emailSenderEmail),
          emailSenderName: optionalTrimmed(settings.emailSenderName),
          timezone: settings.timezone,
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.rpc.pathKey(['config', 'tenant']),
        });
        this.settingsForm().reset();
        this.notifications.showSuccess('Organization settings updated');
        if (reloadRequired) {
          this.document.defaultView?.location.reload();
        }
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            'The organization settings could not be saved. Try again.',
            ['RpcBadRequestError', 'AdminTenantNotFoundError'],
          ),
        );
      }
    });
  }

  private hydrateFromTenant(tenant: Tenant): void {
    if (!tenantSettingsShouldHydrate(this.settingsForm().dirty())) {
      return;
    }
    untracked(() => {
      this.model.set({
        defaultLocation: tenant.defaultLocation ?? null,
        emailSenderEmail: tenant.emailSenderEmail ?? '',
        emailSenderName: tenant.emailSenderName ?? '',
        timezone: tenant.timezone,
      });
      this.settingsForm().reset();
    });
  }
}
