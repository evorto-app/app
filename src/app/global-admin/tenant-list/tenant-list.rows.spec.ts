import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { describe, expect, it } from 'vitest';

import {
  filterGlobalAdminTenants,
  globalAdminPaymentStatusLabel,
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
      { label: 'Website address', value: 'tenant.example.com' },
      { label: 'Theme', value: 'ESN theme' },
      { label: 'Currency', value: 'EUR' },
      { label: 'Time zone', value: 'Berlin time' },
      { label: 'Payments', value: 'Paid sign-ups ready' },
    ]);
  });

  it('reuses the settings rows for organization detail review', () => {
    expect(globalAdminTenantRows(tenant).map((row) => row.label)).toEqual([
      'Website address',
      'Theme',
      'Currency',
      'Time zone',
      'Payments',
    ]);
  });

  it('shows when paid sign-ups need attention', () => {
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

describe('globalAdminPaymentStatusLabel', () => {
  it('shows payment readiness without exposing provider details', () => {
    expect(
      globalAdminPaymentStatusLabel({
        paymentsConfigured: true,
      }),
    ).toBe('Paid sign-ups ready');
  });

  it('keeps unavailable paid sign-ups explicit', () => {
    expect(
      globalAdminPaymentStatusLabel({
        paymentsConfigured: true,
      }),
    ).toBe('Paid sign-ups ready');
    expect(
      globalAdminPaymentStatusLabel({
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
      filterGlobalAdminTenants(
        [tenant, secondTenant],
        'paid sign-ups need attention',
      ),
    ).toEqual([secondTenant]);
    expect(
      filterGlobalAdminTenants([tenant, secondTenant], 'acct_123'),
    ).toEqual([]);
  });
});
