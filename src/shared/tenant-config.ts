import { Schema } from 'effect';

import {
  DEFAULT_RECEIPT_COUNTRIES,
  isCanonicalReceiptCountryCode,
} from './finance/receipt-countries';

export interface EsnCardProviderConfig {
  buyEsnCardUrl?: string;
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

const ReceiptCountryCode = Schema.String.check(
  Schema.makeFilter(isCanonicalReceiptCountryCode, {
    expected: 'a supported uppercase two-letter receipt country code',
  }),
);

const CanonicalHttpsUrl = Schema.NonEmptyString.check(
  Schema.makeFilter(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.toString() === value;
      } catch {
        return false;
      }
    },
    {
      expected: 'a canonical HTTPS URL',
    },
  ),
);

export const TenantDiscountProvidersSchema = Schema.Struct({
  esnCard: Schema.Struct({
    config: Schema.Struct({
      buyEsnCardUrl: Schema.optionalKey(CanonicalHttpsUrl),
    }),
    status: Schema.Literals(['disabled', 'enabled']),
  }),
});

export const TenantReceiptSettingsSchema = Schema.Struct({
  allowOther: Schema.Boolean,
  receiptCountries: Schema.mutable(Schema.Array(ReceiptCountryCode)).check(
    Schema.makeFilter((countries) => countries.length > 0, {
      expected: 'at least one receipt country',
    }),
    Schema.makeFilter(
      (countries) => new Set(countries).size === countries.length,
      {
        expected: 'unique receipt countries',
      },
    ),
  ),
});

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
  configuredProviders: unknown,
): TenantDiscountProviders =>
  Schema.decodeUnknownSync(TenantDiscountProvidersSchema)(configuredProviders);
