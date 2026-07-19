import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';

import {
  tenantOutboundRootUrl,
  tenantOutboundUrl,
} from './tenant-outbound-url';

const tenant = {
  domain: 'section.example.org',
  id: 'tenant-1',
};

const provideEnvironment = (environment: Record<string, string>) =>
  Effect.provide(
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: environment })),
  );

describe('tenant outbound URL', () => {
  it.effect(
    'derives the tenant origin in production and ignores global origins',
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
    'derives the tenant origin for a hosted runtime with NODE_ENV unset',
    () =>
      Effect.gen(function* () {
        expect(yield* tenantOutboundRootUrl(tenant)).toBe(
          'https://section.example.org',
        );
      }).pipe(
        provideEnvironment({
          BASE_URL: 'https://staging.evorto.app',
        }),
      ),
  );

  it.effect('fails closed for an invalid tenant domain', () =>
    Effect.gen(function* () {
      const error = yield* tenantOutboundUrl(
        {
          ...tenant,
          domain: 'section.example.org/path',
        },
        '/events/event-1',
      ).pipe(Effect.flip);

      expect(error._tag).toBe('TenantOutboundUrlError');
      expect(error.tenantId).toBe('tenant-1');
      expect(error.message).toBe('Tenant outbound URL could not be built');
    }).pipe(provideEnvironment({ NODE_ENV: 'production' })),
  );
});
