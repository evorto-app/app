import type { AdminTenantUpdateSettingsInput } from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

import type {
  SupportedTenantCurrency,
  SupportedTenantTimezone,
  Tenant,
} from '../../../types/custom/tenant';
import type { GoogleLocationType } from '../../../types/location';

export interface GeneralSettingsModel {
  allowOther: boolean;
  buyEsnCardUrl: string;
  cancellationDeadlineHoursBeforeStart: number;
  currency: SupportedTenantCurrency;
  defaultLocation: GoogleLocationType | null;
  emailSenderEmail: string;
  emailSenderName: string;
  esnCardEnabled: boolean;
  faviconUrl: string;
  legalNoticeText: string;
  legalNoticeUrl: string;
  logoUrl: string;
  maxActiveRegistrationsPerUser: number;
  privacyPolicyText: string;
  privacyPolicyUrl: string;
  receiptCountries: string[];
  refundFeesOnCancellation: boolean;
  seoDescription: string;
  seoTitle: string;
  stripeAccountId: string;
  termsText: string;
  termsUrl: string;
  theme: 'esn' | 'evorto';
  timezone: SupportedTenantTimezone;
  transferDeadlineHoursBeforeStart: number;
}

const optionalTrimmed = (value: string): string | undefined =>
  value.trim() || undefined;

const nonNegativeWholeHours = (value: number): number =>
  Math.max(0, Math.trunc(value));

export const generalSettingsPayloadFromModel = (
  settings: GeneralSettingsModel,
): AdminTenantUpdateSettingsInput => ({
  allowOther: settings.allowOther,
  buyEsnCardUrl: optionalTrimmed(settings.buyEsnCardUrl),
  cancellationDeadlineHoursBeforeStart: nonNegativeWholeHours(
    settings.cancellationDeadlineHoursBeforeStart,
  ),
  currency: settings.currency,
  defaultLocation: settings.defaultLocation,
  emailSenderEmail: optionalTrimmed(settings.emailSenderEmail),
  emailSenderName: optionalTrimmed(settings.emailSenderName),
  esnCardEnabled: settings.esnCardEnabled,
  faviconUrl: optionalTrimmed(settings.faviconUrl),
  legalNoticeText: optionalTrimmed(settings.legalNoticeText),
  legalNoticeUrl: optionalTrimmed(settings.legalNoticeUrl),
  logoUrl: optionalTrimmed(settings.logoUrl),
  maxActiveRegistrationsPerUser: nonNegativeWholeHours(
    settings.maxActiveRegistrationsPerUser,
  ),
  privacyPolicyText: optionalTrimmed(settings.privacyPolicyText),
  privacyPolicyUrl: optionalTrimmed(settings.privacyPolicyUrl),
  receiptCountries: settings.receiptCountries,
  refundFeesOnCancellation: settings.refundFeesOnCancellation,
  seoDescription: optionalTrimmed(settings.seoDescription),
  seoTitle: optionalTrimmed(settings.seoTitle),
  stripeAccountId: optionalTrimmed(settings.stripeAccountId),
  termsText: optionalTrimmed(settings.termsText),
  termsUrl: optionalTrimmed(settings.termsUrl),
  theme: settings.theme,
  timezone: settings.timezone,
  transferDeadlineHoursBeforeStart: nonNegativeWholeHours(
    settings.transferDeadlineHoursBeforeStart,
  ),
});

export const requiresRuntimeSettingsReload = (
  currentTenant: Pick<Tenant, 'currency' | 'timezone'>,
  settings: Pick<GeneralSettingsModel, 'currency' | 'timezone'>,
): boolean =>
  currentTenant.currency !== settings.currency ||
  currentTenant.timezone !== settings.timezone;
