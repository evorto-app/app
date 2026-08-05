import { describe, expect, it } from 'vitest';

import { tenantIdentityRows } from './organization-settings.identity';

describe('tenantIdentityRows', () => {
  it('summarizes the read-only organization identity', () => {
    expect(
      tenantIdentityRows({
        domain: 'tenant.example.com',
        name: 'Example Tenant',
      }),
    ).toEqual([
      { label: 'Organization name', value: 'Example Tenant' },
      { label: 'Website address', value: 'tenant.example.com' },
    ]);
  });
});
