import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveStripeSeedAccountId } from './seed-tenant';

describe('Stripe seed prerequisites', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses an explicit connected test account', () => {
    vi.stubEnv('STRIPE_TEST_ACCOUNT_ID', 'acct_environment');

    expect(resolveStripeSeedAccountId(' acct_explicit ')).toBe('acct_explicit');
  });

  it('uses the configured test account when no explicit value is supplied', () => {
    vi.stubEnv('STRIPE_TEST_ACCOUNT_ID', ' acct_environment ');

    expect(resolveStripeSeedAccountId()).toBe('acct_environment');
  });

  it('fails every paid demo seed when no Stripe account is configured', () => {
    vi.stubEnv('STRIPE_TEST_ACCOUNT_ID', '');

    expect(() => resolveStripeSeedAccountId()).toThrow(
      'Missing STRIPE_TEST_ACCOUNT_ID for deterministic paid seed scenarios',
    );
  });
});
