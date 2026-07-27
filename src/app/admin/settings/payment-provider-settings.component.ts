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
  RECEIPT_COUNTRY_OPTIONS,
  resolveReceiptCountrySettings,
} from '@shared/finance/receipt-countries';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import type { Tenant } from '../../../types/custom/tenant';

import { supportedTenantCurrencies } from '../../../types/custom/tenant';
import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import {
  initializedTenant,
  optionalTrimmed,
  tenantSettingsInteractionReady,
  tenantSettingsSaveDisabled,
  tenantSettingsShouldHydrate,
} from './settings-form';

interface PaymentProviderSettingsModel {
  allowOther: boolean;
  buyEsnCardUrl: string;
  currency: AdminTenantUpdatePaymentProviderSettingsInput['currency'];
  esnCardEnabled: boolean;
  receiptCountries: string[];
  refundFeesOnCancellation: boolean;
  stripeAccountId: string;
}

export const paymentProviderSettingsFormSchema =
  schema<PaymentProviderSettingsModel>((settings) => {
    validate(settings.receiptCountries, ({ value }) =>
      value().length > 0
        ? undefined
        : {
            kind: 'required',
            message: 'Choose at least one receipt country.',
          },
    );
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
  protected readonly receiptCountryOptions = RECEIPT_COUNTRY_OPTIONS;
  private readonly model = signal<PaymentProviderSettingsModel>({
    allowOther: false,
    buyEsnCardUrl: '',
    currency: 'EUR',
    esnCardEnabled: false,
    receiptCountries: [...DEFAULT_RECEIPT_COUNTRIES],
    refundFeesOnCancellation: true,
    stripeAccountId: '',
  });
  protected readonly settingsForm = form(
    this.model,
    paymentProviderSettingsFormSchema,
  );
  protected readonly settingsInteractionReady =
    tenantSettingsInteractionReady();
  protected readonly tenantSettingsSaveDisabled = tenantSettingsSaveDisabled;
  private readonly rpc = AppRpc.injectClient();
  protected readonly updateMutation = injectMutation(() =>
    this.rpc.admin.tenant.updatePaymentProviderSettings.mutationOptions(),
  );
  private readonly configService = inject(ConfigService);
  private readonly currentTenant = computed(() =>
    initializedTenant(this.configService),
  );
  private readonly document = inject(DOCUMENT);
  private readonly expectedStripeAccountId = signal<null | string>(null);
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
        this.currentTenant().currency !== settings.currency;
      try {
        await this.updateMutation.mutateAsync({
          allowOther: settings.allowOther,
          buyEsnCardUrl: optionalTrimmed(settings.buyEsnCardUrl),
          currency: settings.currency,
          esnCardEnabled: settings.esnCardEnabled,
          expectedStripeAccountId: this.expectedStripeAccountId(),
          receiptCountries: settings.receiptCountries,
          refundFeesOnCancellation: settings.refundFeesOnCancellation,
          stripeAccountId: optionalTrimmed(settings.stripeAccountId),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.rpc.pathKey(['config', 'tenant']),
        });
        await this.queryClient.invalidateQueries(
          this.rpc.queryFilter(['discounts', 'getTenantProviders']),
        );
        this.settingsForm().reset();
        this.notifications.showSuccess(
          reloadRequired
            ? 'Payment and provider settings updated. Reloading to apply the currency.'
            : 'Payment and provider settings updated',
        );
        if (reloadRequired) {
          this.document.defaultView?.location.reload();
        }
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            'Failed to update payment and provider settings',
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
      const receiptSettings = resolveReceiptCountrySettings(
        tenant.receiptSettings,
      );
      this.expectedStripeAccountId.set(tenant.stripeAccountId ?? null);
      this.model.set({
        allowOther: receiptSettings.allowOther,
        buyEsnCardUrl:
          tenant.discountProviders.esnCard.config.buyEsnCardUrl ?? '',
        currency: tenant.currency,
        esnCardEnabled: tenant.discountProviders.esnCard.status === 'enabled',
        receiptCountries: [...receiptSettings.receiptCountries],
        refundFeesOnCancellation: tenant.refundFeesOnCancellation,
        stripeAccountId: tenant.stripeAccountId ?? '',
      });
      this.settingsForm().reset();
    });
  }
}
