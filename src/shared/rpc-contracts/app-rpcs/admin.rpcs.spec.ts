import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  AdminTenantBrandAssetKind,
  AdminTenantUpdateSettingsInput,
} from './admin.rpcs';

const currentTenantSettingsInput = {
  allowOther: true,
  buyEsnCardUrl: 'https://esncard.org/',
  currency: 'EUR' as const,
  defaultLocation: null,
  emailSenderName: 'Example Section',
  esnCardEnabled: true,
  eventReviewPolicy: 'review_required' as const,
  faviconUrl: 'https://cdn.example.org/favicon.ico',
  legalNoticeText: 'Tenant imprint text',
  legalNoticeUrl: 'https://section.example.org/imprint',
  locale: 'en-GB' as const,
  logoUrl: 'https://cdn.example.org/logo.svg',
  privacyPolicyText: 'Tenant privacy text',
  privacyPolicyUrl: 'https://section.example.org/privacy',
  receiptCountries: ['DE', 'NL'],
  registrationLimitCount: 4,
  registrationLimitWindowDays: 30,
  seoDescription: 'Public tenant description',
  seoTitle: 'Public tenant title',
  stripeAccountManagement: 'platform_managed' as const,
  termsText: 'Tenant terms text',
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

  it('keeps deferred domain fields outside the current update payload', () => {
    const decoded = Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
      ...currentTenantSettingsInput,
      customDomain: 'section.example.org',
      stripeAccountId: 'acct_123',
    });

    expect(decoded).toEqual(currentTenantSettingsInput);
  });

  it('accepts uploaded tenant brand asset paths', () => {
    const decoded = Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
      ...currentTenantSettingsInput,
      faviconUrl: '/tenant-assets/tenant-1/favicon/favicon.ico',
      logoUrl: '/tenant-assets/tenant-1/logo/logo.svg',
    });

    expect(decoded.faviconUrl).toBe(
      '/tenant-assets/tenant-1/favicon/favicon.ico',
    );
    expect(decoded.logoUrl).toBe('/tenant-assets/tenant-1/logo/logo.svg');
  });

  it('keeps non-brand tenant URLs absolute', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        termsUrl: '/tenant-assets/tenant-1/terms.pdf',
      }),
    ).toThrow();
  });

  it('rejects unsupported tenant policy values', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        eventReviewPolicy: 'manual',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        stripeAccountManagement: 'unknown',
      }),
    ).toThrow();
  });

  it('rejects invalid registration limit policy values', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        registrationLimitCount: -1,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        registrationLimitWindowDays: 0,
      }),
    ).toThrow();
  });
});

describe('AdminTenantBrandAssetKind', () => {
  it('accepts the supported tenant branding upload targets', () => {
    expect(Schema.decodeUnknownSync(AdminTenantBrandAssetKind)('logo')).toBe(
      'logo',
    );
    expect(Schema.decodeUnknownSync(AdminTenantBrandAssetKind)('favicon')).toBe(
      'favicon',
    );
  });

  it('rejects unsupported tenant branding upload targets', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantBrandAssetKind)('hero'),
    ).toThrow();
  });
});
