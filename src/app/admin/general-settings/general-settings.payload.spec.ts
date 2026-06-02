import { describe, expect, it } from 'vitest';

import {
  GeneralSettingsModel,
  generalSettingsPayloadFromModel,
  requiresLocaleMoneyRuntimeReload,
} from './general-settings.payload';

const settingsModel: GeneralSettingsModel = {
  allowOther: true,
  buyEsnCardUrl: ' https://esncard.org/ ',
  currency: 'CZK',
  defaultLocation: {
    address: 'Amsterdam, Netherlands',
    coordinates: {
      lat: 52.3676,
      lng: 4.9041,
    },
    name: 'Amsterdam',
    placeId: 'place-amsterdam',
    type: 'google',
  },
  emailSenderName: ' Example Section ',
  esnCardEnabled: true,
  eventReviewPolicy: 'organizer_self_publish',
  faviconUrl: ' https://cdn.example.org/favicon.ico ',
  legalNoticeText: ' Tenant imprint text ',
  legalNoticeUrl: ' https://section.example.org/imprint ',
  locale: 'en-US',
  logoUrl: ' https://cdn.example.org/logo.svg ',
  privacyPolicyText: ' Tenant privacy text ',
  privacyPolicyUrl: ' https://section.example.org/privacy ',
  receiptCountries: ['DE', 'NL'],
  registrationLimitCount: 4,
  registrationLimitWindowDays: 30,
  seoDescription: ' Public tenant description ',
  seoTitle: ' Public tenant title ',
  stripeAccountManagement: 'tenant_admin_managed',
  termsText: ' Tenant terms text ',
  termsUrl: ' https://section.example.org/terms ',
  theme: 'esn',
  timezone: 'Europe/Prague',
};

describe('generalSettingsPayloadFromModel', () => {
  it('trims editable tenant settings before sending the RPC payload', () => {
    expect(generalSettingsPayloadFromModel(settingsModel)).toEqual({
      allowOther: true,
      buyEsnCardUrl: 'https://esncard.org/',
      currency: 'CZK',
      defaultLocation: settingsModel.defaultLocation,
      emailSenderName: 'Example Section',
      esnCardEnabled: true,
      eventReviewPolicy: 'organizer_self_publish',
      faviconUrl: 'https://cdn.example.org/favicon.ico',
      legalNoticeText: 'Tenant imprint text',
      legalNoticeUrl: 'https://section.example.org/imprint',
      locale: 'en-US',
      logoUrl: 'https://cdn.example.org/logo.svg',
      privacyPolicyText: 'Tenant privacy text',
      privacyPolicyUrl: 'https://section.example.org/privacy',
      receiptCountries: ['DE', 'NL'],
      registrationLimitCount: 4,
      registrationLimitWindowDays: 30,
      seoDescription: 'Public tenant description',
      seoTitle: 'Public tenant title',
      stripeAccountManagement: 'tenant_admin_managed',
      termsText: 'Tenant terms text',
      termsUrl: 'https://section.example.org/terms',
      theme: 'esn',
      timezone: 'Europe/Prague',
    });
  });

  it('normalizes blank optional editable fields to undefined', () => {
    expect(
      generalSettingsPayloadFromModel({
        ...settingsModel,
        buyEsnCardUrl: ' ',
        defaultLocation: null,
        emailSenderName: ' ',
        faviconUrl: '',
        legalNoticeText: '',
        legalNoticeUrl: '',
        logoUrl: '',
        privacyPolicyText: '',
        privacyPolicyUrl: '',
        registrationLimitCount: null,
        registrationLimitWindowDays: null,
        seoDescription: '',
        seoTitle: '',
        termsText: '',
        termsUrl: '',
      }),
    ).toEqual({
      allowOther: true,
      buyEsnCardUrl: undefined,
      currency: 'CZK',
      defaultLocation: null,
      emailSenderName: undefined,
      esnCardEnabled: true,
      eventReviewPolicy: 'organizer_self_publish',
      faviconUrl: undefined,
      legalNoticeText: undefined,
      legalNoticeUrl: undefined,
      locale: 'en-US',
      logoUrl: undefined,
      privacyPolicyText: undefined,
      privacyPolicyUrl: undefined,
      receiptCountries: ['DE', 'NL'],
      registrationLimitCount: undefined,
      registrationLimitWindowDays: undefined,
      seoDescription: undefined,
      seoTitle: undefined,
      stripeAccountManagement: 'tenant_admin_managed',
      termsText: undefined,
      termsUrl: undefined,
      theme: 'esn',
      timezone: 'Europe/Prague',
    });
  });
});

describe('requiresLocaleMoneyRuntimeReload', () => {
  const currentTenant = {
    currency: 'EUR' as const,
    locale: 'en-GB' as const,
    timezone: 'Europe/Berlin' as const,
  };

  it('does not require a reload when locale and money settings stay the same', () => {
    expect(
      requiresLocaleMoneyRuntimeReload(currentTenant, {
        currency: 'EUR',
        locale: 'en-GB',
        timezone: 'Europe/Berlin',
      }),
    ).toBe(false);
  });

  it('requires a reload when currency, locale, or timezone changes', () => {
    expect(
      requiresLocaleMoneyRuntimeReload(currentTenant, {
        currency: 'CZK',
        locale: 'en-GB',
        timezone: 'Europe/Berlin',
      }),
    ).toBe(true);
    expect(
      requiresLocaleMoneyRuntimeReload(currentTenant, {
        currency: 'EUR',
        locale: 'en-US',
        timezone: 'Europe/Berlin',
      }),
    ).toBe(true);
    expect(
      requiresLocaleMoneyRuntimeReload(currentTenant, {
        currency: 'EUR',
        locale: 'en-GB',
        timezone: 'Europe/Prague',
      }),
    ).toBe(true);
  });
});
