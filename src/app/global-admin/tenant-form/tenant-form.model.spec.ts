import { describe, expect, it } from 'vitest';

import {
  createGlobalAdminTenantFormModel,
  globalAdminTenantFormModelFromRecord,
  globalAdminTenantPayloadFromForm,
} from './tenant-form.model';

describe('global admin tenant form model', () => {
  it('starts new tenants with relaunch defaults', () => {
    expect(createGlobalAdminTenantFormModel()).toEqual({
      currency: 'EUR',
      domain: '',
      locale: 'en-GB',
      name: '',
      stripeAccountId: '',
      theme: 'evorto',
      timezone: 'Europe/Berlin',
    });
  });

  it('maps tenant records into editable form state without exposing derived values', () => {
    expect(
      globalAdminTenantFormModelFromRecord({
        currency: 'AUD',
        domain: 'tenant.example.com',
        id: 'tenant-1',
        locale: 'en-AU',
        name: 'Tenant',
        stripeAccountId: 'acct_123',
        stripeConnected: true,
        theme: 'esn',
        timezone: 'Australia/Brisbane',
      }),
    ).toEqual({
      currency: 'AUD',
      domain: 'tenant.example.com',
      locale: 'en-AU',
      name: 'Tenant',
      stripeAccountId: 'acct_123',
      theme: 'esn',
      timezone: 'Australia/Brisbane',
    });
  });

  it('trims tenant create/edit payloads and clears blank Stripe account IDs', () => {
    expect(
      globalAdminTenantPayloadFromForm({
        currency: 'CZK',
        domain: ' section.example.org ',
        locale: 'en-GB',
        name: ' Section ',
        stripeAccountId: ' ',
        theme: 'evorto',
        timezone: 'Europe/Prague',
      }),
    ).toEqual({
      currency: 'CZK',
      domain: 'section.example.org',
      locale: 'en-GB',
      name: 'Section',
      stripeAccountId: undefined,
      theme: 'evorto',
      timezone: 'Europe/Prague',
    });
  });
});
