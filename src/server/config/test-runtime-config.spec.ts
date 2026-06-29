import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';

import { formatConfigError } from './config-error';
import {
  isPlaywrightListOnly,
  makePlaywrightEnvironmentConfig,
  requiresIntegrationOnlyPlaywrightEnvironment,
} from './test-runtime-config';

const readPlaywrightEnvironment = (
  provider: ConfigProvider.ConfigProvider,
  argv?: readonly string[],
) =>
  makePlaywrightEnvironmentConfig(argv).pipe(
    Effect.provide(ConfigProvider.layer(provider)),
    Effect.mapError(
      (error) =>
        new Error(
          `Invalid Playwright e2e configuration:\n${formatConfigError(error)}`,
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

const providerFromEntries = (entries: readonly (readonly [string, string])[]) =>
  ConfigProvider.fromEnv({ env: Object.fromEntries(entries) });

describe('test-runtime-config', () => {
  it('treats UI mode as unrestricted for integration-only credentials', () => {
    expect(
      requiresIntegrationOnlyPlaywrightEnvironment([
        'node',
        'playwright',
        'test',
        '--ui',
      ]),
    ).toBe(false);
  });

  it('detects list-only Playwright discovery mode', () => {
    expect(isPlaywrightListOnly(['node', 'playwright', 'test', '--list'])).toBe(
      true,
    );
    expect(isPlaywrightListOnly(['node', 'playwright', 'test', '--ui'])).toBe(
      false,
    );
  });

  it('treats explicitly selected baseline projects as baseline-only', () => {
    expect(
      requiresIntegrationOnlyPlaywrightEnvironment([
        'node',
        'playwright',
        'test',
        '--project=local-chrome-baseline',
      ]),
    ).toBe(false);
    expect(
      requiresIntegrationOnlyPlaywrightEnvironment([
        'node',
        'playwright',
        'test',
        '--project',
        'docs-baseline',
      ]),
    ).toBe(false);
  });

  it('treats environment-selected baseline projects as baseline-only', () => {
    expect(
      requiresIntegrationOnlyPlaywrightEnvironment(
        ['node', 'playwright', 'test'],
        { PLAYWRIGHT_SELECTED_PROJECTS: 'local-chrome-baseline' },
      ),
    ).toBe(false);
  });

  it('treats integration project selection as requiring integration credentials', () => {
    expect(
      requiresIntegrationOnlyPlaywrightEnvironment([
        'node',
        'playwright',
        'test',
        '--project=docs-integration',
      ]),
    ).toBe(true);
  });

  it('treats environment-selected integration projects as requiring integration credentials', () => {
    expect(
      requiresIntegrationOnlyPlaywrightEnvironment(
        ['node', 'playwright', 'test'],
        { PLAYWRIGHT_SELECTED_PROJECTS: 'docs-integration' },
      ),
    ).toBe(true);
  });

  it.effect('requires BASE_URL and ignores PLAYWRIGHT_TEST_BASE_URL', () =>
    Effect.gen(function* () {
      const provider = providerFromEntries([
        ...requiredPlaywrightEntries,
        ['PLAYWRIGHT_TEST_BASE_URL', 'http://localhost:4200'],
      ]);

      const error = yield* Effect.flip(readPlaywrightEnvironment(provider));
      expect(error.message).toMatch(/BASE_URL/);
    }),
  );

  it.effect('allows list-only discovery without runtime secrets', () =>
    Effect.gen(function* () {
      const provider = providerFromEntries([
        ['DATABASE_URL', 'postgresql://db.example/app'],
      ]);
      const environment = yield* readPlaywrightEnvironment(provider, [
        'node',
        'playwright',
        'test',
        '--project=docs-baseline',
        '--list',
      ]);

      expect(environment.BASE_URL).toBe('http://localhost:4200');
      expect(environment.CLIENT_SECRET).toBe('playwright-list-client-secret');
      expect(environment.STRIPE_API_KEY).toBe('sk_test_playwright_list');
      expect(environment.STRIPE_WEBHOOK_SECRET).toBe('whsec_playwright_list');
    }),
  );

  it.effect(
    'allows list-only discovery in CI without artifact credentials',
    () =>
      Effect.gen(function* () {
        const provider = providerFromEntries([
          ['CI', 'true'],
          ['DATABASE_URL', 'postgresql://db.example/app'],
        ]);
        const environment = yield* readPlaywrightEnvironment(provider, [
          'node',
          'playwright',
          'test',
          '--project=docs-baseline',
          '--list',
        ]);

        expect(environment.CI).toBe(true);
        expect(environment.STRIPE_TEST_ACCOUNT_ID).toBe('acct_playwright_list');
      }),
  );

  it.effect('accepts BASE_URL as the canonical Playwright app URL', () =>
    Effect.gen(function* () {
      const provider = providerFromEntries([
        ...requiredPlaywrightEntries,
        ['BASE_URL', 'http://localhost:4200'],
      ]);
      const environment = yield* readPlaywrightEnvironment(provider);

      expect(environment.NO_WEBSERVER).toBe(false);
      expect(environment.BASE_URL).toBe('http://localhost:4200');
    }),
  );

  it.effect(
    'still resolves BASE_URL when NO_WEBSERVER disables only auto-startup',
    () =>
      Effect.gen(function* () {
        const provider = providerFromEntries([
          ...requiredPlaywrightEntries,
          ['BASE_URL', 'http://localhost:4200'],
          ['NO_WEBSERVER', 'true'],
        ]);
        const environment = yield* readPlaywrightEnvironment(provider);

        expect(environment.NO_WEBSERVER).toBe(true);
        expect(environment.BASE_URL).toBe('http://localhost:4200');
      }),
  );

  it.effect(
    'does not require Auth0 Management or Cloudflare Images in CI when only baseline projects are selected',
    () =>
      Effect.gen(function* () {
        const provider = providerFromEntries([
          ...requiredPlaywrightEntries,
          ['BASE_URL', 'http://localhost:4200'],
          ['CI', 'true'],
          ['S3_ACCESS_KEY_ID', 'access-key'],
          ['S3_BUCKET', 'bucket'],
          ['S3_ENDPOINT', 'http://minio:9000'],
          ['S3_REGION', 'us-east-1'],
          ['S3_SECRET_ACCESS_KEY', 'secret-key'],
        ]);
        const environment = yield* readPlaywrightEnvironment(provider, [
          'node',
          'playwright',
          'test',
          '--project=local-chrome-baseline',
        ]);

        expect(environment.CI).toBe(true);
      }),
  );

  it.effect(
    'requires Auth0 Management and Cloudflare Images in CI when an integration project is selected',
    () =>
      Effect.gen(function* () {
        const provider = providerFromEntries([
          ...requiredPlaywrightEntries,
          ['BASE_URL', 'http://localhost:4200'],
          ['CI', 'true'],
          ['S3_ACCESS_KEY_ID', 'access-key'],
          ['S3_BUCKET', 'bucket'],
          ['S3_ENDPOINT', 'http://minio:9000'],
          ['S3_REGION', 'us-east-1'],
          ['S3_SECRET_ACCESS_KEY', 'secret-key'],
        ]);

        const error = yield* Effect.flip(
          readPlaywrightEnvironment(provider, [
            'node',
            'playwright',
            'test',
            '--project=docs-integration',
          ]),
        );
        expect(error.message).toMatch(
          /AUTH0_MANAGEMENT_CLIENT_ID[\s\S]*CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_ACCOUNT_ID[\s\S]*AUTH0_MANAGEMENT_CLIENT_ID/,
        );
      }),
  );
});
