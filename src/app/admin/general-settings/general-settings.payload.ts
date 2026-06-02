import type { AdminTenantUpdateSettingsInput } from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

import type {
  SupportedTenantCurrency,
  SupportedTenantEventReviewPolicy,
  SupportedTenantLocale,
  SupportedTenantStripeAccountManagementPolicy,
  SupportedTenantTimezone,
  Tenant,
} from '../../../types/custom/tenant';
import type { GoogleLocationType } from '../../../types/location';

export interface GeneralSettingsModel {
  allowOther: boolean;
  buyEsnCardUrl: string;
  currency: SupportedTenantCurrency;
  defaultLocation: GoogleLocationType | null;
  emailSenderName: string;
  esnCardEnabled: boolean;
  eventReviewPolicy: SupportedTenantEventReviewPolicy;
  faviconUrl: string;
  legalNoticeText: string;
  legalNoticeUrl: string;
  locale: SupportedTenantLocale;
  logoUrl: string;
  privacyPolicyText: string;
  privacyPolicyUrl: string;
  receiptCountries: string[];
  registrationLimitCount: null | number;
  registrationLimitWindowDays: null | number;
  seoDescription: string;
  seoTitle: string;
  stripeAccountManagement: SupportedTenantStripeAccountManagementPolicy;
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
  emailSenderName: optionalTrimmed(settings.emailSenderName),
  esnCardEnabled: settings.esnCardEnabled,
  eventReviewPolicy: settings.eventReviewPolicy,
  faviconUrl: optionalTrimmed(settings.faviconUrl),
  legalNoticeText: optionalTrimmed(settings.legalNoticeText),
  legalNoticeUrl: optionalTrimmed(settings.legalNoticeUrl),
  locale: settings.locale,
  logoUrl: optionalTrimmed(settings.logoUrl),
  privacyPolicyText: optionalTrimmed(settings.privacyPolicyText),
  privacyPolicyUrl: optionalTrimmed(settings.privacyPolicyUrl),
  receiptCountries: settings.receiptCountries,
  registrationLimitCount: settings.registrationLimitCount ?? undefined,
  registrationLimitWindowDays:
    settings.registrationLimitWindowDays ?? undefined,
  seoDescription: optionalTrimmed(settings.seoDescription),
  seoTitle: optionalTrimmed(settings.seoTitle),
  stripeAccountManagement: settings.stripeAccountManagement,
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
