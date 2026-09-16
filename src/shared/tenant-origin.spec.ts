import { describe, expect, it } from 'vitest';

import {
  buildTenantPublicUrl,
  deriveTenantPublicOrigin,
  normalizeTenantDomain,
  resolveTenantPublicOrigin,
  TenantDomainValidationError,
} from './tenant-origin';

describe('tenant origin', () => {
  it.each([
    'section.example.org',
    'section.example.org/',
    'section.example.org:443',
    'https://section.example.org:443/',
    'https://section.example.org/',
    'http://section.example.org:80/',
  ])('accepts a domain with an optional root slash: %s', (value) => {
    expect(normalizeTenantDomain(value)).toBe('section.example.org');
  });

  it.each([
    'http:443',
    'https:443',
    ' HTTP:443/ ',
    'https:0443',
    'http:/section.example.org',
    'https:///section.example.org',
  ])('rejects malformed HTTP scheme prefixes: %s', (value) => {
    expect(() => normalizeTenantDomain(value)).toThrow(
      TenantDomainValidationError,
    );
    expect(() => deriveTenantPublicOrigin(value)).toThrow(
      TenantDomainValidationError,
    );
  });

  it.each(['[::1]', '[::1]:443', 'http://[::1]:80/', 'https://[::1]:443/'])(
    'preserves bracketed IPv6 primary-domain syntax: %s',
    (value) => {
      expect(normalizeTenantDomain(value)).toBe('[::1]');
      expect(deriveTenantPublicOrigin(value)).toBe('https://[::1]');
    },
  );

  it.each([
    'section.example.org:',
    'section.example.org:/',
    'https://section.example.org:',
    'https://section.example.org:/',
    'http://localhost:',
    'http://localhost:/',
    'https://127.0.0.1:',
    'https://127.0.0.1:/',
    'https://[::1]:',
    'https://[::1]:/',
  ])(
    'rejects an empty primary-domain port before normalization: %s',
    (value) => {
      expect(() => normalizeTenantDomain(value)).toThrow(
        TenantDomainValidationError,
      );
      expect(() => deriveTenantPublicOrigin(value)).toThrow(
        TenantDomainValidationError,
      );
    },
  );

  it('normalizes primary domains and derives HTTPS public origins', () => {
    expect(normalizeTenantDomain(' HTTPS://Section.Example.Org:443 ')).toBe(
      'section.example.org',
    );
    expect(deriveTenantPublicOrigin(' HTTPS://Section.Example.Org:443 ')).toBe(
      'https://section.example.org',
    );
  });

  it.each([
    'https://section.example.org:8443',
    'https://user@section.example.org',
    'https://section.example.org/events',
    'https://section.example.org/.',
    'https://section.example.org/..',
    'https://section.example.org/events/..',
    'section.example.org/%2e%2e',
    'https://section.example.org/%2e/',
    'https://section.example.org\\',
    String.raw`https://section.example.org\events\..`,
    'https://section.\texample.org',
    'https://section.example.org?next=/events',
    'https://section.example.org#events',
    'https://section.example.org?',
    'https://section.example.org#',
    'https://@section.example.org',
    'https://section.example.org.',
    'not a website address',
    'https://%',
  ])('rejects unsafe primary domains: %s', (primaryDomain) => {
    expect(() => deriveTenantPublicOrigin(primaryDomain)).toThrow(
      'Enter the main website address only, for example section.example.org.',
    );
  });

  it('rejects trailing-dot primary domains', () => {
    expect(() => normalizeTenantDomain('section.example.org.')).toThrow(
      'Enter the main website address only, for example section.example.org.',
    );
    expect(() => normalizeTenantDomain('ftp://section.example.org')).toThrow(
      'Enter the main website address only, for example section.example.org.',
    );
  });

  it('uses a loopback BASE_URL only in development and test', () => {
    const input = {
      baseUrl: 'http://localhost:4200',
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

  it('ignores non-loopback BASE_URL values and validates the domain first', () => {
    expect(
      resolveTenantPublicOrigin({
        baseUrl: 'https://attacker.example',
        nodeEnvironment: 'development',
        primaryDomain: 'section.example.org',
      }),
    ).toBe('https://section.example.org');

    expect(() =>
      resolveTenantPublicOrigin({
        baseUrl: 'http://localhost:4200',
        nodeEnvironment: 'development',
        primaryDomain: 'section.example.org/path',
      }),
    ).toThrow(
      'Enter the main website address only, for example section.example.org.',
    );
  });

  it.each([
    'http://localhost:',
    'http://localhost:/',
    'https://127.0.0.1:',
    'https://127.0.0.1:/',
    'http://[::1]:',
    'http://[::1]:/',
    'http://localhost:4200/..',
    'http://localhost:4200/events/..',
    'http://localhost:4200/%2e%2e',
    'http://localhost:4200\\',
    'http:localhost:4200',
    'http://local\thost:4200',
  ])(
    'ignores development origins with normalized-away syntax: %s',
    (baseUrl) => {
      expect(
        resolveTenantPublicOrigin({
          baseUrl,
          nodeEnvironment: 'development',
          primaryDomain: 'section.example.org',
        }),
      ).toBe('https://section.example.org');
    },
  );

  it.each([
    ['http://[::1]:4200/', 'http://[::1]:4200'],
    ['http://localhost:80/', 'http://localhost'],
    ['https://127.0.0.1:443/', 'https://127.0.0.1'],
    ['https://[::1]:443/', 'https://[::1]'],
    ['https://localhost:8443/', 'https://localhost:8443'],
  ])('preserves valid loopback origin and port %s', (baseUrl, expected) => {
    expect(
      resolveTenantPublicOrigin({
        baseUrl,
        nodeEnvironment: 'test',
        primaryDomain: 'section.example.org',
      }),
    ).toBe(expected);
  });

  it('builds a tenant path without allowing an absolute-origin override', () => {
    expect(
      buildTenantPublicUrl({
        baseUrl: 'https://caller-controlled.invalid',
        nodeEnvironment: 'production',
        path: '/events/event%201?registrationStatus=success',
        primaryDomain: 'section.example.org',
      }),
    ).toBe(
      'https://section.example.org/events/event%201?registrationStatus=success',
    );

    expect(() =>
      buildTenantPublicUrl({
        baseUrl: undefined,
        nodeEnvironment: 'production',
        path: 'https://attacker.invalid/phishing',
        primaryDomain: 'section.example.org',
      }),
    ).toThrow('must stay on the tenant origin');
  });
});
