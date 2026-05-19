import type { AdminTenantUpdateSettingsInput } from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

import type { GoogleLocationType } from '../../../types/location';

export interface GeneralSettingsModel {
  allowOther: boolean;
  buyEsnCardUrl: string;
  defaultLocation: GoogleLocationType | null;
  esnCardEnabled: boolean;
  faviconUrl: string;
  legalNoticeUrl: string;
  logoUrl: string;
  privacyPolicyUrl: string;
  receiptCountries: string[];
  seoDescription: string;
  seoTitle: string;
  termsUrl: string;
  theme: 'esn' | 'evorto';
}

const optionalTrimmed = (value: string): string | undefined =>
  value.trim() || undefined;

export const generalSettingsPayloadFromModel = (
  settings: GeneralSettingsModel,
): AdminTenantUpdateSettingsInput => ({
  allowOther: settings.allowOther,
  buyEsnCardUrl: optionalTrimmed(settings.buyEsnCardUrl),
  defaultLocation: settings.defaultLocation,
  esnCardEnabled: settings.esnCardEnabled,
  faviconUrl: optionalTrimmed(settings.faviconUrl),
  legalNoticeUrl: optionalTrimmed(settings.legalNoticeUrl),
  logoUrl: optionalTrimmed(settings.logoUrl),
  privacyPolicyUrl: optionalTrimmed(settings.privacyPolicyUrl),
  receiptCountries: settings.receiptCountries,
  seoDescription: optionalTrimmed(settings.seoDescription),
  seoTitle: optionalTrimmed(settings.seoTitle),
  termsUrl: optionalTrimmed(settings.termsUrl),
  theme: settings.theme,
});
