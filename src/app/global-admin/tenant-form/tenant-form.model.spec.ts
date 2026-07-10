import { describe, expect, it } from 'vitest';

import {
  createGlobalAdminTenantFormModel,
  globalAdminTenantCanonicalRootUrlError,
  globalAdminTenantFormModelFromRecord,
  globalAdminTenantPayloadFromForm,
  globalAdminTenantRelaunchScopeItems,
  globalAdminTenantSubmitDisabled,
  globalAdminTenantUpdateErrorMessage,
  normalizeGlobalAdminTenantDomain,
} from './tenant-form.model';

describe('global admin tenant form model', () => {
  it('starts new tenants with relaunch defaults', () => {
    expect(createGlobalAdminTenantFormModel()).toEqual({
      canonicalRootUrl: '',
      currency: 'EUR',
      domain: '',
      name: '',
      reason: '',
      stripeAccountId: '',
      theme: 'evorto',
      timezone: 'Europe/Berlin',
    });
  });

  it('keeps the visible relaunch scope aligned with the one-domain tenant workflow', () => {
    expect(globalAdminTenantRelaunchScopeItems).toEqual([
      'One active primary domain is managed here; its secure HTTPS origin is derived from the normalized host.',
      'Custom-domain verification and multi-domain automation are deferred.',
      'Tenant-admin impersonation is not available in the current relaunch surface.',
    ]);
  });

  it('maps tenant records into editable form state without exposing derived values', () => {
    expect(
      globalAdminTenantFormModelFromRecord({
        canonicalRootUrl: 'https://tenant.example.com',
        currency: 'AUD',
        domain: 'tenant.example.com',
        id: 'tenant-1',
        locale: 'de-DE',
        name: 'Tenant',
        stripeAccountId: 'acct_123',
        stripeConnected: true,
        theme: 'esn',
        timezone: 'Australia/Brisbane',
      }),
    ).toEqual({
      canonicalRootUrl: 'https://tenant.example.com',
      currency: 'AUD',
      domain: 'tenant.example.com',
      name: 'Tenant',
      reason: '',
      stripeAccountId: 'acct_123',
      theme: 'esn',
      timezone: 'Australia/Brisbane',
    });
  });

  it('trims tenant create/edit payloads and clears blank Stripe account IDs', () => {
    expect(
      globalAdminTenantPayloadFromForm({
        canonicalRootUrl: ' https://section.example.org/ ',
        currency: 'CZK',
        domain: ' section.example.org ',
        name: ' Section ',
        reason: ' Production support request ',
        stripeAccountId: ' ',
        theme: 'evorto',
        timezone: 'Europe/Prague',
      }),
    ).toEqual({
      reason: 'Production support request',
      tenant: {
        canonicalRootUrl: 'https://section.example.org',
        currency: 'CZK',
        domain: 'section.example.org',
        name: 'Section',
        stripeAccountId: undefined,
        theme: 'evorto',
        timezone: 'Europe/Prague',
      },
    });
  });

  it('normalizes the one-primary-domain relaunch input shape', () => {
    expect(
      normalizeGlobalAdminTenantDomain(' https://Section.Example.Org:443 '),
    ).toBe('section.example.org');
    expect(() => normalizeGlobalAdminTenantDomain(' LOCALHOST:4200 ')).toThrow(
      'Domain must be a single host name',
    );
  });

  it('rejects domain paths before submitting tenant create/edit payloads', () => {
    expect(() =>
      globalAdminTenantPayloadFromForm({
        canonicalRootUrl: 'https://section.example.org',
        currency: 'EUR',
        domain: 'section.example.org/path',
        name: 'Section',
        reason: 'Create a production tenant',
        stripeAccountId: '',
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      }),
    ).toThrow('Domain must be a single host name');
  });

  it('rejects canonical roots that do not exactly match the primary domain', () => {
    expect(
      globalAdminTenantCanonicalRootUrlError(
        'https://section.example.org.attacker.invalid',
        'section.example.org',
      ),
    ).toContain('host must match');
    expect(() =>
      globalAdminTenantPayloadFromForm({
        canonicalRootUrl: 'https://attacker.invalid',
        currency: 'EUR',
        domain: 'section.example.org',
        name: 'Section',
        reason: 'Create a production tenant',
        stripeAccountId: '',
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      }),
    ).toThrow('host must match');
  });

  it('shows the actionable reason for typed public URL migration blockers', () => {
    expect(
      globalAdminTenantUpdateErrorMessage({
        _tag: 'GlobalAdminTenantUrlMigrationBlockedError',
        activeRegistrationTransfers: true,
        message:
          'Tenant public URL cannot change while issued links are active',
        pendingStripeObligations: false,
        reason:
          'Complete or cancel every active registration transfer before changing the tenant public URL.',
        tenantId: 'tenant-1',
      }),
    ).toBe(
      'Tenant public URL cannot change while issued links are active. Complete or cancel every active registration transfer before changing the tenant public URL.',
    );
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
