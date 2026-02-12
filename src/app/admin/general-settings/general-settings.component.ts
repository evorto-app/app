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
  protected readonly settingsModel = signal<{
    allowOther: boolean;
    buyEsnCardUrl: string;
    defaultLocation: GoogleLocationType | null;
    esnCardEnabled: boolean;
    receiptCountries: string[];
    theme: 'esn' | 'evorto';
  }>({
    allowOther: false,
    buyEsnCardUrl: '',
    // eslint-disable-next-line unicorn/no-null
    defaultLocation: null,
    esnCardEnabled: false,
    receiptCountries: [...DEFAULT_RECEIPT_COUNTRIES],
    theme: 'evorto',
  });
  protected readonly esnEnabled = computed(
    () => this.settingsModel().esnCardEnabled,
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly receiptCountryOptions = RECEIPT_COUNTRY_OPTIONS;
  protected readonly settingsForm = form(this.settingsModel);
  private readonly configService = inject(ConfigService);
  private readonly queryClient = inject(QueryClient);
  private readonly rpc = AppRpc.injectClient();

  private readonly trpc = injectTRPC();

  private updateSettingsMutation = injectMutation(() =>
    this.rpc.admin['tenant.updateSettings'].mutationOptions(),
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
          // eslint-disable-next-line unicorn/no-null
          defaultLocation: currentTenant.defaultLocation ?? null,
          esnCardEnabled:
            currentTenant.discountProviders?.esnCard?.status === 'enabled',
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
          buyEsnCardUrl: settings.buyEsnCardUrl.trim() || undefined,
          defaultLocation: settings.defaultLocation,
          esnCardEnabled: settings.esnCardEnabled,
          receiptCountries: settings.receiptCountries,
          theme: settings.theme,
        },
        {
          onSuccess: async () => {
            await this.queryClient.invalidateQueries({
              queryKey: this.rpc.pathKey(['config', 'tenant']),
            });
            await this.queryClient.invalidateQueries({
              queryKey: this.trpc.discounts.getTenantProviders.pathKey(),
            });
          },
        },
      );
    });
  }

  protected setEsnEnabled(checked: boolean) {
    this.settingsModel.update((current) => ({
      ...current,
      esnCardEnabled: checked,
    }));
  }
}
