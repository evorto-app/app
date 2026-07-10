import { describe, expect, it } from 'vitest';

import {
  normalizeTenantCanonicalRootUrl,
  normalizeTenantDomain,
  resolveTenantPublicOrigin,
} from './tenant-origin';

describe('tenant origin', () => {
  it('normalizes primary domains and matching HTTPS canonical origins', () => {
    expect(normalizeTenantDomain(' HTTPS://Section.Example.Org:443 ')).toBe(
      'section.example.org',
    );
    expect(
      normalizeTenantCanonicalRootUrl(
        ' https://Section.Example.Org:443 ',
        'section.example.org',
      ),
    ).toBe('https://section.example.org');
  });

  it.each([
    'http://section.example.org',
    'https://other.example.org',
    'https://section.example.org:8443',
    'https://user@section.example.org',
    'https://section.example.org/events',
    'https://section.example.org?next=/events',
    'https://section.example.org#events',
    'https://section.example.org?',
    'https://section.example.org#',
    'https://@section.example.org',
    'https://section.example.org.',
  ])('rejects unsafe canonical roots: %s', (canonicalRootUrl) => {
    expect(() =>
      normalizeTenantCanonicalRootUrl(canonicalRootUrl, 'section.example.org'),
    ).toThrow();
  });

  it('rejects trailing-dot primary domains', () => {
    expect(() => normalizeTenantDomain('section.example.org.')).toThrow(
      'Domain must be a single host name',
    );
    expect(() => normalizeTenantDomain('ftp://section.example.org')).toThrow(
      'Domain must be a single host name',
    );
  });

  it('uses a loopback BASE_URL only in development and test', () => {
    const input = {
      baseUrl: 'http://localhost:4200',
      canonicalRootUrl: 'https://section.example.org',
      primaryDomain: 'section.example.org',
    } as const;

    expect(
      resolveTenantPublicOrigin({ ...input, nodeEnvironment: 'development' }),
    ).toBe('http://localhost:4200');
    expect(
      resolveTenantPublicOrigin({ ...input, nodeEnvironment: 'test' }),
    ).toBe('http://localhost:4200');
    expect(
      resolveTenantPublicOrigin({ ...input, nodeEnvironment: 'production' }),
    ).toBe('https://section.example.org');
  });

  it('ignores non-loopback BASE_URL values and validates canonical config first', () => {
    expect(
      resolveTenantPublicOrigin({
        baseUrl: 'https://attacker.example',
        canonicalRootUrl: 'https://section.example.org',
        nodeEnvironment: 'development',
        primaryDomain: 'section.example.org',
      }),
    ).toBe('https://section.example.org');

    expect(() =>
      resolveTenantPublicOrigin({
        baseUrl: 'http://localhost:4200',
        canonicalRootUrl: 'https://attacker.example',
        nodeEnvironment: 'development',
        primaryDomain: 'section.example.org',
      }),
    ).toThrow('Canonical root URL must match the primary domain');
  });
});
