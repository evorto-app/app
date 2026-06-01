import { describe, expect, it } from 'vitest';

import {
  deferredTenantSettingsRows,
  tenantIdentityRows,
} from './general-settings.identity';

describe('tenantIdentityRows', () => {
  it('summarizes read-only tenant identity and runtime settings', () => {
    expect(
      tenantIdentityRows({
        currency: 'EUR',
        domain: 'tenant.example.com',
        locale: 'de-DE',
        name: 'Example Tenant',
        stripeAccountId: 'acct_123',
        timezone: 'Europe/Berlin',
      }),
    ).toEqual([
      { label: 'Tenant name', value: 'Example Tenant' },
      { label: 'Primary domain', value: 'tenant.example.com' },
      { label: 'Currency', value: 'EUR' },
      { label: 'Locale', value: 'de-DE' },
      { label: 'Timezone', value: 'Europe/Berlin' },
      { label: 'Stripe account', value: 'Connected (acct_123)' },
    ]);
  });

  it('shows a readable Stripe state when no account is configured', () => {
    const rows = tenantIdentityRows({
      currency: 'EUR',
      domain: 'tenant.example.com',
      locale: 'de-DE',
      name: 'Example Tenant',
      stripeAccountId: null,
      timezone: 'Europe/Berlin',
    });

    expect(rows.at(-1)).toEqual({
      label: 'Stripe account',
      value: 'Not connected',
    });
  });

  it('treats an undefined Stripe account as not connected', () => {
    const rows = tenantIdentityRows({
      currency: 'EUR',
      domain: 'tenant.example.com',
      locale: 'de-DE',
      name: 'Example Tenant',
      stripeAccountId: undefined,
      timezone: 'Europe/Berlin',
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
          'Logo and favicon uploads or externally hosted URLs are editable below.',
      },
      {
        label: 'Legal pages',
        value:
          'Imprint, privacy, and terms links or hosted text are editable below.',
      },
      {
        label: 'Operations policy',
        value:
          'Email sender name is editable below. Review policy, registration limits, and Stripe account management are not implemented here yet.',
      },
    ]);
  });
});
