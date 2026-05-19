import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { AdminTenantUpdateSettingsInput } from './admin.rpcs';

const currentTenantSettingsInput = {
  allowOther: true,
  buyEsnCardUrl: 'https://esncard.org/',
  defaultLocation: null,
  esnCardEnabled: true,
  legalNoticeUrl: 'https://section.example.org/imprint',
  privacyPolicyUrl: 'https://section.example.org/privacy',
  receiptCountries: ['DE', 'NL'],
  seoDescription: 'Public tenant description',
  seoTitle: 'Public tenant title',
  termsUrl: 'https://section.example.org/terms',
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

  it('keeps deferred branding and domain fields outside the current update payload', () => {
    const decoded = Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
      ...currentTenantSettingsInput,
      customDomain: 'section.example.org',
      faviconUrl: 'https://cdn.example.org/favicon.ico',
      logoUrl: 'https://cdn.example.org/logo.svg',
      senderName: 'Example Section',
    });

    expect(decoded).toEqual(currentTenantSettingsInput);
  });
});
