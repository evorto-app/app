import { describe, expect, it } from 'vitest';

import {
  tenantLegalLinks,
  tenantLegalPageContent,
  tenantLegalPageTitle,
} from './tenant-legal-links';

describe('tenantLegalLinks', () => {
  it('returns configured tenant legal links in public footer order', () => {
    expect(
      tenantLegalLinks({
        legalNoticeUrl: 'https://section.example.org/imprint',
        privacyPolicyUrl: 'https://section.example.org/privacy',
        termsUrl: 'https://section.example.org/terms',
      }),
    ).toEqual([
      {
        external: true,
        href: 'https://section.example.org/imprint',
        label: 'Imprint',
      },
      {
        external: true,
        href: 'https://section.example.org/privacy',
        label: 'Privacy',
      },
      {
        external: true,
        href: 'https://section.example.org/terms',
        label: 'Terms',
      },
    ]);
  });

  it('uses hosted legal page routes when text is configured without an external URL', () => {
    expect(
      tenantLegalLinks({
        legalNoticeText: 'Imprint text',
        privacyPolicyText: 'Privacy text',
        termsText: 'Terms text',
      }),
    ).toEqual([
      { external: false, href: '/legal/imprint', label: 'Imprint' },
      { external: false, href: '/legal/privacy', label: 'Privacy' },
      { external: false, href: '/legal/terms', label: 'Terms' },
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
      {
        external: true,
        href: 'https://section.example.org/privacy',
        label: 'Privacy',
      },
    ]);
  });

  it('returns no links before tenant config is available', () => {
    expect(tenantLegalLinks(null)).toEqual([]);
  });
});

describe('tenantLegalPageContent', () => {
  it('returns trimmed hosted text for the requested legal page', () => {
    const tenant = {
      legalNoticeText: ' Imprint text ',
      privacyPolicyText: ' Privacy text ',
      termsText: ' Terms text ',
    };

    expect(tenantLegalPageContent(tenant, 'imprint')).toBe('Imprint text');
    expect(tenantLegalPageContent(tenant, 'privacy')).toBe('Privacy text');
    expect(tenantLegalPageContent(tenant, 'terms')).toBe('Terms text');
  });

  it('returns readable public page titles', () => {
    expect(tenantLegalPageTitle('imprint')).toBe('Imprint');
    expect(tenantLegalPageTitle('privacy')).toBe('Privacy policy');
    expect(tenantLegalPageTitle('terms')).toBe('Terms');
  });
});
