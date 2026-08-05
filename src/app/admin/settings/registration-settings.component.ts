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
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import type { Tenant } from '../../../types/custom/tenant';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import {
  initializedTenant,
  tenantSettingsInteractionReady,
  tenantSettingsSaveDisabled,
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
  private readonly model = signal<RegistrationSettingsModel>({
    cancellationDeadlineHoursBeforeStart: 120,
    maxActiveRegistrationsPerUser: 0,
    transferDeadlineHoursBeforeStart: 0,
  });
  protected readonly settingsForm = form(
    this.model,
    registrationSettingsFormSchema,
  );
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
      try {
        await this.updateMutation.mutateAsync(formState().value());
        await this.queryClient.invalidateQueries({
          queryKey: this.rpc.pathKey(['config', 'tenant']),
        });
        this.settingsForm().reset();
        this.notifications.showSuccess('Sign-up rules updated');
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            'The sign-up rules could not be saved. Try again.',
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
        cancellationDeadlineHoursBeforeStart:
          tenant.cancellationDeadlineHoursBeforeStart,
        maxActiveRegistrationsPerUser:
          tenant.maxActiveRegistrationsPerUser ?? 0,
        transferDeadlineHoursBeforeStart:
          tenant.transferDeadlineHoursBeforeStart,
      });
      this.settingsForm().reset();
    });
  }
}
