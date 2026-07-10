import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';

import {
  tenantOutboundRootUrl,
  tenantOutboundUrl,
} from './tenant-outbound-url';

const tenant = {
  canonicalRootUrl: 'https://section.example.org',
  domain: 'section.example.org',
  id: 'tenant-1',
};

const provideEnvironment = (environment: Record<string, string>) =>
  Effect.provide(
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: environment })),
  );

describe('tenant outbound URL', () => {
  it.effect(
    'uses the saved tenant root in production and ignores global origins',
    () =>
      Effect.gen(function* () {
        const url = yield* tenantOutboundUrl(
          tenant,
          '/events/event-1?registrationStatus=success',
        );

        expect(url).toBe(
          'https://section.example.org/events/event-1?registrationStatus=success',
        );
      }).pipe(
        provideEnvironment({
          BASE_URL: 'https://caller-controlled.invalid',
          NODE_ENV: 'production',
        }),
      ),
  );

  it.effect(
    'uses an explicit loopback runtime origin in local development',
    () =>
      Effect.gen(function* () {
        expect(yield* tenantOutboundRootUrl(tenant)).toBe(
          'http://localhost:4200',
        );
      }).pipe(
        provideEnvironment({
          BASE_URL: 'http://localhost:4200',
          NODE_ENV: 'development',
        }),
      ),
  );

  it.effect(
    'uses the saved tenant root for a Fly-like runtime with NODE_ENV unset',
    () =>
      Effect.gen(function* () {
        expect(yield* tenantOutboundRootUrl(tenant)).toBe(
          'https://section.example.org',
        );
      }).pipe(
        provideEnvironment({
          BASE_URL: 'https://evorto.fly.dev',
        }),
      ),
  );

  it.effect('fails closed for a mismatched saved tenant root', () =>
    Effect.gen(function* () {
      const error = yield* tenantOutboundUrl(
        {
          ...tenant,
          canonicalRootUrl: 'https://attacker.invalid',
        },
        '/events/event-1',
      ).pipe(Effect.flip);

      expect(error._tag).toBe('TenantOutboundUrlError');
      expect(error.tenantId).toBe('tenant-1');
      expect(error.message).toBe('Tenant outbound URL could not be built');
    }).pipe(provideEnvironment({ NODE_ENV: 'production' })),
  );
});
