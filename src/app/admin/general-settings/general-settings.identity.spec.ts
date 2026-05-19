import { describe, expect, it } from 'vitest';

import { tenantIdentityRows } from './general-settings.identity';

describe('tenantIdentityRows', () => {
  it('summarizes read-only tenant identity and runtime settings', () => {
    expect(
      tenantIdentityRows({
        currency: 'EUR',
        domain: 'tenant.example.com',
        locale: 'en-GB',
        name: 'Example Tenant',
        stripeAccountId: 'acct_123',
        timezone: 'Europe/Berlin',
      }),
    ).toEqual([
      { label: 'Tenant name', value: 'Example Tenant' },
      { label: 'Primary domain', value: 'tenant.example.com' },
      { label: 'Currency', value: 'EUR' },
      { label: 'Locale', value: 'en-GB' },
      { label: 'Timezone', value: 'Europe/Berlin' },
      { label: 'Stripe account', value: 'Connected' },
    ]);
  });

  it('shows a readable Stripe state when no account is configured', () => {
    const rows = tenantIdentityRows({
      currency: 'EUR',
      domain: 'tenant.example.com',
      locale: 'en-GB',
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
      locale: 'en-GB',
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
