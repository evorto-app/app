import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { form, FormField, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  DEFAULT_RECEIPT_COUNTRIES,
  RECEIPT_COUNTRY_OPTIONS,
  resolveReceiptCountrySettings,
} from '@shared/finance/receipt-countries';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { GoogleLocationType } from '../../../types/location';
import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { LocationSelectorField } from '../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import {
  deferredTenantSettingsRows,
  tenantIdentityRows,
} from './general-settings.identity';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    RouterLink,
    MatButtonModule,
    MatSlideToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    FormField,
    LocationSelectorField,
  ],
  selector: 'app-general-settings',
  styles: ``,
  templateUrl: './general-settings.component.html',
})
export class GeneralSettingsComponent {
  protected readonly deferredTenantSettingsRows = deferredTenantSettingsRows;
  protected readonly settingsModel = signal<{
    allowOther: boolean;
    buyEsnCardUrl: string;
    defaultLocation: GoogleLocationType | null;
    esnCardEnabled: boolean;
    faviconUrl: string;
    legalNoticeUrl: string;
    logoUrl: string;
    privacyPolicyUrl: string;
    receiptCountries: string[];
    seoDescription: string;
    seoTitle: string;
    termsUrl: string;
    theme: 'esn' | 'evorto';
  }>({
    allowOther: false,
    buyEsnCardUrl: '',
    defaultLocation: null,
    esnCardEnabled: false,
    faviconUrl: '',
    legalNoticeUrl: '',
    logoUrl: '',
    privacyPolicyUrl: '',
    receiptCountries: [...DEFAULT_RECEIPT_COUNTRIES],
    seoDescription: '',
    seoTitle: '',
    termsUrl: '',
    theme: 'evorto',
  });
  protected readonly esnEnabled = computed(
    () => this.settingsModel().esnCardEnabled,
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly receiptCountryOptions = RECEIPT_COUNTRY_OPTIONS;
  protected readonly settingsForm = form(this.settingsModel);
  private readonly configService = inject(ConfigService);
  protected readonly tenantIdentityRows = computed(() =>
    tenantIdentityRows(this.configService.tenant),
  );
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly rpc = AppRpc.injectClient();

  private updateSettingsMutation = injectMutation(() =>
    this.rpc.admin.tenant.updateSettings.mutationOptions(),
  );

  constructor() {
    effect(() => {
      const currentTenant = this.configService.tenant;
      if (currentTenant) {
        const receiptCountrySettings = resolveReceiptCountrySettings(
          currentTenant.receiptSettings,
        );
        this.settingsModel.set({
          allowOther: receiptCountrySettings.allowOther,
          buyEsnCardUrl:
            currentTenant.discountProviders?.esnCard?.config?.buyEsnCardUrl ??
            '',
          defaultLocation: currentTenant.defaultLocation ?? null,
          esnCardEnabled:
            currentTenant.discountProviders?.esnCard?.status === 'enabled',
          faviconUrl: currentTenant.faviconUrl ?? '',
          legalNoticeUrl: currentTenant.legalNoticeUrl ?? '',
          logoUrl: currentTenant.logoUrl ?? '',
          privacyPolicyUrl: currentTenant.privacyPolicyUrl ?? '',
          receiptCountries: [...receiptCountrySettings.receiptCountries],
          seoDescription: currentTenant.seoDescription ?? '',
          seoTitle: currentTenant.seoTitle ?? '',
          termsUrl: currentTenant.termsUrl ?? '',
          theme: currentTenant.theme,
        });
      }
    });
  }

  async saveSettings(event: Event) {
    event.preventDefault();
    await submit(this.settingsForm, async (formState) => {
      const settings = formState().value();
      try {
        await this.updateSettingsMutation.mutateAsync(
          {
            allowOther: settings.allowOther,
            buyEsnCardUrl: settings.buyEsnCardUrl.trim() || undefined,
            defaultLocation: settings.defaultLocation,
            esnCardEnabled: settings.esnCardEnabled,
            faviconUrl: settings.faviconUrl.trim() || undefined,
            legalNoticeUrl: settings.legalNoticeUrl.trim() || undefined,
            logoUrl: settings.logoUrl.trim() || undefined,
            privacyPolicyUrl: settings.privacyPolicyUrl.trim() || undefined,
            receiptCountries: settings.receiptCountries,
            seoDescription: settings.seoDescription.trim() || undefined,
            seoTitle: settings.seoTitle.trim() || undefined,
            termsUrl: settings.termsUrl.trim() || undefined,
            theme: settings.theme,
          },
          {
            onSuccess: async () => {
              await this.queryClient.invalidateQueries({
                queryKey: this.rpc.pathKey(['config', 'tenant']),
              });
              await this.queryClient.invalidateQueries(
                this.rpc.queryFilter(['discounts', 'getTenantProviders']),
              );
            },
          },
        );
        this.notifications.showSuccess('Tenant settings updated');
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to update tenant settings'),
        );
      }
    });
  }

  protected setEsnEnabled(checked: boolean) {
    this.settingsModel.update((current) => ({
      ...current,
      esnCardEnabled: checked,
    }));
  }
}
