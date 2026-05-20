import { describe, expect, it } from 'vitest';

import { globalAdminTenantDomainUrl } from './tenant-detail.component';

describe('globalAdminTenantDomainUrl', () => {
  it('builds tenant-domain links from single host names', () => {
    expect(globalAdminTenantDomainUrl(' Tenant.Example.Org ')).toBe(
      'https://tenant.example.org',
    );
    expect(globalAdminTenantDomainUrl('localhost')).toBe('https://localhost');
  });

  it('fails closed for URL-shaped or malformed tenant domains', () => {
    expect(globalAdminTenantDomainUrl('https://tenant.example.org')).toBeNull();
    expect(globalAdminTenantDomainUrl('tenant.example.org/path')).toBeNull();
    expect(
      globalAdminTenantDomainUrl('tenant.example.org?next=/admin'),
    ).toBeNull();
    expect(globalAdminTenantDomainUrl('tenant.example.org#admin')).toBeNull();
    expect(globalAdminTenantDomainUrl('user@tenant.example.org')).toBeNull();
    expect(globalAdminTenantDomainUrl('')).toBeNull();
  });
});
