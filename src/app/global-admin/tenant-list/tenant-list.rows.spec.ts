import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { describe, expect, it } from 'vitest';

import {
  filterGlobalAdminTenants,
  globalAdminStripeAccountLabel,
  globalAdminTenantListErrorMessage,
  globalAdminTenantRows,
} from './tenant-list.rows';

const tenant = {
  currency: 'EUR',
  domain: 'tenant.example.com',
  id: 'tenant-1',
  name: 'Tenant',
  paymentsConfigured: true,
  theme: 'esn',
  timezone: 'Europe/Berlin',
} as const satisfies GlobalAdminTenantRecord;

describe('globalAdminTenantRows', () => {
  it('summarizes organization settings for platform review', () => {
    expect(globalAdminTenantRows(tenant)).toEqual([
      { label: 'Primary domain', value: 'tenant.example.com' },
      { label: 'Theme', value: 'esn' },
      { label: 'Currency', value: 'EUR' },
      { label: 'Timezone', value: 'Europe/Berlin' },
      { label: 'Payments', value: 'Paid sign-ups ready' },
    ]);
  });

  it('reuses the settings rows for organization detail review', () => {
    expect(globalAdminTenantRows(tenant).map((row) => row.label)).toEqual([
      'Primary domain',
      'Theme',
      'Currency',
      'Timezone',
      'Payments',
    ]);
  });

  it('shows a readable Stripe state when the tenant is not connected', () => {
    const rows = globalAdminTenantRows({
      ...tenant,
      currency: 'EUR',
      domain: 'tenant.example.com',
      id: 'tenant-1',
      name: 'Tenant',
      paymentsConfigured: false,
      theme: 'evorto',
    });

    expect(rows.at(-1)).toEqual({
      label: 'Payments',
      value: 'Paid sign-ups need attention',
    });
  });
});

describe('globalAdminStripeAccountLabel', () => {
  it('reports payment readiness without an account identifier', () => {
    expect(
      globalAdminStripeAccountLabel({
        paymentsConfigured: true,
      }),
    ).toBe('Paid sign-ups ready');
  });

  it('keeps an unconfigured payment state readable', () => {
    expect(
      globalAdminStripeAccountLabel({
        paymentsConfigured: true,
      }),
    ).toBe('Paid sign-ups ready');
    expect(
      globalAdminStripeAccountLabel({
        paymentsConfigured: false,
      }),
    ).toBe('Paid sign-ups need attention');
  });
});

describe('filterGlobalAdminTenants', () => {
  it('returns all tenants for blank searches', () => {
    expect(filterGlobalAdminTenants([tenant], ' '.repeat(3))).toEqual([tenant]);
  });

  it('matches tenant operational fields case-insensitively', () => {
    const secondTenant = {
      ...tenant,
      currency: 'AUD',
      domain: 'north.example.com',
      id: 'tenant-2',
      name: 'North',
      paymentsConfigured: false,
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
      filterGlobalAdminTenants([tenant, secondTenant], 'need attention'),
    ).toEqual([secondTenant]);
    expect(
      filterGlobalAdminTenants([tenant, secondTenant], 'acct_123'),
    ).toEqual([]);
  });
});

describe('globalAdminTenantListErrorMessage', () => {
  it('keeps tenant-list load failures readable', () => {
    expect(globalAdminTenantListErrorMessage(null)).toBe(
      'Failed to load organizations',
    );
    expect(
      globalAdminTenantListErrorMessage({
        _tag: 'RpcForbiddenError',
      }),
    ).toBe('Failed to load organizations');
    expect(
      globalAdminTenantListErrorMessage({
        message: 'Global admin permission is required',
      }),
    ).toBe('Failed to load organizations');
  });
});
