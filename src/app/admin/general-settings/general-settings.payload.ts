import type { AdminTenantUpdateSettingsInput } from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

import type {
  SupportedTenantCurrency,
  SupportedTenantLocale,
  SupportedTenantTimezone,
  Tenant,
} from '../../../types/custom/tenant';
import type { GoogleLocationType } from '../../../types/location';

export interface GeneralSettingsModel {
  allowOther: boolean;
  buyEsnCardUrl: string;
  currency: SupportedTenantCurrency;
  defaultLocation: GoogleLocationType | null;
  esnCardEnabled: boolean;
  faviconUrl: string;
  legalNoticeUrl: string;
  locale: SupportedTenantLocale;
  logoUrl: string;
  privacyPolicyUrl: string;
  receiptCountries: string[];
  seoDescription: string;
  seoTitle: string;
  termsUrl: string;
  theme: 'esn' | 'evorto';
  timezone: SupportedTenantTimezone;
}

const optionalTrimmed = (value: string): string | undefined =>
  value.trim() || undefined;

export const generalSettingsPayloadFromModel = (
  settings: GeneralSettingsModel,
): AdminTenantUpdateSettingsInput => ({
  allowOther: settings.allowOther,
  buyEsnCardUrl: optionalTrimmed(settings.buyEsnCardUrl),
  currency: settings.currency,
  defaultLocation: settings.defaultLocation,
  esnCardEnabled: settings.esnCardEnabled,
  faviconUrl: optionalTrimmed(settings.faviconUrl),
  legalNoticeUrl: optionalTrimmed(settings.legalNoticeUrl),
  locale: settings.locale,
  logoUrl: optionalTrimmed(settings.logoUrl),
  privacyPolicyUrl: optionalTrimmed(settings.privacyPolicyUrl),
  receiptCountries: settings.receiptCountries,
  seoDescription: optionalTrimmed(settings.seoDescription),
  seoTitle: optionalTrimmed(settings.seoTitle),
  termsUrl: optionalTrimmed(settings.termsUrl),
  theme: settings.theme,
  timezone: settings.timezone,
});

export const requiresLocaleMoneyRuntimeReload = (
  currentTenant: Pick<Tenant, 'currency' | 'locale' | 'timezone'>,
  settings: Pick<GeneralSettingsModel, 'currency' | 'locale' | 'timezone'>,
): boolean =>
  currentTenant.currency !== settings.currency ||
  currentTenant.locale !== settings.locale ||
  currentTenant.timezone !== settings.timezone;
