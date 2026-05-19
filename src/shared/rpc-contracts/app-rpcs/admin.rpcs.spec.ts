import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { AdminTenantUpdateSettingsInput } from './admin.rpcs';

const currentTenantSettingsInput = {
  allowOther: true,
  buyEsnCardUrl: 'https://esncard.org/',
  currency: 'EUR' as const,
  defaultLocation: null,
  esnCardEnabled: true,
  faviconUrl: 'https://cdn.example.org/favicon.ico',
  legalNoticeUrl: 'https://section.example.org/imprint',
  locale: 'en-GB' as const,
  logoUrl: 'https://cdn.example.org/logo.svg',
  privacyPolicyUrl: 'https://section.example.org/privacy',
  receiptCountries: ['DE', 'NL'],
  seoDescription: 'Public tenant description',
  seoTitle: 'Public tenant title',
  termsUrl: 'https://section.example.org/terms',
  theme: 'esn' as const,
  timezone: 'Europe/Berlin' as const,
};

describe('AdminTenantUpdateSettingsInput', () => {
  it('accepts the current tenant general-settings surface', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)(
        currentTenantSettingsInput,
      ),
    ).not.toThrow();
  });

  it('rejects unsupported themes', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        theme: 'custom',
      }),
    ).toThrow();
  });

  it('rejects unsupported locale and money settings', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        currency: 'USD',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        locale: 'de-DE',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        timezone: 'America/New_York',
      }),
    ).toThrow();
  });

  it('keeps deferred domain and upload fields outside the current update payload', () => {
    const decoded = Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
      ...currentTenantSettingsInput,
      customDomain: 'section.example.org',
      logoUpload: 'logo.svg',
      senderName: 'Example Section',
    });

    expect(decoded).toEqual(currentTenantSettingsInput);
  });
});
