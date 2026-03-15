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
  it('defaults E2E_MODE to baseline', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ...requiredPlaywrightEntries,
        ['BASE_URL', 'http://localhost:4200'],
      ]),
    );
    const environment = readPlaywrightEnvironment(provider);

    expect(environment.E2E_MODE).toBe('baseline');
  });

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
    expect(environment.BASE_URL).toBe('http://localhost:4200');
  });

  it('still resolves BASE_URL when NO_WEBSERVER disables only auto-startup', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ...requiredPlaywrightEntries,
        ['BASE_URL', 'http://localhost:4200'],
        ['NO_WEBSERVER', 'true'],
      ]),
    );
    const environment = readPlaywrightEnvironment(provider);

    expect(environment.NO_WEBSERVER).toBe(true);
    expect(environment.BASE_URL).toBe('http://localhost:4200');
  });

  it('does not require Auth0 Management or Cloudflare Images in CI baseline mode', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ...requiredPlaywrightEntries,
        ['BASE_URL', 'http://localhost:4200'],
        ['CI', 'true'],
        ['S3_ACCESS_KEY_ID', 'access-key'],
        ['S3_BUCKET', 'bucket'],
        ['S3_ENDPOINT', 'http://minio:9000'],
        ['S3_REGION', 'us-east-1'],
        ['S3_SECRET_ACCESS_KEY', 'secret-key'],
      ]),
    );
    const environment = readPlaywrightEnvironment(provider);

    expect(environment.CI).toBe(true);
    expect(environment.E2E_MODE).toBe('baseline');
  });

  it('requires Auth0 Management and Cloudflare Images in CI integration mode', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ...requiredPlaywrightEntries,
        ['BASE_URL', 'http://localhost:4200'],
        ['CI', 'true'],
        ['E2E_MODE', 'integration'],
        ['S3_ACCESS_KEY_ID', 'access-key'],
        ['S3_BUCKET', 'bucket'],
        ['S3_ENDPOINT', 'http://minio:9000'],
        ['S3_REGION', 'us-east-1'],
        ['S3_SECRET_ACCESS_KEY', 'secret-key'],
      ]),
    );

    expect(() => readPlaywrightEnvironment(provider)).toThrow(
      /AUTH0_MANAGEMENT_CLIENT_ID[\s\S]*CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_ACCOUNT_ID[\s\S]*AUTH0_MANAGEMENT_CLIENT_ID/,
    );
  });
});
