import { describe, expect, it } from 'vitest';

import { tenantIdentityRows } from './general-settings.identity';

describe('tenantIdentityRows', () => {
  it('summarizes the read-only organization identity', () => {
    expect(
      tenantIdentityRows({
        domain: 'tenant.example.com',
        name: 'Example Tenant',
      }),
    ).toEqual([
      { label: 'Organization name', value: 'Example Tenant' },
      { label: 'Public domain', value: 'tenant.example.com' },
    ]);
  });
});
