import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { AdminTenantUpdateSettingsInput } from './admin.rpcs';

const currentTenantSettingsInput = {
  allowOther: true,
  buyEsnCardUrl: 'https://esncard.org/',
  defaultLocation: null,
  esnCardEnabled: true,
  receiptCountries: ['DE', 'NL'],
  seoDescription: 'Public tenant description',
  seoTitle: 'Public tenant title',
  theme: 'esn' as const,
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

  it('keeps deferred branding, legal, and domain fields outside the current update payload', () => {
    const decoded = Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
      ...currentTenantSettingsInput,
      customDomain: 'section.example.org',
      faviconUrl: 'https://cdn.example.org/favicon.ico',
      legalNoticeUrl: 'https://section.example.org/imprint',
      logoUrl: 'https://cdn.example.org/logo.svg',
      privacyPolicyUrl: 'https://section.example.org/privacy',
      senderName: 'Example Section',
      termsUrl: 'https://section.example.org/terms',
    });

    expect(decoded).toEqual(currentTenantSettingsInput);
  });
});
