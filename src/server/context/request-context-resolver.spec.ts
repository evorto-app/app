import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import * as PgClient from '@effect/sql-pg/PgClient';
import { describe, expect, it, vi } from '@effect/vitest';
import { getTableColumns } from 'drizzle-orm';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Cause, Effect, Exit, Layer, Stream } from 'effect';

import { Database } from '../../db';
import { relations } from '../../db/relations';
import { tenantPrivacyPolicyVersions, tenants } from '../../db/schema';
import {
  resolveAuthenticationContext,
  resolveExplicitTenantDomain,
  resolvePlatformAuthority,
  resolveRequestPermissions,
  resolveTenantContext,
  resolveUserContext,
} from './request-context-resolver';

type TenantReadResult = typeof tenants.$inferSelect & {
  privacyPolicyVersions: Pick<
    typeof tenantPrivacyPolicyVersions.$inferSelect,
    'privacyPolicyText' | 'privacyPolicyUrl'
  >[];
};

const createTenant = (domain: string) =>
  ({
    cancellationDeadlineHoursBeforeStart: 120,
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    currency: 'EUR',
    defaultLocation: null,
    discountProviders: { esnCard: { config: {}, status: 'disabled' } },
    domain,
    emailSenderEmail: null,
    emailSenderName: null,
    faviconUrl: null,
    id: 'tenant-fixture',
    legalNoticeText: null,
    legalNoticeUrl: null,
    logoUrl: null,
    maxActiveRegistrationsPerUser: 0,
    name: domain,
    privacyPolicyVersions: [
      {
        privacyPolicyText: 'Current organization privacy policy',
        privacyPolicyUrl: null,
      },
    ],
    receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
    refundFeesOnCancellation: true,
    seoDescription: null,
    seoTitle: null,
    stripeAccountId: null,
    termsText: null,
    termsUrl: null,
    theme: 'evorto',
    timezone: 'Europe/Berlin',
    transferDeadlineHoursBeforeStart: 0,
    updatedAt: new Date('2026-07-01T12:00:00.000Z'),
  }) satisfies TenantReadResult;

const createTenantDatabaseLayer = (
  findTenant: (input: {
    domain: string;
  }) => Effect.Effect<TenantReadResult | undefined>,
) => {
  const unexpectedDatabaseAccess = Effect.die(
    new Error('Unexpected database operation in tenant routing fixture'),
  );
  const executeValues: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.gen(function* () {
      expect(statement).toContain('from "tenants"');
      expect(statement).toContain('tenant_privacy_policy_versions');
      expect(statement).toContain('"version" desc');
      const domains = parameters.filter(
        (value): value is string => typeof value === 'string',
      );
      expect(domains).toHaveLength(1);
      const domain = domains[0];
      if (typeof domain !== 'string') {
        return yield* Effect.die(new Error('Expected the bound tenant domain'));
      }
      const tenant = yield* findTenant({ domain });
      if (!tenant) return [];
      const { privacyPolicyVersions, ...tenantFields } = tenant;
      expect(Object.keys(tenantFields)).toEqual(
        Object.keys(getTableColumns(tenants)),
      );
      return [
        [
          ...Object.values(tenantFields).map((value) =>
            value instanceof Date
              ? value.toISOString().replace('Z', '')
              : value,
          ),
          privacyPolicyVersions.map((policy) => ({ ...policy })),
        ],
      ];
    });
  const connection = {
    execute: () => unexpectedDatabaseAccess,
    executeRaw: () => unexpectedDatabaseAccess,
    executeStream: () =>
      Stream.die(new Error('Unexpected tenant query stream')),
    executeUnprepared: () => unexpectedDatabaseAccess,
    executeValues,
    executeValuesUnprepared: () => unexpectedDatabaseAccess,
  } satisfies SqlConnection.Connection;
  return Layer.effect(Database, PgDrizzle.makeWithDefaults({ relations })).pipe(
    Layer.provide(
      PgClient.layerFrom(
        PgClient.makeWith({
          acquirer: Effect.succeed(connection),
          config: {},
          listenAcquirer: unexpectedDatabaseAccess,
          transactionAcquirer: unexpectedDatabaseAccess,
        }),
      ),
    ),
  );
};

const createPreparedDatabase = ({
  attributesExecute = vi.fn(() => Effect.succeed([])),
  tenantExecute = vi.fn(() => Effect.succeed(undefined)),
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
          execute: userExecute ?? vi.fn(() => Effect.succeed(undefined)),
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
    'projects the current versioned privacy policy into request context',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createTenantDatabaseLayer(({ domain }) =>
          Effect.succeed(createTenant(domain)),
        );
        const result = yield* resolveTenantContext({
          protocol: 'https',
          requestHost: 'tenant.example.com',
        }).pipe(Effect.provide(databaseLayer));
        expect(result.tenant).toMatchObject({
          privacyPolicyText: 'Current organization privacy policy',
          privacyPolicyUrl: null,
        });
        expect(result.tenant).not.toHaveProperty('privacyPolicyVersions');
      }),
  );

  it.effect(
    'fails when a persisted tenant has no required privacy policy version',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createTenantDatabaseLayer(({ domain }) =>
          Effect.succeed({
            ...createTenant(domain),
            privacyPolicyVersions: [],
          }),
        );
        const result = yield* resolveTenantContext({
          protocol: 'https',
          requestHost: 'tenant.example.com',
        }).pipe(Effect.provide(databaseLayer), Effect.exit);
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result))
          expect(Cause.pretty(result.cause)).toContain(
            'missing its required privacy policy version',
          );
      }),
  );

  it('keeps session cookies out of the request context authentication state', () => {
    expect(resolveAuthenticationContext({ isAuthenticated: true })).toEqual({
      isAuthenticated: true,
    });
  });

  it.effect('resolves the tenant from one normalized host', () =>
    Effect.gen(function* () {
      const tenantExecute = vi.fn(({ domain }: { domain: string }) =>
        Effect.succeed(createTenant(domain)),
      );
      const databaseLayer = createTenantDatabaseLayer(tenantExecute);

      const result = yield* resolveTenantContext({
        protocol: 'https',
        requestHost: 'tenant.example.com',
      }).pipe(Effect.provide(databaseLayer));

      expect(result.tenant?.domain).toBe('tenant.example.com');
      expect(tenantExecute).toHaveBeenCalledTimes(1);
      expect(tenantExecute).toHaveBeenCalledWith({
        domain: 'tenant.example.com',
      });
    }),
  );

  it.effect('uses an explicitly routed tenant instead of a local host', () =>
    Effect.gen(function* () {
      const tenantExecute = vi.fn(({ domain }: { domain: string }) =>
        Effect.succeed(
          domain === 'tenant.example.com' ? createTenant(domain) : undefined,
        ),
      );
      const databaseLayer = createTenantDatabaseLayer(tenantExecute);

      const result = yield* resolveTenantContext({
        protocol: 'http',
        requestHost: 'localhost:4200',
        routedTenantDomain: 'tenant.example.com',
      }).pipe(Effect.provide(databaseLayer));

      expect(result.tenant?.domain).toBe('tenant.example.com');
      expect(tenantExecute).toHaveBeenCalledTimes(1);
      expect(tenantExecute).toHaveBeenCalledWith({
        domain: 'tenant.example.com',
      });
    }),
  );

  it.effect(
    'does not fall back to the local host when an explicit route is stale',
    () =>
      Effect.gen(function* () {
        const tenantExecute = vi.fn(({ domain }: { domain: string }) =>
          Effect.succeed(
            domain === 'localhost' ? createTenant(domain) : undefined,
          ),
        );
        const databaseLayer = createTenantDatabaseLayer(tenantExecute);

        const result = yield* resolveTenantContext({
          protocol: 'http',
          requestHost: 'localhost:4200',
          routedTenantDomain: 'stale.example.com',
        }).pipe(Effect.provide(databaseLayer));

        expect(result).toEqual({
          cause: { domain: 'stale.example.com' },
          tenant: undefined,
        });
        expect(tenantExecute).toHaveBeenCalledOnce();
        expect(tenantExecute).toHaveBeenCalledWith({
          domain: 'stale.example.com',
        });
      }),
  );

  it.effect(
    'does not fall back to the host when an explicit route is malformed',
    () =>
      Effect.gen(function* () {
        const tenantExecute = vi.fn(({ domain }: { domain: string }) =>
          Effect.succeed(createTenant(domain)),
        );
        const databaseLayer = createTenantDatabaseLayer(tenantExecute);

        const result = yield* resolveTenantContext({
          protocol: 'http',
          requestHost: 'localhost:4200',
          routedTenantDomain: 'attacker.example.com/path',
        }).pipe(Effect.provide(databaseLayer));

        expect(result).toEqual({
          cause: { domain: '' },
          tenant: undefined,
        });
        expect(tenantExecute).not.toHaveBeenCalled();
      }),
  );

  it.effect('fails closed for an unknown normalized host', () =>
    Effect.gen(function* () {
      const tenantExecute = vi.fn(() => Effect.succeed(undefined));
      const databaseLayer = createTenantDatabaseLayer(tenantExecute);

      const result = yield* resolveTenantContext({
        protocol: 'https',
        requestHost: 'unknown.example.com',
      }).pipe(Effect.provide(databaseLayer));

      expect(result).toEqual({
        cause: {
          domain: 'unknown.example.com',
        },
        tenant: undefined,
      });
      expect(tenantExecute).toHaveBeenCalledOnce();
      expect(tenantExecute).toHaveBeenCalledWith({
        domain: 'unknown.example.com',
      });
    }),
  );

  it.effect(
    'does not query for a missing, repeated, malformed, or non-normalized host',
    () =>
      Effect.gen(function* () {
        const tenantExecute = vi.fn(() =>
          Effect.succeed(createTenant('tenant.example.com')),
        );
        const databaseLayer = createTenantDatabaseLayer(tenantExecute);

        for (const requestHost of [
          undefined,
          [],
          ['tenant.example.com', 'attacker.example.com'],
          ' tenant.example.com',
          'tenant.example.com/path',
          'Tenant.Example.com',
          '_tenant.example.com',
          'tenant..example.com',
          'tenant.example.com.',
        ] as const) {
          const result = yield* resolveTenantContext({
            protocol: 'https',
            requestHost,
          }).pipe(Effect.provide(databaseLayer));

          expect(result).toEqual({
            cause: { domain: '' },
            tenant: undefined,
          });
        }

        expect(tenantExecute).not.toHaveBeenCalled();
      }),
  );

  it('only accepts the local test route in the local environment', () => {
    expect(
      resolveExplicitTenantDomain({
        applicationEnvironment: 'local',
        localTestTenantDomain: 'local-test.example.com',
        trustedTenantDomain: undefined,
      }),
    ).toBe('local-test.example.com');

    for (const applicationEnvironment of ['staging', 'production'] as const) {
      expect(
        resolveExplicitTenantDomain({
          applicationEnvironment,
          localTestTenantDomain: 'hostile.example.com',
          trustedTenantDomain: undefined,
        }),
      ).toBeUndefined();
    }
  });

  it('prefers the domain from an already trusted route', () => {
    expect(
      resolveExplicitTenantDomain({
        applicationEnvironment: 'local',
        localTestTenantDomain: 'local-test.example.com',
        trustedTenantDomain: 'trusted.example.com',
      }),
    ).toBe('trusted.example.com');
  });

  it('resolves explicit platform authority without granting tenant permissions', () => {
    const oidcUser = {
      email: 'platform@example.org',
      'evorto.app/app_metadata': {
        platformAdministrator: true,
      },
      sub: 'auth0|platform-admin',
    };
    const platformAuthority = resolvePlatformAuthority(oidcUser);

    expect(
      resolveRequestPermissions({
        platformAuthority,
        user: undefined,
      }),
    ).toEqual(['globalAdmin:manageTenants']);
    expect(platformAuthority).toEqual(
      expect.objectContaining({
        actorEmail: 'platform@example.org',
        actorId: 'auth0|platform-admin',
        kind: 'platformAdministrator',
      }),
    );
  });

  it('does not accept the removed globalAdmin metadata alias', () => {
    expect(
      resolvePlatformAuthority({
        'evorto.app/app_metadata': {
          globalAdmin: true,
        },
        sub: 'auth0|legacy-platform-admin',
      }),
    ).toBeUndefined();
  });

  it.each(['https://evorto.app/app_metadata', 'app_metadata'])(
    'rejects the retired %s platform metadata claim',
    (claim) => {
      expect(
        resolvePlatformAuthority({
          [claim]: {
            platformAdministrator: true,
          },
          sub: 'auth0|legacy-platform-admin',
        }),
      ).toBeUndefined();
    },
  );

  it('does not grant platform authority from identity alone', () => {
    const platformAuthority = resolvePlatformAuthority({
      sub: 'auth0|global-admin',
    });

    expect(platformAuthority).toBeUndefined();
    expect(
      resolveRequestPermissions({
        platformAuthority,
        user: undefined,
      }),
    ).not.toContain('globalAdmin:manageTenants');
  });

  it.effect(
    'fails an authenticated request context without a user subject',
    () =>
      Effect.gen(function* () {
        const database = createPreparedDatabase({
          userExecute: vi.fn(() => Effect.succeed(undefined)),
        });

        const exit = yield* resolveUserContext({
          isAuthenticated: true,
          oidcUser: {},
          tenantId: 'tenant-1',
        }).pipe(
          Effect.provide(Layer.succeed(Database, database as never)),
          Effect.exit,
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(String(Cause.squash(exit.cause))).toContain(
            'Authenticated request context is missing its Auth0 user subject',
          );
        }
      }),
  );

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
                        'events:create',
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

        expect(user?.permissions).toEqual(['events:create', 'events:*']);
        expect(user?.roleIds).toEqual(['role-mixed']);
        expect(
          resolveRequestPermissions({
            platformAuthority: undefined,
            user,
          }),
        ).not.toContain('globalAdmin:manageTenants');
      }),
  );

  it('retains platform-global authority for genuine platform principals', () => {
    const platformAuthority = resolvePlatformAuthority({
      'evorto.app/app_metadata': {
        platformAdministrator: true,
      },
      sub: 'auth0|platform-admin',
    });
    const permissions = resolveRequestPermissions({
      platformAuthority,
      user: {
        permissions: ['events:create'],
      },
    });

    expect(permissions).toContain('events:create');
    expect(permissions).toContain('globalAdmin:manageTenants');
  });
});
