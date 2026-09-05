import type { AdminTenantUpdatePaymentProviderSettingsInput } from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

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
  isCanonicalReceiptCountryCode,
  RECEIPT_COUNTRY_OPTIONS,
  resolveReceiptCountrySettings,
} from '@shared/finance/receipt-countries';
import {
  type AdminTenantPaymentProviderSettingsSnapshot,
  adminTenantPaymentProviderSettingsSnapshot,
} from '@shared/tenant-settings-snapshot';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { supportedTenantCurrencies } from '../../../types/custom/tenant';
import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
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

interface PaymentProviderSettingsModel {
  allowOther: boolean;
  buyEsnCardUrl: string;
  currency: AdminTenantUpdatePaymentProviderSettingsInput['currency'];
  esnCardEnabled: boolean;
  receiptCountries: string[];
  refundFeesOnCancellation: boolean;
}

export const paymentProviderSettingsFormSchema =
  schema<PaymentProviderSettingsModel>((settings) => {
    validate(settings.receiptCountries, ({ value }) => {
      const countries = value();
      if (countries.length === 0) {
        return {
          kind: 'required',
          message: 'Choose at least one receipt country.',
        };
      }
      return countries.every(isCanonicalReceiptCountryCode) &&
        new Set(countries).size === countries.length
        ? undefined
        : {
            kind: 'receiptCountries',
            message:
              'Select at least one supported receipt country without duplicates.',
          };
    });
  });

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    RouterLink,
  ],
  selector: 'app-payment-provider-settings',
  templateUrl: './payment-provider-settings.component.html',
})
export class PaymentProviderSettingsComponent {
  protected readonly currencyOptions = supportedTenantCurrencies;
  protected readonly faArrowLeft = faArrowLeft;
  private readonly configService = inject(ConfigService);
  private readonly currentTenant = computed(() =>
    initializedTenant(this.configService),
  );
  protected readonly paymentsConfigured = computed(
    () => this.currentTenant().paymentsConfigured,
  );
  protected readonly receiptCountryOptions = RECEIPT_COUNTRY_OPTIONS;
  protected readonly saveOutcome = signal<null | TenantSettingsSaveOutcome>(
    null,
  );
  protected readonly settingsPhase = signal<'reading' | 'saving' | null>(null);
  protected readonly settingsLocked = computed(
    () => this.settingsPhase() !== null || this.saveOutcome() !== null,
  );
  private readonly model = signal<PaymentProviderSettingsModel>({
    allowOther: false,
    buyEsnCardUrl: '',
    currency: 'EUR',
    esnCardEnabled: false,
    receiptCountries: [...DEFAULT_RECEIPT_COUNTRIES],
    refundFeesOnCancellation: true,
  });
  protected readonly settingsForm = form(this.model, (settings) => {
    apply(settings, paymentProviderSettingsFormSchema);
    disabled(settings, () => this.settingsLocked());
  });
  protected readonly settingsInteractionReady =
    tenantSettingsInteractionReady();
  protected readonly tenantSettingsSaveDisabled = tenantSettingsSaveDisabled;
  private readonly rpc = AppRpc.injectClient();
  protected readonly updateMutation = injectMutation(() =>
    this.rpc.admin.tenant.updatePaymentProviderSettings.mutationOptions(),
  );
  private readonly document = inject(DOCUMENT);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  // Signal Forms excludes disabled fields from its dirty state.
  private readonly retainedSettingsDirty = signal(false);
  private expectedSettings: AdminTenantPaymentProviderSettingsSnapshot | null =
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
        this.currentTenant().currency !== settings.currency;
      this.retainedSettingsDirty.set(this.hasUnsavedSettingsChanges());
      this.settingsPhase.set('saving');
      try {
        try {
          await this.updateMutation.mutateAsync({
            allowOther: settings.allowOther,
            buyEsnCardUrl: optionalTrimmed(settings.buyEsnCardUrl),
            currency: settings.currency,
            esnCardEnabled: settings.esnCardEnabled,
            expectedSettings,
            receiptCountries: settings.receiptCountries,
            refundFeesOnCancellation: settings.refundFeesOnCancellation,
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
            this.rpc.queryFilter(['discounts', 'getTenantProviders']),
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
        this.notifications.showSuccess('Payment settings updated');
        if (reloadRequired) {
          this.document.defaultView?.location.reload();
        }
      } finally {
        this.settingsPhase.set(null);
      }
    });
  }

  private hydrateFromTenant(
    tenant: ReturnType<typeof initializedTenant>,
  ): void {
    if (
      this.settingsLocked() ||
      !tenantSettingsShouldHydrate(this.hasUnsavedSettingsChanges())
    ) {
      return;
    }
    untracked(() => {
      const receiptSettings = resolveReceiptCountrySettings(
        tenant.receiptSettings,
      );
      this.model.set({
        allowOther: receiptSettings.allowOther,
        buyEsnCardUrl:
          tenant.discountProviders.esnCard.config.buyEsnCardUrl ?? '',
        currency: tenant.currency,
        esnCardEnabled: tenant.discountProviders.esnCard.status === 'enabled',
        receiptCountries: [...receiptSettings.receiptCountries],
        refundFeesOnCancellation: tenant.refundFeesOnCancellation,
      });
      this.expectedSettings =
        adminTenantPaymentProviderSettingsSnapshot(tenant);
      this.settingsForm().reset();
      this.retainedSettingsDirty.set(false);
    });
  }
}
