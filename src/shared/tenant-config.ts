import {
  DEFAULT_RECEIPT_COUNTRIES,
  resolveAllowedReceiptCountries,
} from './finance/receipt-countries';

export interface EsnCardProviderConfig {
  buyEsnCardUrl?: string;
  validationMode?: 'live' | 'test';
}

export type EsnCardProviderStatus = 'disabled' | 'enabled';

export interface TenantDiscountProviders {
  esnCard: {
    config: EsnCardProviderConfig;
    status: EsnCardProviderStatus;
  };
}

export interface TenantReceiptSettings {
  allowOther: boolean;
  receiptCountries: string[];
}

export const createDefaultTenantDiscountProviders =
  (): TenantDiscountProviders => ({
    esnCard: {
      config: {},
      status: 'disabled',
    },
  });

export const DEFAULT_TENANT_RECEIPT_ALLOW_OTHER = false;
export const DEFAULT_TENANT_RECEIPT_COUNTRIES = [...DEFAULT_RECEIPT_COUNTRIES];

export const resolveTenantDiscountProviders = (
  configuredProviders:
    | null
    | Partial<{
        esnCard: {
          config?: {
            buyEsnCardUrl?: string;
            validationMode?: 'live' | 'test';
          };
          status?: EsnCardProviderStatus;
        };
      }>
    | undefined,
): TenantDiscountProviders => {
  const defaults = createDefaultTenantDiscountProviders();
  const buyEsnCardUrl =
    configuredProviders?.esnCard?.config?.buyEsnCardUrl?.trim() || undefined;
  const validationMode: EsnCardProviderConfig['validationMode'] | undefined =
    configuredProviders?.esnCard?.config?.validationMode === 'test'
      ? 'test'
      : undefined;
  const config: EsnCardProviderConfig = {};
  if (buyEsnCardUrl) {
    config.buyEsnCardUrl = buyEsnCardUrl;
  }
  if (validationMode) {
    config.validationMode = validationMode;
  }

  return {
    esnCard: {
      config,
      status:
        configuredProviders?.esnCard?.status === 'enabled'
          ? 'enabled'
          : defaults.esnCard.status,
    },
  };
};

export const resolveTenantReceiptSettings = (
  configuredSettings:
    | null
    | undefined
    | {
        allowOther?: boolean;
        receiptCountries?: readonly string[];
      },
): TenantReceiptSettings => ({
  allowOther: configuredSettings?.allowOther === true,
  receiptCountries: resolveAllowedReceiptCountries(
    configuredSettings?.receiptCountries,
  ),
});
