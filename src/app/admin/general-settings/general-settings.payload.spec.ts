import { describe, expect, it } from 'vitest';

import {
  GeneralSettingsModel,
  generalSettingsPayloadFromModel,
  requiresRuntimeSettingsReload,
} from './general-settings.payload';

const settingsModel: GeneralSettingsModel = {
  allowOther: true,
  buyEsnCardUrl: ' https://esncard.org/ ',
  cancellationDeadlineHoursBeforeStart: 72.8,
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
  emailSenderEmail: ' events@section.example.org ',
  emailSenderName: ' Example Section ',
  esnCardEnabled: true,
  faviconUrl: ' https://cdn.example.org/favicon.ico ',
  legalNoticeText: ' Tenant imprint text ',
  legalNoticeUrl: ' https://section.example.org/imprint ',
  logoUrl: ' https://cdn.example.org/logo.svg ',
  maxActiveRegistrationsPerUser: 4.8,
  receiptCountries: ['DE', 'NL'],
  refundFeesOnCancellation: false,
  seoDescription: ' Public tenant description ',
  seoTitle: ' Public tenant title ',
  stripeAccountId: ' acct_123 ',
  termsText: ' Tenant terms text ',
  termsUrl: ' https://section.example.org/terms ',
  theme: 'esn',
  timezone: 'Europe/Prague',
  transferDeadlineHoursBeforeStart: 12.9,
};

describe('generalSettingsPayloadFromModel', () => {
  it('trims editable tenant settings before sending the RPC payload', () => {
    expect(generalSettingsPayloadFromModel(settingsModel)).toEqual({
      allowOther: true,
      buyEsnCardUrl: 'https://esncard.org/',
      cancellationDeadlineHoursBeforeStart: 72,
      currency: 'CZK',
      defaultLocation: settingsModel.defaultLocation,
      emailSenderEmail: 'events@section.example.org',
      emailSenderName: 'Example Section',
      esnCardEnabled: true,
      faviconUrl: 'https://cdn.example.org/favicon.ico',
      legalNoticeText: 'Tenant imprint text',
      legalNoticeUrl: 'https://section.example.org/imprint',
      logoUrl: 'https://cdn.example.org/logo.svg',
      maxActiveRegistrationsPerUser: 4,
      receiptCountries: ['DE', 'NL'],
      refundFeesOnCancellation: false,
      seoDescription: 'Public tenant description',
      seoTitle: 'Public tenant title',
      stripeAccountId: 'acct_123',
      termsText: 'Tenant terms text',
      termsUrl: 'https://section.example.org/terms',
      theme: 'esn',
      timezone: 'Europe/Prague',
      transferDeadlineHoursBeforeStart: 12,
    });
  });

  it('normalizes blank optional editable fields to undefined', () => {
    expect(
      generalSettingsPayloadFromModel({
        ...settingsModel,
        buyEsnCardUrl: ' ',
        cancellationDeadlineHoursBeforeStart: -72,
        defaultLocation: null,
        emailSenderEmail: '',
        emailSenderName: '',
        faviconUrl: '',
        legalNoticeText: '',
        legalNoticeUrl: '',
        logoUrl: '',
        maxActiveRegistrationsPerUser: -3,
        seoDescription: '',
        seoTitle: '',
        stripeAccountId: '',
        termsText: '',
        termsUrl: '',
        transferDeadlineHoursBeforeStart: -12,
      }),
    ).toEqual({
      allowOther: true,
      buyEsnCardUrl: undefined,
      cancellationDeadlineHoursBeforeStart: 0,
      currency: 'CZK',
      defaultLocation: null,
      emailSenderEmail: undefined,
      emailSenderName: undefined,
      esnCardEnabled: true,
      faviconUrl: undefined,
      legalNoticeText: undefined,
      legalNoticeUrl: undefined,
      logoUrl: undefined,
      maxActiveRegistrationsPerUser: 0,
      receiptCountries: ['DE', 'NL'],
      refundFeesOnCancellation: false,
      seoDescription: undefined,
      seoTitle: undefined,
      stripeAccountId: undefined,
      termsText: undefined,
      termsUrl: undefined,
      theme: 'esn',
      timezone: 'Europe/Prague',
      transferDeadlineHoursBeforeStart: 0,
    });
  });
});

describe('requiresRuntimeSettingsReload', () => {
  const currentTenant = {
    currency: 'EUR' as const,
    timezone: 'Europe/Berlin' as const,
  };

  it('does not require a reload when currency and timezone stay the same', () => {
    expect(
      requiresRuntimeSettingsReload(currentTenant, {
        currency: 'EUR',
        timezone: 'Europe/Berlin',
      }),
    ).toBe(false);
  });

  it('requires a reload when currency or timezone changes', () => {
    expect(
      requiresRuntimeSettingsReload(currentTenant, {
        currency: 'CZK',
        timezone: 'Europe/Berlin',
      }),
    ).toBe(true);
    expect(
      requiresRuntimeSettingsReload(currentTenant, {
        currency: 'EUR',
        timezone: 'America/New_York',
      }),
    ).toBe(true);
  });
});
