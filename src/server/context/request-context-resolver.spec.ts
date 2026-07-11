import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../db';
import {
  resolveAuthenticationContext,
  resolvePlatformAuthority,
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
  it('keeps session cookies out of the request context authentication state', () => {
    expect(resolveAuthenticationContext({ isAuthenticated: true })).toEqual({
      isAuthenticated: true,
    });
  });

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

  it('resolves explicit platform authority without granting tenant permissions', () => {
    const oidcUser = {
      email: 'platform@example.org',
      'evorto.app/app_metadata': {
        globalAdmin: true,
      },
      sub: 'auth0|platform-admin',
    };

    expect(
      resolveRequestPermissions({
        oidcUser,
        user: undefined,
      }),
    ).toEqual(['globalAdmin:manageTenants']);
    expect(resolvePlatformAuthority(oidcUser)).toEqual(
      expect.objectContaining({
        actorEmail: 'platform@example.org',
        actorId: 'auth0|platform-admin',
        kind: 'platformAdministrator',
      }),
    );
  });

  it('resolves local e2e global-admin permissions from configured Auth0 ids', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv(
      'E2E_GLOBAL_ADMIN_AUTH0_IDS',
      ' auth0|global-admin , auth0|other ',
    );
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
      vi.unstubAllEnvs();
    }
  });

  it('does not resolve e2e global-admin permissions in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('E2E_GLOBAL_ADMIN_AUTH0_IDS', 'auth0|global-admin');
    try {
      expect(
        resolveRequestPermissions({
          oidcUser: {
            sub: 'auth0|global-admin',
          },
          user: undefined,
        }),
      ).not.toContain('globalAdmin:manageTenants');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not resolve e2e global-admin permissions when NODE_ENV is unset', () => {
    vi.stubEnv('NODE_ENV');
    vi.stubEnv('E2E_GLOBAL_ADMIN_AUTH0_IDS', 'auth0|global-admin');
    try {
      expect(
        resolveRequestPermissions({
          oidcUser: {
            sub: 'auth0|global-admin',
          },
          user: undefined,
        }),
      ).not.toContain('globalAdmin:manageTenants');
    } finally {
      vi.unstubAllEnvs();
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

  it.effect(
    'does not expose an assigned tenant user before current onboarding is complete',
    () =>
      Effect.gen(function* () {
        const attributesExecute = vi.fn(() => Effect.succeed([]));
        const resolveOnboardingComplete = vi.fn(() => Effect.succeed(false));
        const database = createPreparedDatabase({
          attributesExecute,
          userExecute: vi.fn(() =>
            Effect.succeed({
              auth0Id: 'auth0|member',
              communicationEmail: 'member@example.org',
              email: 'member@example.org',
              firstName: 'Member',
              homeTenant: { name: 'Home Section' },
              homeTenantId: 'tenant-home',
              iban: null,
              id: 'user-1',
              lastName: 'Example',
              paypalEmail: null,
              tenantAssignments: [{ roles: [] }],
            }),
          ),
        });

        const user = yield* resolveUserContext(
          {
            isAuthenticated: true,
            oidcUser: { sub: 'auth0|member' },
            tenantId: 'tenant-1',
          },
          resolveOnboardingComplete,
        ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

        expect(user).toBeUndefined();
        expect(resolveOnboardingComplete).toHaveBeenCalledWith({
          tenantId: 'tenant-1',
          userId: 'user-1',
        });
        expect(attributesExecute).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'discards poisoned platform permissions while preserving tenant role permissions',
    () =>
      Effect.gen(function* () {
        const database = createPreparedDatabase({
          userExecute: vi.fn(() =>
            Effect.succeed({
              auth0Id: 'auth0|tenant-user',
              communicationEmail: null,
              email: 'member@example.com',
              firstName: 'Tenant',
              iban: null,
              id: 'user-1',
              lastName: 'Member',
              paypalEmail: null,
              tenantAssignments: [
                {
                  roles: [
                    {
                      id: 'role-mixed',
                      permissions: [
                        'events:viewPublic',
                        'events:*',
                        'globalAdmin:*',
                        'globalAdmin:manageTenants',
                      ],
                    },
                  ],
                },
              ],
            }),
          ),
        });

        const user = yield* resolveUserContext(
          {
            isAuthenticated: true,
            oidcUser: { sub: 'auth0|tenant-user' },
            tenantId: 'tenant-1',
          },
          () => Effect.succeed(true),
        ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

        expect(user?.permissions).toEqual(['events:viewPublic', 'events:*']);
        expect(user?.roleIds).toEqual(['role-mixed']);
        expect(
          resolveRequestPermissions({
            oidcUser: { sub: 'auth0|tenant-user' },
            user,
          }),
        ).not.toContain('globalAdmin:manageTenants');
      }),
  );

  it('retains platform-global authority for genuine platform principals', () => {
    const permissions = resolveRequestPermissions({
      oidcUser: {
        'evorto.app/app_metadata': {
          globalAdmin: true,
        },
        sub: 'auth0|platform-admin',
      },
      user: {
        permissions: ['events:viewPublic'],
      },
    });

    expect(permissions).toContain('events:viewPublic');
    expect(permissions).toContain('globalAdmin:manageTenants');
  });
});
