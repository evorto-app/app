import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { PlatformOperationContext } from './platform-operation-context';
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

const platformAuthority = PlatformAdministratorAuthority.make({
  actorEmail: 'platform@example.org',
  actorId: 'auth0|platform-admin',
  kind: 'platformAdministrator',
});

const createContextLayer = (
  permissions: readonly Permission[],
  options: { includePlatformAuthority?: boolean } = {},
) => {
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions,
    platformAuthority: options.includePlatformAuthority
      ? platformAuthority
      : null,
    tenant,
    user: null,
    userAssigned: false,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, requestContext),
  );
};

const createPlatformOperationLayer = (input: {
  allowedPermissions: readonly Permission[];
  targetTenantId?: string;
}) =>
  Layer.succeed(
    PlatformOperationContext,
    PlatformOperationContext.of({
      allowedPermissions: input.allowedPermissions,
      authority: platformAuthority,
      reason: 'Resolve a production support request',
      targetTenantId: input.targetTenantId ?? tenant.id,
    }),
  );

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

  it.effect('allows an explicitly scoped platform capability', () =>
    RpcAccess.ensurePermission('templates:create').pipe(
      Effect.provide(
        Layer.mergeAll(
          createContextLayer([], { includePlatformAuthority: true }),
          createPlatformOperationLayer({
            allowedPermissions: ['templates:create'],
          }),
        ),
      ),
    ),
  );

  it.effect('rejects platform capabilities for another target tenant', () =>
    Effect.gen(function* () {
      const error = yield* RpcAccess.ensurePermission('templates:create').pipe(
        Effect.flip,
        Effect.provide(
          Layer.mergeAll(
            createContextLayer([], { includePlatformAuthority: true }),
            createPlatformOperationLayer({
              allowedPermissions: ['templates:create'],
              targetTenantId: 'tenant-2',
            }),
          ),
        ),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
    }),
  );

  it.effect(
    'does not expand platform capabilities through tenant dependencies',
    () =>
      Effect.gen(function* () {
        const error = yield* RpcAccess.ensurePermission('templates:view').pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(
              createContextLayer([], { includePlatformAuthority: true }),
              createPlatformOperationLayer({
                allowedPermissions: ['events:create'],
              }),
            ),
          ),
        );

        expect(error['_tag']).toBe('RpcForbiddenError');
      }),
  );

  it.effect('does not turn platform authority into a tenant user', () =>
    Effect.gen(function* () {
      const error = yield* RpcAccess.requireUser().pipe(
        Effect.flip,
        Effect.provide(
          Layer.mergeAll(
            createContextLayer([], { includePlatformAuthority: true }),
            createPlatformOperationLayer({
              allowedPermissions: ['templates:create'],
            }),
          ),
        ),
      );

      expect(error['_tag']).toBe('RpcUnauthorizedError');
    }),
  );
});
