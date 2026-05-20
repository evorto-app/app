import { describe, expect, it } from 'vitest';

import {
  deferredTenantSettingsRows,
  tenantIdentityRows,
} from './general-settings.identity';

describe('tenantIdentityRows', () => {
  it('summarizes read-only tenant identity and runtime settings', () => {
    expect(
      tenantIdentityRows({
        domain: 'tenant.example.com',
        name: 'Example Tenant',
        stripeAccountId: 'acct_123',
      }),
    ).toEqual([
      { label: 'Tenant name', value: 'Example Tenant' },
      { label: 'Primary domain', value: 'tenant.example.com' },
      { label: 'Stripe account', value: 'Connected' },
    ]);
  });

  it('shows a readable Stripe state when no account is configured', () => {
    const rows = tenantIdentityRows({
      domain: 'tenant.example.com',
      name: 'Example Tenant',
      stripeAccountId: null,
    });

    expect(rows.at(-1)).toEqual({
      label: 'Stripe account',
      value: 'Not connected',
    });
  });

  it('treats an undefined Stripe account as not connected', () => {
    const rows = tenantIdentityRows({
      domain: 'tenant.example.com',
      name: 'Example Tenant',
      stripeAccountId: undefined,
    });

    expect(rows.at(-1)).toEqual({
      label: 'Stripe account',
      value: 'Not connected',
    });
  });
});

describe('deferredTenantSettingsRows', () => {
  it('keeps the tenant-settings relaunch gap visible to operators', () => {
    expect(deferredTenantSettingsRows).toEqual([
      {
        label: 'Domain onboarding',
        value:
          'Custom-domain verification and multiple domains are not managed here yet.',
      },
      {
        label: 'Brand assets',
        value:
          'Logo and favicon URLs are editable below; file uploads are not implemented yet.',
      },
      {
        label: 'Legal pages',
        value:
          'Imprint, privacy, and terms links or hosted text are editable below.',
      },
      {
        label: 'Operations policy',
        value:
          'Email sender, review policy, registration limits, and Stripe account management are not implemented here yet.',
      },
    ]);
  });
});
