import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from './rpc-access.service';

const tenant = {
  currency: 'EUR' as const,
  defaultLocation: null,
  discountProviders: {
    esnCard: {
      config: {},
      status: 'disabled' as const,
    },
  },
  domain: 'tenant.example.com',
  id: 'tenant-1',
  locale: 'en',
  name: 'Tenant',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
};

const createContextLayer = (permissions: readonly Permission[]) => {
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions,
    tenant,
    user: null,
    userAssigned: false,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, requestContext),
  );
};

describe('RpcAccess.ensurePermission', () => {
  it.effect('allows direct permissions', () =>
    RpcAccess.ensurePermission('templates:view').pipe(
      Effect.provide(createContextLayer(['templates:view'])),
    ),
  );

  it.effect('allows configured permission dependencies', () =>
    RpcAccess.ensurePermission('templates:view').pipe(
      Effect.provide(createContextLayer(['events:create'])),
    ),
  );

  it.effect('allows legacy admin tax aliases', () =>
    RpcAccess.ensurePermission('admin:tax').pipe(
      Effect.provide(createContextLayer(['admin:manageTaxes'])),
    ),
  );

  it.effect('allows group wildcards against concrete permissions', () =>
    RpcAccess.ensurePermission('templates:*').pipe(
      Effect.provide(createContextLayer(['templates:view'])),
    ),
  );

  it.effect('rejects missing permissions with the requested permission', () =>
    Effect.gen(function* () {
      const error = yield* RpcAccess.ensurePermission('templates:create').pipe(
        Effect.flip,
        Effect.provide(createContextLayer(['templates:view'])),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('templates:create');
    }),
  );
});
