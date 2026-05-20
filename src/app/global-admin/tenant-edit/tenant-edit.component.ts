import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  linkedSignal,
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
  injectQuery,
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
  type GlobalAdminTenantFormModel,
  globalAdminTenantFormModelFromRecord,
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
  selector: 'app-tenant-edit',
  templateUrl: './tenant-edit.component.html',
})
export class TenantEditComponent {
  readonly tenantId = input.required<string>();
  protected readonly currencyOptions = supportedTenantCurrencies;
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faCircleInfo = faCircleInfo;
  protected readonly localeOptions = supportedTenantLocales;
  protected readonly relaunchScopeItems = globalAdminTenantRelaunchScopeItems;
  private readonly rpc = AppRpc.injectClient();
  protected readonly tenantQuery = injectQuery(() =>
    this.rpc.globalAdmin.tenants.findOne.queryOptions({
      id: this.tenantId(),
    }),
  );
  protected readonly tenantModel = linkedSignal<
    GlobalAdminTenantRecord | null | undefined,
    GlobalAdminTenantFormModel
  >({
    computation: (tenant, previous) =>
      tenant
        ? globalAdminTenantFormModelFromRecord(tenant)
        : (previous?.value ?? createGlobalAdminTenantFormModel()),
    source: () => this.tenantQuery.data(),
  });
  protected readonly tenantForm = form(this.tenantModel, (schema) => {
    required(schema.domain);
    required(schema.name);
  });
  protected readonly tenantSubmitDisabled = globalAdminTenantSubmitDisabled;
  protected readonly timezoneOptions = supportedTenantTimezones;

  protected readonly updateTenantMutation = injectMutation(() =>
    this.rpc.globalAdmin.tenants.update.mutationOptions(),
  );
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Failed to load tenant');
  }

  protected async updateTenant(event: Event): Promise<void> {
    event.preventDefault();
    if (this.updateTenantMutation.isPending()) {
      return;
    }
    await submit(this.tenantForm, async (formState) => {
      const payload = (() => {
        try {
          return globalAdminTenantPayloadFromForm(formState().value());
        } catch (error) {
          this.notifications.showError(
            getErrorMessage(error, 'Failed to update tenant'),
          );
          return null;
        }
      })();

      if (!payload) {
        return;
      }

      this.updateTenantMutation.mutate(
        {
          ...payload,
          id: this.tenantId(),
        },
        {
          onError: (error) => {
            this.notifications.showError(
              getErrorMessage(error, 'Failed to update tenant'),
            );
          },
          onSuccess: async (updatedTenant) => {
            this.queryClient.setQueriesData<GlobalAdminTenantRecord | null>(
              this.rpc.queryFilter(['globalAdmin', 'tenants.findOne']),
              (tenant) =>
                tenant?.id === updatedTenant.id ? updatedTenant : tenant,
            );
            this.queryClient.setQueriesData<GlobalAdminTenantRecord[]>(
              this.rpc.queryFilter(['globalAdmin', 'tenants.findMany']),
              (tenants) =>
                tenants?.map((tenant) =>
                  tenant.id === updatedTenant.id ? updatedTenant : tenant,
                ) ?? tenants,
            );
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['globalAdmin', 'tenants.findMany']),
            );
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['globalAdmin', 'tenants.findOne']),
            );
            this.notifications.showSuccess('Tenant updated');
            await this.router.navigate([
              '/global-admin/tenants',
              this.tenantId(),
            ]);
          },
        },
      );
    });
  }
}
