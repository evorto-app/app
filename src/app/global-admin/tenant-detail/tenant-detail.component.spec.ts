import { describe, expect, it } from 'vitest';

import { globalAdminTenantPublicOrigin } from './tenant-detail.component';

describe('globalAdminTenantPublicOrigin', () => {
  it('derives a secure public origin from the normalized primary domain', () => {
    expect(
      globalAdminTenantPublicOrigin(' HTTPS://Tenant.Example.Org:443 '),
    ).toBe('https://tenant.example.org');
  });

  it('fails closed for malformed primary domains', () => {
    expect(globalAdminTenantPublicOrigin('tenant.example.org/path')).toBeNull();
    expect(globalAdminTenantPublicOrigin('tenant.example.org:8443')).toBeNull();
    expect(globalAdminTenantPublicOrigin('')).toBeNull();
  });

  it('opens the current organization at its existing origin, including local development', () => {
    expect(globalAdminTenantPublicOrigin('localhost', 'localhost')).toBe('/');
    expect(
      globalAdminTenantPublicOrigin('tenant.example.org', 'tenant.example.org'),
    ).toBe('/');
    expect(
      globalAdminTenantPublicOrigin('other.example.org', 'tenant.example.org'),
    ).toBe('https://other.example.org');
  });

  it('does not render an unusable HTTPS link for loopback tenants', () => {
    expect(globalAdminTenantPublicOrigin('localhost')).toBeNull();
    expect(globalAdminTenantPublicOrigin('127.0.0.1')).toBeNull();
    expect(globalAdminTenantPublicOrigin('[::1]')).toBeNull();
  });
});
