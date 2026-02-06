import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { computed } from '@angular/core';
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
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { GoogleLocationType } from '../../../types/location';
import { ConfigService } from '../../core/config.service';
import { injectTRPC } from '../../core/trpc-client';
import { LocationSelectorField } from '../../shared/components/controls/location-selector/location-selector-field/location-selector-field';

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
  private readonly trpc = injectTRPC();
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.trpc.discounts.getTenantProviders.queryOptions(),
  );
  // Derived state for ESN provider
  protected readonly esnEnabled = computed(() => {
    const providers = this.discountProvidersQuery.data();
    if (!providers) return false;
    return providers.find((p) => p.type === 'esnCard')?.status === 'enabled';
  });
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly receiptCountryOptions = RECEIPT_COUNTRY_OPTIONS;
  private readonly queryClient = inject(QueryClient);
  protected readonly setProvidersMutation = injectMutation(() =>
    this.trpc.discounts.setTenantProviders.mutationOptions({
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.discounts.getTenantProviders.pathKey(),
        });
      },
    }),
  );
  protected readonly settingsModel = signal<{
    allowOther: boolean;
    buyEsnCardUrl: string;
    defaultLocation: GoogleLocationType | null;
    receiptCountries: string[];
    theme: 'esn' | 'evorto';
  }>({
    allowOther: false,
    buyEsnCardUrl: '',
    // eslint-disable-next-line unicorn/no-null
    defaultLocation: null,
    receiptCountries: [...DEFAULT_RECEIPT_COUNTRIES],
    theme: 'evorto',
  });
  protected readonly settingsForm = form(this.settingsModel);

  private readonly configService = inject(ConfigService);

  private updateSettingsMutation = injectMutation(() =>
    this.trpc.admin.tenant.updateSettings.mutationOptions(),
  );

  constructor() {
    effect(() => {
      const currentTenant = this.configService.tenant;
      if (currentTenant) {
        const receiptCountrySettings = resolveReceiptCountrySettings(
          currentTenant.discountProviders?.financeReceipts,
        );
        this.settingsModel.set({
          allowOther: receiptCountrySettings.allowOther,
          buyEsnCardUrl:
            currentTenant.discountProviders?.esnCard?.config?.buyEsnCardUrl ??
            '',
          // eslint-disable-next-line unicorn/no-null
          defaultLocation: currentTenant.defaultLocation ?? null,
          receiptCountries: [...receiptCountrySettings.receiptCountries],
          theme: currentTenant.theme,
        });
      }
    });
  }

  async saveSettings(event: Event) {
    event.preventDefault();
    await submit(this.settingsForm, async (formState) => {
      const settings = formState().value();
      this.updateSettingsMutation.mutate(
        {
          allowOther: settings.allowOther,
          defaultLocation: settings.defaultLocation,
          receiptCountries: settings.receiptCountries,
          theme: settings.theme,
        },
        {
          onSuccess: async () => {
            await this.queryClient.invalidateQueries({
              queryKey: this.trpc.config.tenant.pathKey(),
            });
          },
        },
      );
      this.setProvidersMutation.mutate({
        providers: [
          {
            config: {
              buyEsnCardUrl: settings.buyEsnCardUrl.trim() || undefined,
            },
            status: this.esnEnabled() ? 'enabled' : 'disabled',
            type: 'esnCard',
          },
        ],
      });
    });
  }

  protected setEsnEnabled(checked: boolean) {
    this.setProvidersMutation.mutate({
      providers: [
        {
          config: {
            buyEsnCardUrl:
              this.settingsForm.buyEsnCardUrl().value().trim() || undefined,
          },
          status: checked ? 'enabled' : 'disabled',
          type: 'esnCard',
        },
      ],
    });
  }
}
