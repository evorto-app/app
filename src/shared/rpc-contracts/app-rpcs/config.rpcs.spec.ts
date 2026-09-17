import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { Tenant } from '../../../types/custom/tenant';
import { ConfigTenant, toClientTenantConfig } from './config.rpcs';

const createTenant = (stripeAccountId?: string) =>
  new Tenant({
    cancellationDeadlineHoursBeforeStart: 24,
    currency: 'EUR',
    defaultLocation: undefined,
    discountProviders: {
      esnCard: {
        config: {},
        status: 'disabled',
      },
    },
    domain: 'section.example.test',
    id: 'tenant-1',
    maxActiveRegistrationsPerUser: 3,
    name: 'Section',
    receiptSettings: {
      allowOther: false,
      receiptCountries: ['DE'],
    },
    refundFeesOnCancellation: false,
    stripeAccountId,
    theme: 'evorto',
    timezone: 'Europe/Berlin',
    transferDeadlineHoursBeforeStart: 24,
  });

describe('client tenant configuration', () => {
  it('reports payment readiness without exposing the payment account identifier', () => {
    const tenant = createTenant('acct_internal-only');
    const clientConfig = toClientTenantConfig(tenant);
    const encoded = Schema.encodeUnknownSync(ConfigTenant.successSchema)(
      clientConfig,
    );

    expect(tenant.stripeAccountId).toBe('acct_internal-only');
    expect(clientConfig.paymentsConfigured).toBe(true);
    expect(clientConfig).not.toHaveProperty('stripeAccountId');
    expect(encoded).not.toHaveProperty('stripeAccountId');
    expect(JSON.stringify(encoded)).not.toContain('acct_internal-only');
  });

  it('reports that payments are not configured when no account is stored', () => {
    expect(toClientTenantConfig(createTenant()).paymentsConfigured).toBe(false);
  });
});
