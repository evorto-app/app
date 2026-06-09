import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { describe, expect, it } from 'vitest';

import {
  filterGlobalAdminTenants,
  globalAdminTenantListErrorMessage,
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
} as const satisfies GlobalAdminTenantRecord;

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

  it('reuses the operational rows for tenant detail review', () => {
    expect(globalAdminTenantRows(tenant).map((row) => row.label)).toEqual([
      'Primary domain',
      'Tenant ID',
      'Theme',
      'Locale',
      'Currency',
      'Timezone',
      'Stripe account',
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
      currency: 'AUD',
      domain: 'north.example.com',
      id: 'tenant-2',
      locale: 'en-US',
      name: 'North',
      stripeConnected: false,
      theme: 'evorto',
      timezone: 'Australia/Brisbane',
    } as const satisfies GlobalAdminTenantRecord;

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

describe('globalAdminTenantListErrorMessage', () => {
  it('keeps tenant-list load failures readable', () => {
    expect(globalAdminTenantListErrorMessage(null)).toBe(
      'Failed to load tenants',
    );
    expect(
      globalAdminTenantListErrorMessage({
        _tag: 'RpcForbiddenError',
      }),
    ).toBe('Forbidden');
    expect(
      globalAdminTenantListErrorMessage({
        message: 'Global admin permission is required',
      }),
    ).toBe('Global admin permission is required');
  });
});
