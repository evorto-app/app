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
  emailSenderEmail: string;
  emailSenderName: string;
  esnCardEnabled: boolean;
  faviconUrl: string;
  legalNoticeText: string;
  legalNoticeUrl: string;
  locale: SupportedTenantLocale;
  logoUrl: string;
  maxActiveRegistrationsPerUser: number;
  privacyPolicyText: string;
  privacyPolicyUrl: string;
  receiptCountries: string[];
  seoDescription: string;
  seoTitle: string;
  stripeAccountId: string;
  termsText: string;
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
  emailSenderEmail: optionalTrimmed(settings.emailSenderEmail),
  emailSenderName: optionalTrimmed(settings.emailSenderName),
  esnCardEnabled: settings.esnCardEnabled,
  faviconUrl: optionalTrimmed(settings.faviconUrl),
  legalNoticeText: optionalTrimmed(settings.legalNoticeText),
  legalNoticeUrl: optionalTrimmed(settings.legalNoticeUrl),
  locale: settings.locale,
  logoUrl: optionalTrimmed(settings.logoUrl),
  maxActiveRegistrationsPerUser: Math.max(
    0,
    Math.trunc(settings.maxActiveRegistrationsPerUser),
  ),
  privacyPolicyText: optionalTrimmed(settings.privacyPolicyText),
  privacyPolicyUrl: optionalTrimmed(settings.privacyPolicyUrl),
  receiptCountries: settings.receiptCountries,
  seoDescription: optionalTrimmed(settings.seoDescription),
  seoTitle: optionalTrimmed(settings.seoTitle),
  stripeAccountId: optionalTrimmed(settings.stripeAccountId),
  termsText: optionalTrimmed(settings.termsText),
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
