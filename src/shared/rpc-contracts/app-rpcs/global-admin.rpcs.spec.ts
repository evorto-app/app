import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { GlobalAdminTenantWriteInput } from './global-admin.rpcs';

const tenantWriteInput = {
  canonicalRootUrl: 'https://tenant.example.com',
  currency: 'EUR' as const,
  domain: 'tenant.example.com',
  locale: 'en-GB' as const,
  name: 'Tenant',
  stripeAccountId: 'acct_123',
  theme: 'evorto' as const,
  timezone: 'Europe/Berlin' as const,
};

describe('GlobalAdminTenantWriteInput', () => {
  it('accepts the global-admin tenant create/edit surface', () => {
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantWriteInput)(tenantWriteInput),
    ).not.toThrow();
  });

  it('requires a canonical root URL on tenant writes', () => {
    const { canonicalRootUrl: _canonicalRootUrl, ...missingCanonicalRootUrl } =
      tenantWriteInput;

    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantWriteInput)(
        missingCanonicalRootUrl,
      ),
    ).toThrow();
  });

  it('rejects unsupported tenant runtime settings', () => {
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantWriteInput)({
        ...tenantWriteInput,
        currency: 'USD',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantWriteInput)({
        ...tenantWriteInput,
        locale: 'de-DE',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantWriteInput)({
        ...tenantWriteInput,
        timezone: 'America/New_York',
      }),
    ).toThrow();
  });
});
