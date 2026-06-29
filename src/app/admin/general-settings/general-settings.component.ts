import type { AdminTenantBrandAssetKind } from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

import { DOCUMENT } from '@angular/common';
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
import { faArrowLeft, faUpload } from '@fortawesome/duotone-regular-svg-icons';
import {
  DEFAULT_RECEIPT_COUNTRIES,
  RECEIPT_COUNTRY_OPTIONS,
  resolveReceiptCountrySettings,
} from '@shared/finance/receipt-countries';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import {
  supportedTenantCurrencies,
  supportedTenantLocales,
  supportedTenantTimezones,
} from '../../../types/custom/tenant';
import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { LocationSelectorField } from '../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import {
  deferredTenantSettingsRows,
  tenantIdentityRows,
} from './general-settings.identity';
import {
  GeneralSettingsModel,
  generalSettingsPayloadFromModel,
  requiresLocaleMoneyRuntimeReload,
} from './general-settings.payload';

export const generalSettingsSaveDisabled = ({
  formInvalid,
  formSubmitting,
  mutationPending,
}: {
  formInvalid: boolean;
  formSubmitting: boolean;
  mutationPending: boolean;
}): boolean => formInvalid || formSubmitting || mutationPending;

export const generalSettingsBrandAssetUploadDisabled = ({
  mutationPending,
  uploadingBrandAsset,
}: {
  mutationPending: boolean;
  uploadingBrandAsset: AdminTenantBrandAssetKind | null;
}): boolean => uploadingBrandAsset !== null || mutationPending;

const tenantBrandAssetClientMaxSizeBytes = 5 * 1024 * 1024;
const tenantBrandAssetClientMimeTypes = {
  favicon: new Set([
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/vnd.microsoft.icon',
    'image/webp',
    'image/x-icon',
  ]),
  logo: new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']),
} satisfies Record<AdminTenantBrandAssetKind, ReadonlySet<string>>;

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
  private readonly rpc = AppRpc.injectClient();
  protected readonly updateSettingsMutation = injectMutation(() =>
    this.rpc.admin.tenant.updateSettings.mutationOptions(),
  );
  protected readonly uploadingBrandAsset =
    signal<AdminTenantBrandAssetKind | null>(null);
  private readonly uploadBrandAssetMutation = injectMutation(() =>
    this.rpc.admin.tenant.uploadBrandAsset.mutationOptions(),
  );
  protected readonly brandAssetUploadDisabled = computed(() =>
    generalSettingsBrandAssetUploadDisabled({
      mutationPending:
        this.uploadBrandAssetMutation.isPending() ||
        this.updateSettingsMutation.isPending(),
      uploadingBrandAsset: this.uploadingBrandAsset(),
    }),
  );
  protected readonly currencyOptions = supportedTenantCurrencies;
  protected readonly deferredTenantSettingsRows = deferredTenantSettingsRows;
  protected readonly settingsModel = signal<GeneralSettingsModel>({
    allowOther: false,
    buyEsnCardUrl: '',
    currency: 'EUR',
    defaultLocation: null,
    esnCardEnabled: false,
    faviconUrl: '',
    legalNoticeText: '',
    legalNoticeUrl: '',
    locale: 'en-GB',
    logoUrl: '',
    privacyPolicyText: '',
    privacyPolicyUrl: '',
    receiptCountries: [...DEFAULT_RECEIPT_COUNTRIES],
    seoDescription: '',
    seoTitle: '',
    termsText: '',
    termsUrl: '',
    theme: 'evorto',
    timezone: 'Europe/Berlin',
  });
  protected readonly esnEnabled = computed(
    () => this.settingsModel().esnCardEnabled,
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faUpload = faUpload;
  protected readonly generalSettingsSaveDisabled = generalSettingsSaveDisabled;
  protected readonly localeOptions = supportedTenantLocales;
  protected readonly receiptCountryOptions = RECEIPT_COUNTRY_OPTIONS;
  protected readonly settingsForm = form(this.settingsModel);
  private readonly configService = inject(ConfigService);
  protected readonly tenantIdentityRows = computed(() =>
    tenantIdentityRows(this.configService.tenant),
  );
  protected readonly timezoneOptions = supportedTenantTimezones;
  private readonly document = inject(DOCUMENT);

  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

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
          currency: currentTenant.currency,
          defaultLocation: currentTenant.defaultLocation ?? null,
          esnCardEnabled:
            currentTenant.discountProviders?.esnCard?.status === 'enabled',
          faviconUrl: currentTenant.faviconUrl ?? '',
          legalNoticeText: currentTenant.legalNoticeText ?? '',
          legalNoticeUrl: currentTenant.legalNoticeUrl ?? '',
          locale: currentTenant.locale,
          logoUrl: currentTenant.logoUrl ?? '',
          privacyPolicyText: currentTenant.privacyPolicyText ?? '',
          privacyPolicyUrl: currentTenant.privacyPolicyUrl ?? '',
          receiptCountries: [...receiptCountrySettings.receiptCountries],
          seoDescription: currentTenant.seoDescription ?? '',
          seoTitle: currentTenant.seoTitle ?? '',
          termsText: currentTenant.termsText ?? '',
          termsUrl: currentTenant.termsUrl ?? '',
          theme: currentTenant.theme,
          timezone: currentTenant.timezone,
        });
      }
    });
  }

  async saveSettings(event: Event) {
    event.preventDefault();
    if (
      generalSettingsSaveDisabled({
        formInvalid: this.settingsForm().invalid(),
        formSubmitting: this.settingsForm().submitting(),
        mutationPending: this.updateSettingsMutation.isPending(),
      })
    ) {
      return;
    }

    await submit(this.settingsForm, async (formState) => {
      const settings = formState().value();
      const reloadRequired = requiresLocaleMoneyRuntimeReload(
        this.configService.tenant,
        settings,
      );
      try {
        await this.updateSettingsMutation.mutateAsync(
          generalSettingsPayloadFromModel(settings),
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
        this.notifications.showSuccess(
          reloadRequired
            ? 'Tenant settings updated. Reloading to apply locale and money settings.'
            : 'Tenant settings updated',
        );
        if (reloadRequired) {
          this.document.defaultView?.location.reload();
        }
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

  protected async uploadBrandAsset(
    kind: AdminTenantBrandAssetKind,
    event: Event,
  ): Promise<void> {
    const input = event.target as HTMLInputElement | undefined;
    const file = input?.files?.[0] ?? null;
    if (!file) {
      return;
    }
    if (this.brandAssetUploadDisabled()) {
      if (input) {
        input.value = '';
      }
      return;
    }
    if (!tenantBrandAssetClientMimeTypes[kind].has(file.type)) {
      this.notifications.showError(
        kind === 'favicon'
          ? 'Favicons must be PNG, JPEG, WebP, GIF, or ICO files'
          : 'Logos must be PNG, JPEG, WebP, or GIF files',
      );
      if (input) {
        input.value = '';
      }
      return;
    }
    if (file.size <= 0 || file.size > tenantBrandAssetClientMaxSizeBytes) {
      this.notifications.showError(
        'Brand asset file must be between 1 byte and 5 MB',
      );
      if (input) {
        input.value = '';
      }
      return;
    }

    this.uploadingBrandAsset.set(kind);
    try {
      const uploaded = await this.uploadBrandAssetMutation.mutateAsync({
        fileBase64: await this.readFileAsBase64(file),
        fileName: file.name,
        fileSizeBytes: file.size,
        kind,
        mimeType: file.type,
      });
      this.settingsModel.update((current) => ({
        ...current,
        [kind === 'logo' ? 'logoUrl' : 'faviconUrl']: uploaded.assetUrl,
      }));
      this.notifications.showSuccess(
        kind === 'logo'
          ? 'Logo uploaded. Save settings to publish it.'
          : 'Favicon uploaded. Save settings to publish it.',
      );
    } catch (error) {
      this.notifications.showError(
        getErrorMessage(error, 'Failed to upload brand asset'),
      );
    } finally {
      this.uploadingBrandAsset.set(null);
      if (input) {
        input.value = '';
      }
    }
  }

  private async readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('error', () => {
        reject(new Error('Failed to read brand asset'));
      });
      reader.addEventListener('load', () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('Invalid brand asset payload'));
          return;
        }
        const commaIndex = reader.result.indexOf(',');
        if (commaIndex === -1) {
          reject(new Error('Invalid brand asset data URL'));
          return;
        }
        resolve(reader.result.slice(commaIndex + 1));
      });
      reader.readAsDataURL(file);
    });
  }
}
