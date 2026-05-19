import { describe, expect, it } from 'vitest';

import {
  GeneralSettingsModel,
  generalSettingsPayloadFromModel,
} from './general-settings.payload';

const settingsModel: GeneralSettingsModel = {
  allowOther: true,
  buyEsnCardUrl: ' https://esncard.org/ ',
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
  esnCardEnabled: true,
  faviconUrl: ' https://cdn.example.org/favicon.ico ',
  legalNoticeUrl: ' https://section.example.org/imprint ',
  logoUrl: ' https://cdn.example.org/logo.svg ',
  privacyPolicyUrl: ' https://section.example.org/privacy ',
  receiptCountries: ['DE', 'NL'],
  seoDescription: ' Public tenant description ',
  seoTitle: ' Public tenant title ',
  termsUrl: ' https://section.example.org/terms ',
  theme: 'esn',
};

describe('generalSettingsPayloadFromModel', () => {
  it('trims editable tenant settings before sending the RPC payload', () => {
    expect(generalSettingsPayloadFromModel(settingsModel)).toEqual({
      allowOther: true,
      buyEsnCardUrl: 'https://esncard.org/',
      defaultLocation: settingsModel.defaultLocation,
      esnCardEnabled: true,
      faviconUrl: 'https://cdn.example.org/favicon.ico',
      legalNoticeUrl: 'https://section.example.org/imprint',
      logoUrl: 'https://cdn.example.org/logo.svg',
      privacyPolicyUrl: 'https://section.example.org/privacy',
      receiptCountries: ['DE', 'NL'],
      seoDescription: 'Public tenant description',
      seoTitle: 'Public tenant title',
      termsUrl: 'https://section.example.org/terms',
      theme: 'esn',
    });
  });

  it('normalizes blank optional editable fields to undefined', () => {
    expect(
      generalSettingsPayloadFromModel({
        ...settingsModel,
        buyEsnCardUrl: ' ',
        defaultLocation: null,
        faviconUrl: '',
        legalNoticeUrl: '',
        logoUrl: '',
        privacyPolicyUrl: '',
        seoDescription: '',
        seoTitle: '',
        termsUrl: '',
      }),
    ).toEqual({
      allowOther: true,
      buyEsnCardUrl: undefined,
      defaultLocation: null,
      esnCardEnabled: true,
      faviconUrl: undefined,
      legalNoticeUrl: undefined,
      logoUrl: undefined,
      privacyPolicyUrl: undefined,
      receiptCountries: ['DE', 'NL'],
      seoDescription: undefined,
      seoTitle: undefined,
      termsUrl: undefined,
      theme: 'esn',
    });
  });
});
