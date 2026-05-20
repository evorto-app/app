import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../db';
import {
  resolveRequestPermissions,
  resolveTenantContext,
  resolveUserContext,
} from './request-context-resolver';

const createTenant = (domain: string) => ({
  currency: 'EUR',
  defaultLocation: null,
  discountProviders: null,
  domain,
  id: `tenant-${domain}`,
  locale: 'en',
  name: domain,
  receiptSettings: null,
  stripeAccountId: null,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
});

const createPreparedDatabase = ({
  attributesExecute = vi.fn(() => Effect.succeed([])),
  tenantExecute = vi.fn(() => Effect.succeed()),
  userExecute,
}: {
  attributesExecute?: ReturnType<typeof vi.fn>;
  tenantExecute?: ReturnType<typeof vi.fn>;
  userExecute?: ReturnType<typeof vi.fn>;
}) => ({
  query: {
    tenants: {
      findFirst: () => ({
        prepare: () => ({
          execute: tenantExecute,
        }),
      }),
    },
    users: {
      findFirst: () => ({
        prepare: () => ({
          execute: userExecute ?? vi.fn(() => Effect.succeed()),
        }),
      }),
    },
  },
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => ({
          prepare: () => ({
            execute: attributesExecute,
          }),
        }),
      }),
    }),
  }),
});

describe('request-context-resolver', () => {
  it.effect(
    'resolves the tenant from a non-local host before a tenant cookie',
    () =>
      Effect.gen(function* () {
        const tenantExecute = vi.fn(({ domain }: { domain: string }) =>
          Effect.succeed(createTenant(domain)),
        );
        const database = createPreparedDatabase({ tenantExecute });

        const result = yield* resolveTenantContext({
          cookies: {
            'evorto-tenant': 'other.example.com',
          },
          protocol: 'https',
          requestHost: 'tenant.example.com',
        }).pipe(Effect.provide(Layer.succeed(Database, database as never)));

        expect(result.tenant?.domain).toBe('tenant.example.com');
        expect(tenantExecute).toHaveBeenCalledTimes(1);
        expect(tenantExecute).toHaveBeenCalledWith({
          domain: 'tenant.example.com',
        });
      }),
  );

  it.effect('uses the tenant cookie for localhost requests', () =>
    Effect.gen(function* () {
      const tenantExecute = vi.fn(({ domain }: { domain: string }) =>
        Effect.succeed(
          domain === 'tenant.example.com' ? createTenant(domain) : undefined,
        ),
      );
      const database = createPreparedDatabase({ tenantExecute });

      const result = yield* resolveTenantContext({
        cookies: {
          'evorto-tenant': 'tenant.example.com',
        },
        protocol: 'http',
        requestHost: 'localhost:4200',
      }).pipe(Effect.provide(Layer.succeed(Database, database as never)));

      expect(result.tenant?.domain).toBe('tenant.example.com');
      expect(tenantExecute).toHaveBeenCalledTimes(1);
      expect(tenantExecute).toHaveBeenCalledWith({
        domain: 'tenant.example.com',
      });
    }),
  );

  it.effect(
    'falls back to the local host when the local tenant cookie is stale',
    () =>
      Effect.gen(function* () {
        const tenantExecute = vi.fn(({ domain }: { domain: string }) =>
          Effect.succeed(
            domain === 'localhost' ? createTenant(domain) : undefined,
          ),
        );
        const database = createPreparedDatabase({ tenantExecute });

        const result = yield* resolveTenantContext({
          cookies: {
            'evorto-tenant': 'stale.example.com',
          },
          protocol: 'http',
          requestHost: 'localhost:4200',
        }).pipe(Effect.provide(Layer.succeed(Database, database as never)));

        expect(result.tenant?.domain).toBe('localhost');
        expect(tenantExecute).toHaveBeenNthCalledWith(1, {
          domain: 'stale.example.com',
        });
        expect(tenantExecute).toHaveBeenNthCalledWith(2, {
          domain: 'localhost',
        });
      }),
  );

  it.effect('fails closed for an unknown non-local host', () =>
    Effect.gen(function* () {
      const tenantExecute = vi.fn(() => Effect.succeed());
      const database = createPreparedDatabase({ tenantExecute });

      const result = yield* resolveTenantContext({
        cookies: {
          'evorto-tenant': 'tenant.example.com',
        },
        protocol: 'https',
        requestHost: 'unknown.example.com',
      }).pipe(Effect.provide(Layer.succeed(Database, database as never)));

      expect(result).toEqual({
        cause: {
          domain: 'unknown.example.com',
          tenantCookie: 'tenant.example.com',
        },
        tenant: undefined,
      });
      expect(tenantExecute).toHaveBeenCalledOnce();
      expect(tenantExecute).toHaveBeenCalledWith({
        domain: 'unknown.example.com',
      });
    }),
  );

  it('resolves global-admin permissions without a tenant user assignment', () => {
    expect(
      resolveRequestPermissions({
        oidcUser: {
          'evorto.app/app_metadata': {
            globalAdmin: true,
          },
        },
        user: undefined,
      }),
    ).toContain('globalAdmin:manageTenants');
  });

  it('resolves local e2e global-admin permissions from configured Auth0 ids', () => {
    const original = process.env['E2E_GLOBAL_ADMIN_AUTH0_IDS'];
    process.env['E2E_GLOBAL_ADMIN_AUTH0_IDS'] =
      ' auth0|global-admin , auth0|other ';

    try {
      expect(
        resolveRequestPermissions({
          oidcUser: {
            sub: 'auth0|global-admin',
          },
          user: undefined,
        }),
      ).toContain('globalAdmin:manageTenants');
    } finally {
      if (original === undefined) {
        delete process.env['E2E_GLOBAL_ADMIN_AUTH0_IDS'];
      } else {
        process.env['E2E_GLOBAL_ADMIN_AUTH0_IDS'] = original;
      }
    }
  });

  it.effect('does not resolve a tenant user without a tenant assignment', () =>
    Effect.gen(function* () {
      const attributesExecute = vi.fn(() => Effect.succeed([]));
      const database = createPreparedDatabase({
        attributesExecute,
        userExecute: vi.fn(() =>
          Effect.succeed({
            auth0Id: 'auth0|global',
            communicationEmail: null,
            email: 'global@example.com',
            firstName: 'Global',
            iban: null,
            id: 'user-1',
            lastName: 'Admin',
            paypalEmail: null,
            tenantAssignments: [],
          }),
        ),
      });

      const user = yield* resolveUserContext({
        isAuthenticated: true,
        oidcUser: {
          sub: 'auth0|global',
        },
        tenantId: 'tenant-1',
      }).pipe(Effect.provide(Layer.succeed(Database, database as never)));

      expect(user).toBeUndefined();
      expect(attributesExecute).not.toHaveBeenCalled();
    }),
  );
});
