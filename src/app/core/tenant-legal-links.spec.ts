import { describe, expect, it } from 'vitest';

import { tenantLegalLinks } from './tenant-legal-links';

describe('tenantLegalLinks', () => {
  it('returns configured tenant legal links in public footer order', () => {
    expect(
      tenantLegalLinks({
        legalNoticeUrl: 'https://section.example.org/imprint',
        privacyPolicyUrl: 'https://section.example.org/privacy',
        termsUrl: 'https://section.example.org/terms',
      }),
    ).toEqual([
      { href: 'https://section.example.org/imprint', label: 'Imprint' },
      { href: 'https://section.example.org/privacy', label: 'Privacy' },
      { href: 'https://section.example.org/terms', label: 'Terms' },
    ]);
  });

  it('omits missing or blank links', () => {
    expect(
      tenantLegalLinks({
        legalNoticeUrl: ' ',
        privacyPolicyUrl: 'https://section.example.org/privacy',
        termsUrl: null,
      }),
    ).toEqual([
      { href: 'https://section.example.org/privacy', label: 'Privacy' },
    ]);
  });

  it('returns no links before tenant config is available', () => {
    expect(tenantLegalLinks(null)).toEqual([]);
  });
});
