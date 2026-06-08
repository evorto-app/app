import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { form, FormField, required, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faCircleInfo,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import {
  supportedTenantCurrencies,
  supportedTenantLocales,
  supportedTenantTimezones,
} from '../../../types/custom/tenant';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import {
  createGlobalAdminTenantFormModel,
  globalAdminTenantPayloadFromForm,
  globalAdminTenantRelaunchScopeItems,
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
  protected readonly faCircleInfo = faCircleInfo;
  protected readonly localeOptions = supportedTenantLocales;
  protected readonly relaunchScopeItems = globalAdminTenantRelaunchScopeItems;
  protected readonly tenantModel = signal(createGlobalAdminTenantFormModel());
  protected readonly tenantForm = form(this.tenantModel, (schema) => {
    required(schema.domain);
    required(schema.name);
  });
  protected readonly tenantSubmitDisabled = globalAdminTenantSubmitDisabled;
  protected readonly timezoneOptions = supportedTenantTimezones;
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  private readonly router = inject(Router);

  protected async createTenant(event: Event): Promise<void> {
    event.preventDefault();
    if (this.createTenantMutation.isPending()) {
      return;
    }
    await submit(this.tenantForm, async (formState) => {
      this.createTenantMutation.mutate(
        globalAdminTenantPayloadFromForm(formState().value()),
        {
          onError: (error) => {
            this.notifications.showError(
              getErrorMessage(error, 'Failed to create tenant'),
            );
          },
          onSuccess: async (tenant) => {
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['globalAdmin', 'tenants.findMany']),
            );
            this.notifications.showSuccess('Tenant created');
            await this.router.navigate(['/global-admin/tenants', tenant.id]);
          },
        },
      );
    });
  }
}
