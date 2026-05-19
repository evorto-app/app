import { describe, expect, it } from 'vitest';

import { globalAdminTenantRows } from './tenant-list.rows';

describe('globalAdminTenantRows', () => {
  it('summarizes tenant operational state for global admin review', () => {
    expect(
      globalAdminTenantRows({
        currency: 'EUR',
        domain: 'tenant.example.com',
        id: 'tenant-1',
        locale: 'en-GB',
        name: 'Tenant',
        stripeConnected: true,
        theme: 'esn',
        timezone: 'Europe/Berlin',
      }),
    ).toEqual([
      { label: 'Primary domain', value: 'tenant.example.com' },
      { label: 'Tenant ID', monospace: true, value: 'tenant-1' },
      { label: 'Theme', value: 'esn' },
      { label: 'Locale', value: 'en-GB' },
      { label: 'Currency', value: 'EUR' },
      { label: 'Timezone', value: 'Europe/Berlin' },
      { label: 'Stripe account', value: 'Connected' },
    ]);
  });

  it('shows a readable Stripe state when the tenant is not connected', () => {
    const rows = globalAdminTenantRows({
      currency: 'EUR',
      domain: 'tenant.example.com',
      id: 'tenant-1',
      locale: 'en-GB',
      name: 'Tenant',
      stripeConnected: false,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
    });

    expect(rows.at(-1)).toEqual({
      label: 'Stripe account',
      value: 'Not connected',
    });
  });
});
