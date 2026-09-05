import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import * as PgClient from '@effect/sql-pg/PgClient';
import { describe, expect, it, vi } from '@effect/vitest';
import { getTableColumns } from 'drizzle-orm';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Cause, Effect, Exit, Layer, Stream } from 'effect';

import { Database } from '../../db';
import { relations } from '../../db/relations';
import {
  roles,
  tenantPrivacyPolicyVersions,
  tenants,
  users,
} from '../../db/schema';
import { createRegistrationDatabaseTestLayer } from '../testing/registration-database';
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

type UserContextFixture = Pick<
  typeof users.$inferSelect,
  | 'auth0Id'
  | 'communicationEmail'
  | 'email'
  | 'firstName'
  | 'iban'
  | 'id'
  | 'lastName'
  | 'paypalEmail'
> & {
  homeTenant?: Pick<typeof tenants.$inferSelect, 'name'>;
  homeTenantId?: string;
  tenantAssignments: {
    roles: (Pick<typeof roles.$inferSelect, 'id'> & {
      // The poisoned-role case deliberately returns malformed persisted JSON.
      permissions: readonly string[];
    })[];
  }[];
};
type UserContextLookup = (
  input: UserLookupInput,
) => Effect.Effect<undefined | UserContextFixture>;
interface UserLookupInput {
  auth0Id: string;
  tenantId: string;
}

const createUserDatabaseLayer = ({
  onUserRead,
  userExecute,
}: {
  onUserRead?: (input: UserLookupInput) => void;
  userExecute: UserContextLookup;
}) =>
  createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.gen(function* () {
        expect(statement).toContain('from "users" as "d0"');
        expect(statement).toContain('from "users_to_tenants" as "d1"');
        expect(statement).toContain('"roles_to_tenant_users"');
        expect(statement).toContain('"d1"."tenantId" = $2');
        expect(statement).toContain('"d0"."auth0Id" = $3');
        expect(parameters).toHaveLength(4);
        const [homeTenantLimit, tenantId, auth0Id, userLimit] = parameters;
        expect(homeTenantLimit).toBe(1);
        expect(userLimit).toBe(1);
        if (typeof tenantId !== 'string' || typeof auth0Id !== 'string') {
          return yield* Effect.die(
            new Error('Expected bound tenant and Auth0 user identifiers'),
          );
        }
        const lookup = { auth0Id, tenantId };
        onUserRead?.(lookup);
        const user = yield* userExecute(lookup);
        if (!user) return [];
        expect(user.auth0Id).toBe(auth0Id);
        const createdAt = new Date('2026-07-01T12:00:00.000Z');
        const userFields: typeof users.$inferSelect = {
          auth0Id: user.auth0Id,
          communicationEmail: user.communicationEmail,
          createdAt,
          email: user.email,
          firstName: user.firstName,
          homeTenantId: user.homeTenantId ?? null,
          iban: user.iban,
          id: user.id,
          lastName: user.lastName,
          paypalEmail: user.paypalEmail,
          searchableInfo: null,
          updatedAt: createdAt,
        };
        expect(Object.keys(userFields)).toEqual(
          Object.keys(getTableColumns(users)),
        );
        return [
          [
            ...Object.values(userFields).map((value) =>
              value instanceof Date
                ? value.toISOString().replace('Z', '')
                : value,
            ),
            user.homeTenant ?? null,
            user.tenantAssignments.map((assignment, index) => ({
              createdAt: createdAt.toISOString().replace('Z', ''),
              id: `membership-${index}`,
              roles: assignment.roles.map((role) => ({ ...role })),
              tenantId,
              userId: user.id,
            })),
          ],
        ];
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
        const database = createUserDatabaseLayer({
          userExecute: vi.fn<UserContextLookup>(() =>
            Effect.succeed(undefined),
          ),
        });

        const exit = yield* resolveUserContext({
          isAuthenticated: true,
          oidcUser: {},
          tenantId: 'tenant-1',
        }).pipe(Effect.provide(database), Effect.exit);

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
      const onUserRead = vi.fn<(input: UserLookupInput) => void>();
      const database = createUserDatabaseLayer({
        onUserRead,
        userExecute: vi.fn<UserContextLookup>(() =>
          Effect.succeed({
            auth0Id: 'auth0|global',
            communicationEmail: 'global@example.com',
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
      }).pipe(Effect.provide(database));

      expect(user).toBeUndefined();
      expect(onUserRead).toHaveBeenCalledExactlyOnceWith({
        auth0Id: 'auth0|global',
        tenantId: 'tenant-1',
      });
    }),
  );

  it.effect(
    'does not expose an assigned tenant user before current onboarding is complete',
    () =>
      Effect.gen(function* () {
        const onUserRead = vi.fn<(input: UserLookupInput) => void>();
        const resolveOnboardingComplete = vi.fn(() => Effect.succeed(false));
        const database = createUserDatabaseLayer({
          onUserRead,
          userExecute: vi.fn<UserContextLookup>(() =>
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
        ).pipe(Effect.provide(database));

        expect(user).toBeUndefined();
        expect(resolveOnboardingComplete).toHaveBeenCalledWith({
          tenantId: 'tenant-1',
          userId: 'user-1',
        });
        expect(onUserRead).toHaveBeenCalledExactlyOnceWith({
          auth0Id: 'auth0|member',
          tenantId: 'tenant-1',
        });
      }),
  );

  it.effect(
    'rejects invalid persisted tenant role permissions before returning a user',
    () =>
      Effect.gen(function* () {
        for (const invalidPermission of [
          'globalAdmin:*',
          'globalAdmin:manageTenants',
          'admin:manageTaxes',
          'events:retiredPermission',
        ]) {
          const onUserRead = vi.fn<(input: UserLookupInput) => void>();
          const database = createUserDatabaseLayer({
            onUserRead,
            userExecute: vi.fn<UserContextLookup>(() =>
              Effect.succeed({
                auth0Id: 'auth0|tenant-user',
                communicationEmail: 'member@example.com',
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
                          invalidPermission,
                        ],
                      },
                    ],
                  },
                ],
              }),
            ),
          });

          const exit = yield* resolveUserContext(
            {
              isAuthenticated: true,
              oidcUser: { sub: 'auth0|tenant-user' },
              tenantId: 'tenant-1',
            },
            () => Effect.succeed(true),
          ).pipe(Effect.provide(database), Effect.exit);

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(Cause.hasDies(exit.cause)).toBe(true);
            expect(String(Cause.squash(exit.cause))).toContain(
              invalidPermission,
            );
          }
          expect(onUserRead).toHaveBeenCalledExactlyOnceWith({
            auth0Id: 'auth0|tenant-user',
            tenantId: 'tenant-1',
          });
        }
      }),
  );

  it.effect(
    'preserves valid tenant role IDs, wildcards and current tax authority',
    () =>
      Effect.gen(function* () {
        const onUserRead = vi.fn<(input: UserLookupInput) => void>();
        const database = createUserDatabaseLayer({
          onUserRead,
          userExecute: vi.fn<UserContextLookup>(() =>
            Effect.succeed({
              auth0Id: 'auth0|tenant-user',
              communicationEmail: 'member@example.com',
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
                      id: 'role-author',
                      permissions: ['events:create', 'events:*'],
                    },
                    {
                      id: 'role-tax',
                      permissions: ['admin:tax', 'events:create'],
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
        ).pipe(Effect.provide(database));

        expect(user?.permissions).toEqual([
          'events:create',
          'events:*',
          'admin:tax',
        ]);
        expect(user?.roleIds).toEqual(['role-author', 'role-tax']);
        expect(
          resolveRequestPermissions({ platformAuthority: undefined, user }),
        ).toEqual(['events:create', 'events:*', 'admin:tax']);
        expect(onUserRead).toHaveBeenCalledExactlyOnceWith({
          auth0Id: 'auth0|tenant-user',
          tenantId: 'tenant-1',
        });
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
