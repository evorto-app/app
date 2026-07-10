import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { describe, expect, it } from 'vitest';

import {
  filterGlobalAdminTenants,
  globalAdminStripeAccountLabel,
  globalAdminTenantListErrorMessage,
  globalAdminTenantRows,
} from './tenant-list.rows';

const tenant = {
  canonicalRootUrl: 'https://tenant.example.com',
  currency: 'EUR',
  domain: 'tenant.example.com',
  id: 'tenant-1',
  locale: 'de-DE',
  name: 'Tenant',
  stripeAccountId: 'acct_123',
  stripeConnected: true,
  theme: 'esn',
  timezone: 'Europe/Berlin',
} as const satisfies GlobalAdminTenantRecord;

describe('globalAdminTenantRows', () => {
  it('summarizes tenant operational state for global admin review', () => {
    expect(globalAdminTenantRows(tenant)).toEqual([
      { label: 'Primary domain', value: 'tenant.example.com' },
      {
        label: 'Canonical root URL',
        value: 'https://tenant.example.com',
      },
      { label: 'Tenant ID', monospace: true, value: 'tenant-1' },
      { label: 'Theme', value: 'esn' },
      { label: 'Locale', value: 'de-DE' },
      { label: 'Currency', value: 'EUR' },
      { label: 'Timezone', value: 'Europe/Berlin' },
      { label: 'Stripe account', value: 'Connected (acct_123)' },
    ]);
  });

  it('reuses the operational rows for tenant detail review', () => {
    expect(globalAdminTenantRows(tenant).map((row) => row.label)).toEqual([
      'Primary domain',
      'Canonical root URL',
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
      locale: 'de-DE',
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

describe('globalAdminStripeAccountLabel', () => {
  it('includes the connected account id when available for support lookup', () => {
    expect(
      globalAdminStripeAccountLabel({
        stripeAccountId: 'acct_123',
        stripeConnected: true,
      }),
    ).toBe('Connected (acct_123)');
  });

  it('keeps connection state readable when the id is absent', () => {
    expect(
      globalAdminStripeAccountLabel({
        stripeAccountId: null,
        stripeConnected: true,
      }),
    ).toBe('Connected');
    expect(
      globalAdminStripeAccountLabel({
        stripeAccountId: 'acct_123',
        stripeConnected: false,
      }),
    ).toBe('Not connected');
  });
});

describe('filterGlobalAdminTenants', () => {
  it('returns all tenants for blank searches', () => {
    expect(filterGlobalAdminTenants([tenant], ' '.repeat(3))).toEqual([tenant]);
  });

  it('matches tenant operational fields case-insensitively', () => {
    const secondTenant = {
      ...tenant,
      canonicalRootUrl: 'https://north.example.com',
      currency: 'AUD',
      domain: 'north.example.com',
      id: 'tenant-2',
      locale: 'de-DE',
      name: 'North',
      stripeAccountId: null,
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
    expect(
      filterGlobalAdminTenants([tenant, secondTenant], 'acct_123'),
    ).toEqual([tenant]);
    expect(
      filterGlobalAdminTenants(
        [tenant, secondTenant],
        'https://tenant.example.com',
      ),
    ).toEqual([tenant]);
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
