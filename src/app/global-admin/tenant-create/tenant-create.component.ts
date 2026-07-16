import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import {
  supportedTenantCurrencies,
  supportedTenantTimezones,
} from '../../../types/custom/tenant';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import {
  createGlobalAdminTenantFormModel,
  globalAdminTenantPayloadFromForm,
  globalAdminTenantSubmitDisabled,
} from '../tenant-form/tenant-form.model';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    RouterLink,
  ],
  selector: 'app-tenant-create',
  templateUrl: './tenant-create.component.html',
})
export class TenantCreateComponent {
  private readonly rpc = AppRpc.injectClient();
  protected readonly createTenantMutation = injectMutation(() =>
    this.rpc.globalAdmin.tenants.create.mutationOptions(),
  );
  protected readonly currencyOptions = supportedTenantCurrencies;
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly initialPrivacyPolicyModel = signal({
    privacyPolicyText: '',
    privacyPolicyUrl: '',
  });
  protected readonly hasInitialPrivacyPolicy = computed(() => {
    const policy = this.initialPrivacyPolicyModel();
    return (
      policy.privacyPolicyText.trim().length > 0 ||
      policy.privacyPolicyUrl.trim().length > 0
    );
  });
  protected readonly initialPrivacyPolicyForm = form(
    this.initialPrivacyPolicyModel,
  );
  protected readonly tenantModel = signal(createGlobalAdminTenantFormModel());
  protected readonly tenantForm = form(this.tenantModel, (schema) => {
    required(schema.domain);
    required(schema.name);
    required(schema.reason);
    validate(schema.domain, ({ value }) =>
      value().trim().length === 0
        ? { kind: 'required', message: 'Domain is required.' }
        : undefined,
    );
    validate(schema.name, ({ value }) =>
      value().trim().length === 0
        ? { kind: 'required', message: 'Name is required.' }
        : undefined,
    );
    validate(schema.reason, ({ value }) =>
      value().trim().length === 0
        ? { kind: 'required', message: 'Reason is required.' }
        : undefined,
    );
  });
  protected readonly tenantSubmitDisabled = globalAdminTenantSubmitDisabled;
  protected readonly timezoneOptions = supportedTenantTimezones;
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  private readonly router = inject(Router);

  protected async createTenant(event: Event): Promise<void> {
    event.preventDefault();
    if (
      this.createTenantMutation.isPending() ||
      !this.hasInitialPrivacyPolicy()
    ) {
      return;
    }
    await submit(this.tenantForm, async (formState) => {
      const payload = (() => {
        try {
          return globalAdminTenantPayloadFromForm(formState().value());
        } catch (error) {
          this.notifications.showError(
            getErrorMessage(error, 'Failed to create organization'),
          );
          return null;
        }
      })();

      if (!payload) {
        return;
      }

      this.createTenantMutation.mutate(
        {
          ...payload,
          initialPrivacyPolicy: this.initialPrivacyPolicyModel(),
        },
        {
          onError: (error) => {
            this.notifications.showError(
              getErrorMessage(error, 'Failed to create organization'),
            );
          },
          onSuccess: async (tenant) => {
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['globalAdmin', 'tenants.findMany']),
            );
            this.notifications.showSuccess('Organization created');
            await this.router.navigate(['/global-admin/tenants', tenant.id]);
          },
        },
      );
    });
  }
}
