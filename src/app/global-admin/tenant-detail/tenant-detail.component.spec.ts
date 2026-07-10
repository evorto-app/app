import { describe, expect, it } from 'vitest';

import { globalAdminTenantCanonicalRootUrl } from './tenant-detail.component';

describe('globalAdminTenantCanonicalRootUrl', () => {
  it('uses a validated canonical origin for tenant links', () => {
    expect(
      globalAdminTenantCanonicalRootUrl(
        ' https://Tenant.Example.Org ',
        'tenant.example.org',
      ),
    ).toBe('https://tenant.example.org');
  });

  it('fails closed for mismatched or malformed canonical origins', () => {
    expect(
      globalAdminTenantCanonicalRootUrl(
        'https://attacker.example',
        'tenant.example.org',
      ),
    ).toBeNull();
    expect(
      globalAdminTenantCanonicalRootUrl(
        'https://tenant.example.org/path',
        'tenant.example.org',
      ),
    ).toBeNull();
    expect(
      globalAdminTenantCanonicalRootUrl('', 'tenant.example.org'),
    ).toBeNull();
  });
});
