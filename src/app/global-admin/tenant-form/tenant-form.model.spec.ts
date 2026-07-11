import { describe, expect, it } from 'vitest';

import {
  createGlobalAdminTenantFormModel,
  globalAdminTenantFormModelFromRecord,
  globalAdminTenantPayloadFromForm,
  globalAdminTenantRelaunchScopeItems,
  globalAdminTenantSubmitDisabled,
  globalAdminTenantUpdateErrorMessage,
  normalizeGlobalAdminTenantDomain,
  resolveGlobalAdminTenantEditFormModel,
} from './tenant-form.model';

describe('global admin tenant form model', () => {
  it('starts new tenants with relaunch defaults', () => {
    expect(createGlobalAdminTenantFormModel()).toEqual({
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
      currency: 'AUD',
      domain: 'tenant.example.com',
      name: 'Tenant',
      reason: '',
      stripeAccountId: 'acct_123',
      theme: 'esn',
      timezone: 'Australia/Brisbane',
    });
  });

  it('preserves same-tenant edits when the query refreshes', () => {
    const tenant = {
      currency: 'EUR' as const,
      domain: 'tenant.example.com',
      id: 'tenant-1',
      locale: 'de-DE' as const,
      name: 'Tenant',
      stripeAccountId: null,
      stripeConnected: false,
      theme: 'evorto' as const,
      timezone: 'Europe/Berlin' as const,
    };
    const editedModel = {
      ...globalAdminTenantFormModelFromRecord(tenant),
      domain: 'next.tenant.example.com',
      reason: 'Move the public URL',
    };

    expect(
      resolveGlobalAdminTenantEditFormModel(
        { tenant: { ...tenant }, tenantId: tenant.id },
        {
          source: { tenant, tenantId: tenant.id },
          value: editedModel,
        },
      ),
    ).toBe(editedModel);
  });

  it('initializes the edit form when tenant data first arrives', () => {
    const tenant = {
      currency: 'EUR' as const,
      domain: 'tenant.example.com',
      id: 'tenant-1',
      locale: 'de-DE' as const,
      name: 'Tenant',
      stripeAccountId: null,
      stripeConnected: false,
      theme: 'evorto' as const,
      timezone: 'Europe/Berlin' as const,
    };

    expect(
      resolveGlobalAdminTenantEditFormModel(
        { tenant, tenantId: tenant.id },
        {
          source: { tenant: undefined, tenantId: tenant.id },
          value: createGlobalAdminTenantFormModel(),
        },
      ),
    ).toEqual(globalAdminTenantFormModelFromRecord(tenant));
  });

  it('resets the edit form when navigation selects another tenant', () => {
    const previousTenant = {
      currency: 'EUR' as const,
      domain: 'first.example.com',
      id: 'tenant-1',
      locale: 'de-DE' as const,
      name: 'First tenant',
      stripeAccountId: null,
      stripeConnected: false,
      theme: 'evorto' as const,
      timezone: 'Europe/Berlin' as const,
    };
    const nextTenant = {
      ...previousTenant,
      domain: 'second.example.com',
      id: 'tenant-2',
      name: 'Second tenant',
    };

    expect(
      resolveGlobalAdminTenantEditFormModel(
        { tenant: nextTenant, tenantId: nextTenant.id },
        {
          source: {
            tenant: previousTenant,
            tenantId: previousTenant.id,
          },
          value: {
            ...globalAdminTenantFormModelFromRecord(previousTenant),
            name: 'Unsaved edit',
          },
        },
      ),
    ).toEqual(globalAdminTenantFormModelFromRecord(nextTenant));
  });

  it('trims tenant create/edit payloads and clears blank Stripe account IDs', () => {
    expect(
      globalAdminTenantPayloadFromForm({
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

  it('rejects credential-like domain input before deriving a trusted origin', () => {
    expect(() =>
      globalAdminTenantPayloadFromForm({
        currency: 'EUR',
        domain: 'section.example.org@attacker.invalid',
        name: 'Section',
        reason: 'Create a production tenant',
        stripeAccountId: '',
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      }),
    ).toThrow('Domain must be a single host name');
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
