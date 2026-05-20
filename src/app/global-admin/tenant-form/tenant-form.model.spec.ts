import { describe, expect, it } from 'vitest';

import {
  createGlobalAdminTenantFormModel,
  globalAdminTenantFormModelFromRecord,
  globalAdminTenantPayloadFromForm,
  globalAdminTenantRelaunchScopeItems,
  globalAdminTenantSubmitDisabled,
  normalizeGlobalAdminTenantDomain,
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

  it('keeps the visible relaunch scope aligned with the one-domain tenant workflow', () => {
    expect(globalAdminTenantRelaunchScopeItems).toEqual([
      'One active primary domain is managed here.',
      'Custom-domain verification and multi-domain automation are deferred.',
      'Tenant-admin impersonation is not available from this form.',
    ]);
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

  it('normalizes the one-primary-domain relaunch input shape', () => {
    expect(
      normalizeGlobalAdminTenantDomain(' https://Section.Example.Org:443 '),
    ).toBe('section.example.org');
    expect(normalizeGlobalAdminTenantDomain(' LOCALHOST:4200 ')).toBe(
      'localhost',
    );
  });

  it('rejects domain paths before submitting tenant create/edit payloads', () => {
    expect(() =>
      globalAdminTenantPayloadFromForm({
        currency: 'EUR',
        domain: 'section.example.org/path',
        locale: 'en-GB',
        name: 'Section',
        stripeAccountId: '',
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      }),
    ).toThrow('Domain must be a single host name');
  });

  it('keeps tenant writes disabled while invalid, submitting, or awaiting the mutation', () => {
    expect(
      globalAdminTenantSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      globalAdminTenantSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      globalAdminTenantSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      globalAdminTenantSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});
