import { describe, expect, it } from 'vitest';

import {
  buildTenantPublicUrl,
  deriveTenantPublicOrigin,
  normalizeTenantDomain,
  resolveTenantPublicOrigin,
} from './tenant-origin';

describe('tenant origin', () => {
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
    'https://section.example.org?next=/events',
    'https://section.example.org#events',
    'https://section.example.org?',
    'https://section.example.org#',
    'https://@section.example.org',
    'https://section.example.org.',
  ])('rejects unsafe primary domains: %s', (primaryDomain) => {
    expect(() => deriveTenantPublicOrigin(primaryDomain)).toThrow(
      'Domain must be a single host name',
    );
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
    ).toThrow('Domain must be a single host name');
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
