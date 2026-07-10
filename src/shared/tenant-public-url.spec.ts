import { describe, expect, it } from 'vitest';

import {
  buildTenantOutboundUrl,
  defaultTenantCanonicalRootUrl,
  normalizeLocalRuntimeOrigin,
  normalizeTenantCanonicalRootUrl,
  normalizeTenantDomain,
  resolveTenantOutboundRootUrl,
} from './tenant-public-url';

describe('tenant public URL policy', () => {
  it('normalizes a primary domain and derives a secure canonical root', () => {
    expect(normalizeTenantDomain(' https://Section.Example.Org:443 ')).toBe(
      'section.example.org',
    );
    expect(defaultTenantCanonicalRootUrl('section.example.org')).toBe(
      'https://section.example.org',
    );
    expect(defaultTenantCanonicalRootUrl('localhost:4200')).toBe(
      'http://localhost',
    );
  });

  it('requires the canonical root host to exactly match the primary domain', () => {
    expect(
      normalizeTenantCanonicalRootUrl(
        'https://SECTION.EXAMPLE.ORG/',
        'section.example.org',
      ),
    ).toBe('https://section.example.org');

    expect(() =>
      normalizeTenantCanonicalRootUrl(
        'https://section.example.org.attacker.invalid',
        'section.example.org',
      ),
    ).toThrow('host must match');
    expect(() =>
      normalizeTenantCanonicalRootUrl(
        'https://section.example.org@attacker.invalid',
        'section.example.org',
      ),
    ).toThrow('must not contain credentials');
  });

  it('rejects unsafe schemes, production HTTP, ports, and non-root URLs', () => {
    expect(() =>
      normalizeTenantCanonicalRootUrl(
        'javascript:alert(1)',
        'section.example.org',
      ),
    ).toThrow('must use http or https');
    expect(() =>
      normalizeTenantCanonicalRootUrl(
        'http://section.example.org',
        'section.example.org',
      ),
    ).toThrow('must use https');
    expect(() =>
      normalizeTenantCanonicalRootUrl(
        'https://section.example.org:8443',
        'section.example.org',
      ),
    ).toThrow('must not contain a port');
    expect(() =>
      normalizeTenantCanonicalRootUrl(
        'https://section.example.org/app',
        'section.example.org',
      ),
    ).toThrow('without a path');
  });

  it('allows an explicit loopback runtime origin only outside production', () => {
    const tenant = {
      canonicalRootUrl: 'https://section.example.org',
      domain: 'section.example.org',
      localRuntimeOrigin: 'http://localhost:4200',
    };

    expect(
      resolveTenantOutboundRootUrl({
        ...tenant,
        nodeEnvironment: 'development',
      }),
    ).toBe('http://localhost:4200');
    expect(
      resolveTenantOutboundRootUrl({
        ...tenant,
        nodeEnvironment: 'production',
      }),
    ).toBe('https://section.example.org');
    expect(() =>
      normalizeLocalRuntimeOrigin('https://attacker.invalid'),
    ).toThrow('loopback host');
  });

  it('defaults to the tenant root when the runtime environment is not explicitly local', () => {
    const tenant = {
      canonicalRootUrl: 'https://section.example.org',
      domain: 'section.example.org',
      localRuntimeOrigin: 'https://evorto.fly.dev',
    };

    expect(resolveTenantOutboundRootUrl(tenant)).toBe(
      'https://section.example.org',
    );
    expect(
      resolveTenantOutboundRootUrl({
        ...tenant,
        nodeEnvironment: 'staging',
      }),
    ).toBe('https://section.example.org');
    expect(() =>
      resolveTenantOutboundRootUrl({
        ...tenant,
        nodeEnvironment: 'development',
      }),
    ).toThrow('loopback host');
  });

  it('builds encoded tenant paths without allowing an absolute URL override', () => {
    expect(
      buildTenantOutboundUrl({
        canonicalRootUrl: 'https://section.example.org',
        domain: 'section.example.org',
        nodeEnvironment: 'production',
        path: '/events/event%201?registrationStatus=success',
      }),
    ).toBe(
      'https://section.example.org/events/event%201?registrationStatus=success',
    );
    expect(() =>
      buildTenantOutboundUrl({
        canonicalRootUrl: 'https://section.example.org',
        domain: 'section.example.org',
        nodeEnvironment: 'production',
        path: 'https://attacker.invalid/phishing',
      }),
    ).toThrow('must stay on the tenant root URL');
  });
});
