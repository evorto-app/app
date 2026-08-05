import { TenantDomainValidationError } from '@shared/tenant-origin';
import { describe, expect, it } from 'vitest';

import {
  createGlobalAdminTenantFormModel,
  globalAdminTenantDomainValidationMessage,
  globalAdminTenantFormModelFromRecord,
  globalAdminTenantPayloadFromForm,
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
        name: 'Tenant',
        paymentsConfigured: true,
        theme: 'esn',
        timezone: 'Australia/Brisbane',
      }),
    ).toEqual({
      currency: 'AUD',
      domain: 'tenant.example.com',
      name: 'Tenant',
      reason: '',
      theme: 'esn',
      timezone: 'Australia/Brisbane',
    });
  });

  it('preserves same-tenant edits when the query refreshes', () => {
    const tenant = {
      currency: 'EUR' as const,
      domain: 'tenant.example.com',
      id: 'tenant-1',
      name: 'Tenant',
      paymentsConfigured: false,
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
      name: 'Tenant',
      paymentsConfigured: false,
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
      name: 'First tenant',
      paymentsConfigured: false,
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

  it('trims tenant create/edit payloads without payment setup fields', () => {
    expect(
      globalAdminTenantPayloadFromForm({
        currency: 'CZK',
        domain: ' section.example.org ',
        name: ' Section ',
        reason: ' Production support request ',
        theme: 'evorto',
        timezone: 'Europe/Prague',
      }),
    ).toEqual({
      reason: 'Production support request',
      tenant: {
        currency: 'CZK',
        domain: 'section.example.org',
        name: 'Section',
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
      'Enter the main website address only, for example section.example.org.',
    );
  });

  it('handles only the expected website-address validation error at the form boundary', () => {
    expect(
      globalAdminTenantDomainValidationMessage(
        new TenantDomainValidationError('Enter a public website address.'),
      ),
    ).toBe('Enter a public website address.');

    const unexpected = new Error('Unexpected parser failure');
    expect(() => globalAdminTenantDomainValidationMessage(unexpected)).toThrow(
      unexpected,
    );
  });

  it('rejects domain paths before submitting tenant create/edit payloads', () => {
    expect(() =>
      globalAdminTenantPayloadFromForm({
        currency: 'EUR',
        domain: 'section.example.org/path',
        name: 'Section',
        reason: 'Create a production tenant',
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      }),
    ).toThrow(
      'Enter the main website address only, for example section.example.org.',
    );
  });

  it('rejects credential-like domain input before deriving a trusted origin', () => {
    expect(() =>
      globalAdminTenantPayloadFromForm({
        currency: 'EUR',
        domain: 'section.example.org@attacker.invalid',
        name: 'Section',
        reason: 'Create a production tenant',
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      }),
    ).toThrow(
      'Enter the main website address only, for example section.example.org.',
    );
  });

  it('shows the actionable reason for typed public URL migration blockers', () => {
    expect(
      globalAdminTenantUpdateErrorMessage({
        _tag: 'GlobalAdminTenantUrlMigrationBlockedError',
        activeRegistrationTransfers: true,
        message:
          'Organization public URL cannot change while issued links are active',
        pendingStripeObligations: false,
        reason:
          "Complete or cancel every active registration transfer before changing the organization's public URL.",
        tenantId: 'tenant-1',
      }),
    ).toBe(
      'The website address cannot be changed while payments, refunds, or ticket transfers are unfinished. Finish or cancel them and try again.',
    );
  });

  it('shows expected organization update outcomes without exposing access or internal messages', () => {
    expect(
      globalAdminTenantUpdateErrorMessage({
        _tag: 'RpcBadRequestError',
        message:
          'This website address is already used by another organization.',
      }),
    ).toBe('This website address is already used by another organization.');

    for (const _tag of [
      'RpcForbiddenError',
      'RpcInternalServerError',
      'RpcUnauthorizedError',
    ]) {
      expect(
        globalAdminTenantUpdateErrorMessage({
          _tag,
          message: 'internal details must stay hidden',
        }),
      ).toBe('The organization could not be updated. Try again.');
    }
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
