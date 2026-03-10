import { ConfigError, ConfigProvider, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { formatConfigError } from './config-error';
import { playwrightEnvironmentConfig } from './test-runtime-config';

const readPlaywrightEnvironment = (provider: ConfigProvider.ConfigProvider) =>
  Effect.runSync(
    playwrightEnvironmentConfig.pipe(
      Effect.withConfigProvider(provider),
      Effect.mapError(
        (error: ConfigError.ConfigError) =>
          new Error(
            `Invalid Playwright e2e configuration:\n${formatConfigError(error)}`,
          ),
      ),
    ),
  );

const requiredPlaywrightEntries = [
  ['CLIENT_ID', 'client-id'],
  ['CLIENT_SECRET', 'client-secret'],
  ['DATABASE_URL', 'postgresql://db.example/app'],
  ['ISSUER_BASE_URL', 'https://issuer.example'],
  ['SECRET', 'super-secret'],
  ['STRIPE_API_KEY', 'stripe-api-key'],
  ['STRIPE_TEST_ACCOUNT_ID', 'acct_123'],
  ['STRIPE_WEBHOOK_SECRET', 'whsec_123'],
] as const;

describe('test-runtime-config', () => {
  it('requires BASE_URL and ignores PLAYWRIGHT_TEST_BASE_URL', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ...requiredPlaywrightEntries,
        ['PLAYWRIGHT_TEST_BASE_URL', 'http://localhost:4200'],
      ]),
    );

    expect(() => readPlaywrightEnvironment(provider)).toThrow(/BASE_URL/);
  });

  it('accepts BASE_URL as the canonical Playwright app URL', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ...requiredPlaywrightEntries,
        ['BASE_URL', 'http://localhost:4200'],
      ]),
    );
    const environment = readPlaywrightEnvironment(provider);

    expect(environment.NO_WEBSERVER).toBe(false);
    if (environment.NO_WEBSERVER) {
      throw new Error('Expected a Playwright environment with a web server');
    }
    expect(environment.BASE_URL).toBe('http://localhost:4200');
  });
});
