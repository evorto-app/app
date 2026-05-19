import { describe, expect, it } from 'vitest';

import {
  filterGlobalAdminTenants,
  globalAdminTenantRows,
} from './tenant-list.rows';

const tenant = {
  currency: 'EUR',
  domain: 'tenant.example.com',
  id: 'tenant-1',
  locale: 'en-GB',
  name: 'Tenant',
  stripeConnected: true,
  theme: 'esn',
  timezone: 'Europe/Berlin',
};

describe('globalAdminTenantRows', () => {
  it('summarizes tenant operational state for global admin review', () => {
    expect(globalAdminTenantRows(tenant)).toEqual([
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
      ...tenant,
      currency: 'EUR',
      domain: 'tenant.example.com',
      id: 'tenant-1',
      locale: 'en-GB',
      name: 'Tenant',
      stripeConnected: false,
      theme: 'evorto',
    });

    expect(rows.at(-1)).toEqual({
      label: 'Stripe account',
      value: 'Not connected',
    });
  });
});

describe('filterGlobalAdminTenants', () => {
  it('returns all tenants for blank searches', () => {
    expect(filterGlobalAdminTenants([tenant], '   ')).toEqual([tenant]);
  });

  it('matches tenant operational fields case-insensitively', () => {
    const secondTenant = {
      ...tenant,
      currency: 'USD',
      domain: 'north.example.com',
      id: 'tenant-2',
      locale: 'en-US',
      name: 'North',
      stripeConnected: false,
      theme: 'default',
      timezone: 'America/New_York',
    };

    expect(filterGlobalAdminTenants([tenant, secondTenant], 'north')).toEqual([
      secondTenant,
    ]);
    expect(filterGlobalAdminTenants([tenant, secondTenant], 'BERLIN')).toEqual([
      tenant,
    ]);
    expect(
      filterGlobalAdminTenants([tenant, secondTenant], 'not connected'),
    ).toEqual([secondTenant]);
  });
});
