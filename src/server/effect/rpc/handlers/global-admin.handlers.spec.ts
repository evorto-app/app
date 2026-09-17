import { describe, expect, it, vi } from '@effect/vitest';
import {
  PlatformTenantSettingsSnapshot,
  platformTenantSettingsSnapshot,
} from '@shared/tenant-settings-snapshot';
import { Effect, Exit, Layer, Schema } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../../../db';
import {
  platformAuditEntries,
  tenantPrivacyPolicyVersions,
  tenants as tenantsTable,
} from '../../../../db/schema';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import * as GlobalAdminRpcs from '../../../../shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import { PlatformAdministratorAuthority } from '../../../../types/custom/platform-authority';
import { Tenant } from '../../../../types/custom/tenant';
import { StripeClient } from '../../../stripe-client';
import { createRegistrationDatabaseTestLayer } from '../../../testing/registration-database';
import {
  GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE,
  globalAdminHandlers,
  tenantPrivacyPolicyDigest,
} from './global-admin.handlers';
import { RpcAccess } from './shared/rpc-access.service';

const platformAuthority = PlatformAdministratorAuthority.make({
  actorEmail: 'platform@example.org',
  actorId: 'auth0|platform-admin',
  kind: 'platformAdministrator',
});

const createRequestContext = (
  permissions: readonly Permission[],
  options: { authenticated?: boolean; platformAdministrator?: boolean } = {},
) =>
  ({
    authData: {},
    authenticated: options.authenticated !== false,
    permissions,
    platformAuthority:
      options.platformAdministrator === false ? null : platformAuthority,
    tenant: Schema.decodeUnknownSync(Tenant)({
      cancellationDeadlineHoursBeforeStart: 120,
      currency: 'EUR',
      discountProviders: { esnCard: { config: {}, status: 'disabled' } },
      domain: 'tenant.example.com',
      id: 'tenant-1',
      maxActiveRegistrationsPerUser: 0,
      name: 'Tenant',
      receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
      refundFeesOnCancellation: true,
      stripeAccountId: null,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
      transferDeadlineHoursBeforeStart: 0,
    }),
    user: null,
    userAssigned: false,
  }) satisfies RpcRequestContextShape;

const requestContextLayer = (context: RpcRequestContextShape) =>
  Layer.mergeAll(RpcAccess.Default, Layer.succeed(RpcRequestContext, context));

const createRpcOptions = <R extends Rpc.Any>(rpc: R) => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc,
});

type AuditFixtureRow = Pick<
  typeof platformAuditEntries.$inferSelect,
  'action' | 'actorEmail' | 'after' | 'before' | 'createdAt' | 'id' | 'reason'
> & { cursorCreatedAt?: string; targetTenantName: null | string };

const auditFixtureRow = (
  overrides: Partial<AuditFixtureRow> = {},
): AuditFixtureRow => ({
  action: 'tenant.create',
  actorEmail: 'platform@example.org',
  after: {
    resourceId: 'tenant-1',
    resourceType: 'tenant',
    state: { name: 'Section', paymentsConfigured: false },
  },
  before: null,
  createdAt: new Date('2026-07-10T09:15:00.000Z'),
  id: 'audit-001',
  reason: 'Provision requested by section board',
  targetTenantName: 'Section',
  ...overrides,
});

const readAuditPage = (
  rows: readonly AuditFixtureRow[],
  cursor: GlobalAdminRpcs.GlobalAdminPlatformAuditCursor | null = null,
  inspectQuery?: (statement: string, parameters: readonly unknown[]) => void,
) =>
  globalAdminHandlers['globalAdmin.platformAudit.findMany'](
    { cursor },
    createRpcOptions(
      GlobalAdminRpcs.GlobalAdminPlatformAuditFindMany.middleware(
        RpcRequestContextMiddleware,
      ),
    ),
  ).pipe(
    Effect.provide(requestContextLayer(createRequestContext([]))),
    Effect.provide(
      createRegistrationDatabaseTestLayer({
        executeValues: (statement, parameters) =>
          Effect.sync(() => {
            expect(statement).toMatch(/^select /);
            expect(statement).toContain('from "platform_audit_entries"');
            inspectQuery?.(statement, parameters);
            return rows.map((row) => [
              row.action,
              row.actorEmail,
              row.after,
              row.before,
              row.createdAt.toISOString().slice(0, -1),
              row.cursorCreatedAt ??
                row.createdAt.toISOString().replace(/Z$/u, '000Z'),
              row.id,
              row.reason,
              row.targetTenantName,
            ]);
          }),
      }),
    ),
  );

const provideDatabaseOnly = (database: object) =>
  Layer.succeed(Database, database as DatabaseClient);

class RotationStripeResponse extends Stripe.HttpClientResponse {
  constructor(private readonly body: unknown) {
    super(200, { 'request-id': 'req_rotation_tax_rates' });
  }

  override getRawResponse(): unknown {
    return this.body;
  }

  override toJSON(): Promise<unknown> {
    return Promise.resolve(this.body);
  }
}

class UnexpectedStripeHttpClient extends Stripe.HttpClient {
  override getClientName(): string {
    return 'evorto-global-admin-no-stripe-fixture';
  }

  override makeRequest(
    ...arguments_: Parameters<
      InstanceType<typeof Stripe.HttpClient>['makeRequest']
    >
  ): Promise<RotationStripeResponse> {
    const [host, , requestPath, method] = arguments_;
    return Promise.reject(
      new Error(`Unexpected Stripe request: ${method} ${host}${requestPath}`),
    );
  }
}

const provideDatabase = (database: object) =>
  Layer.mergeAll(
    provideDatabaseOnly(database),
    Layer.succeed(
      StripeClient,
      new Stripe('sk_test_global_admin_no_requests', {
        httpClient: new UnexpectedStripeHttpClient(),
        maxNetworkRetries: 0,
      }),
    ),
  );

describe('globalAdminHandlers', () => {
  it.effect('allows tenant reads through explicit platform authority', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findMany: () => Effect.succeed([]),
          },
        },
      };

      const tenants = yield* globalAdminHandlers[
        'globalAdmin.tenants.findMany'
      ](
        undefined,
        createRpcOptions(
          GlobalAdminRpcs.GlobalAdminTenantsFindMany.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(
              createRequestContext(['globalAdmin:manageTenants']),
            ),
          ),
        )
        .pipe(Effect.provide(provideDatabase(database)));

      expect(tenants).toEqual([]);
    }),
  );

  it.effect('does not require tenant permissions for platform reads', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findMany: () =>
              Effect.succeed([
                {
                  currency: 'EUR',
                  domain: 'tenant.example.com',
                  id: 'tenant-1',
                  name: 'Tenant',
                  stripeAccountId: 'acct_123',
                  theme: 'esn',
                  timezone: 'Europe/Berlin',
                },
              ]),
          },
        },
      };

      const tenants = yield* globalAdminHandlers[
        'globalAdmin.tenants.findMany'
      ](
        undefined,
        createRpcOptions(
          GlobalAdminRpcs.GlobalAdminTenantsFindMany.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(Effect.provide(requestContextLayer(createRequestContext([]))))
        .pipe(Effect.provide(provideDatabase(database)));

      expect(tenants).toEqual([
        {
          currency: 'EUR',
          domain: 'tenant.example.com',
          id: 'tenant-1',
          name: 'Tenant',
          paymentsConfigured: true,
          theme: 'esn',
          timezone: 'Europe/Berlin',
        },
      ]);
    }),
  );

  it.effect('returns one tenant for global-admin detail review', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findFirst: ({ where }: { where: { id: string } }) =>
              Effect.succeed(
                where.id === 'tenant-1'
                  ? {
                      currency: 'EUR',
                      domain: 'tenant.example.com',
                      id: 'tenant-1',
                      name: 'Tenant',
                      stripeAccountId: null,
                      theme: 'evorto',
                      timezone: 'Europe/Berlin',
                    }
                  : undefined,
              ),
          },
        },
      };

      const tenant = yield* globalAdminHandlers['globalAdmin.tenants.findOne'](
        { id: 'tenant-1' },
        createRpcOptions(
          GlobalAdminRpcs.GlobalAdminTenantsFindOne.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(
              createRequestContext(['globalAdmin:manageTenants']),
            ),
          ),
        )
        .pipe(Effect.provide(provideDatabase(database)));

      expect(tenant).toEqual({
        currency: 'EUR',
        domain: 'tenant.example.com',
        id: 'tenant-1',
        name: 'Tenant',
        paymentsConfigured: false,
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      });
    }),
  );

  it.effect('returns null for missing global-admin tenant details', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findFirst: () => Effect.succeed(undefined),
          },
        },
      };

      const tenant = yield* globalAdminHandlers['globalAdmin.tenants.findOne'](
        { id: 'missing-tenant' },
        createRpcOptions(
          GlobalAdminRpcs.GlobalAdminTenantsFindOne.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(
              createRequestContext(['globalAdmin:manageTenants']),
            ),
          ),
        )
        .pipe(Effect.provide(provideDatabase(database)));

      expect(tenant).toBeNull();
    }),
  );

  it.effect('rejects signed-in users without explicit platform authority', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findMany: () => Effect.fail(new Error('database should not run')),
          },
        },
      };

      const error = yield* globalAdminHandlers['globalAdmin.tenants.findMany'](
        undefined,
        createRpcOptions(
          GlobalAdminRpcs.GlobalAdminTenantsFindMany.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(
              createRequestContext(['globalAdmin:manageTenants'], {
                platformAdministrator: false,
              }),
            ),
          ),
        )
        .pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.message).toBe('Platform administrator authority required');
    }),
  );

  it.effect('rejects anonymous tenant reads before querying tenants', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findMany: () => Effect.fail(new Error('database should not run')),
          },
        },
      };

      const error = yield* globalAdminHandlers['globalAdmin.tenants.findMany'](
        undefined,
        createRpcOptions(
          GlobalAdminRpcs.GlobalAdminTenantsFindMany.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(
              createRequestContext(['globalAdmin:manageTenants'], {
                authenticated: false,
              }),
            ),
          ),
        )
        .pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcUnauthorizedError');
    }),
  );

  it.effect(
    'summarizes single-dispatch outcomes and includes sent history',
    () =>
      Effect.gen(function* () {
        const attempt = '2026-07-09T09:00:00.000';
        const queries: string[] = [];
        const deliveryRows = [
          [
            null,
            'failed',
            'receiptReviewed',
            attempt,
            'failed@example.org',
            null,
            'failed',
            'Receipt rejected',
            null,
            'section.example.org',
            'Section',
            'Australia/Brisbane',
          ],
          [
            null,
            'unknown',
            'receiptReviewed',
            attempt,
            'unknown@example.org',
            null,
            'deliveryUnknown',
            'Receipt reviewed',
            null,
            'section.example.org',
            'Section',
            'Australia/Brisbane',
          ],
          [
            null,
            'sent',
            'registrationConfirmed',
            attempt,
            'sent@example.org',
            attempt,
            'sent',
            'Registration confirmed',
            null,
            'section.example.org',
            'Section',
            'Australia/Brisbane',
          ],
          [
            null,
            'sent-missing-attempt',
            'registrationConfirmed',
            null,
            'sent-missing-attempt@example.org',
            attempt,
            'sent',
            'Registration confirmed',
            null,
            'section.example.org',
            'Section',
            'Australia/Brisbane',
          ],
          [
            null,
            'suppressed',
            'manualApproval',
            null,
            'suppressed@example.org',
            null,
            'suppressed',
            'Manual approval',
            null,
            'section.example.org',
            'Section',
            'Australia/Brisbane',
          ],
          [
            null,
            'sending',
            'manualApproval',
            null,
            'sending@example.org',
            null,
            'sending',
            'Manual approval',
            null,
            'section.example.org',
            'Section',
            'Australia/Brisbane',
          ],
          [
            null,
            'queued',
            'manualApproval',
            null,
            'queued@example.org',
            null,
            'queued',
            'Manual approval',
            null,
            'section.example.org',
            'Section',
            'Australia/Brisbane',
          ],
        ];
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              queries.push(statement);
              expect(statement).toContain('from "email_outbox"');
              if (statement.includes('group by')) {
                expect(parameters).toEqual([]);
                return [
                  ['failed', 2],
                  ['queued', 1],
                  ['sent', 2],
                  ['deliveryUnknown', 1],
                  ['sending', 1],
                  ['suppressed', 1],
                ];
              }
              if (statement.includes('inner join "tenants"')) {
                expect(statement).toContain('"tenants"."timezone"');
                expect(statement).toContain('"email_outbox_overview"');
                return deliveryRows;
              }
              expect(statement).toContain('"claim_lease_id" is null');
              expect(statement).toContain('"claim_lease_expires_at" is null');
              expect(parameters).toEqual([]);
              return [[1]];
            }),
        });
        const overview = yield* globalAdminHandlers[
          'globalAdmin.emailOutbox.findOverview'
        ](
          undefined,
          createRpcOptions(
            GlobalAdminRpcs.GlobalAdminEmailOutboxFindOverview.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        ).pipe(
          Effect.provide(requestContextLayer(createRequestContext([]))),
          Effect.provide(databaseLayer),
        );

        expect(queries).toHaveLength(3);
        expect(overview.summary).toEqual({
          deliveryUnknown: 1,
          failed: 2,
          queued: 1,
          sending: 1,
          sent: 2,
          staleSending: 1,
          suppressed: 1,
        });
        expect(
          overview.items.map(({ id, recordIncomplete }) => ({
            id,
            recordIncomplete,
          })),
        ).toEqual([
          { id: 'failed', recordIncomplete: false },
          { id: 'unknown', recordIncomplete: true },
          { id: 'sent', recordIncomplete: false },
          { id: 'sent-missing-attempt', recordIncomplete: true },
          { id: 'suppressed', recordIncomplete: true },
          { id: 'sending', recordIncomplete: true },
          { id: 'queued', recordIncomplete: false },
        ]);
        expect(overview.items[0]).toEqual({
          id: 'failed',
          kind: 'receiptReviewed',
          lastAttemptAt: '2026-07-09T09:00:00.000Z',
          recipient: 'failed@example.org',
          recordIncomplete: false,
          status: 'failed',
          subject: 'Receipt rejected',
          tenantDomain: 'section.example.org',
          tenantName: 'Section',
          tenantTimezone: 'Australia/Brisbane',
        });
        for (const item of overview.items) {
          expect(item).not.toHaveProperty('lastError');
          expect(item).not.toHaveProperty('provider');
          expect(item).not.toHaveProperty('attempts');
        }
      }),
  );

  it.effect('returns application append-only platform audit entries', () =>
    Effect.gen(function* () {
      const createdAt = new Date('2026-07-10T09:15:00.000Z');
      const after = {
        resourceId: 'tenant-1',
        resourceType: 'tenant',
        state: {
          currency: 'EUR',
          domain: 'section.example.org',
          id: 'tenant-1',
          name: 'Section',
          paymentsConfigured: false,
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
      } as const;
      const rows: AuditFixtureRow[] = [
        {
          action: 'tenant.create' as const,
          actorEmail: 'platform@example.org',
          after,
          before: null,
          createdAt,
          id: 'audit-1',
          reason: 'Provision requested by section board',
          targetTenantName: 'Section',
        },
        {
          action: 'taxRates.import' as const,
          actorEmail: 'platform@example.org',
          after: {
            resourceId: 'tax-import-1',
            resourceType: 'taxRateBatch' as const,
            state: {
              rates: [
                {
                  active: true,
                  country: 'DE',
                  displayName: 'Standard',
                  inclusive: true,
                  percentage: '19',
                  state: null,
                  stripeTaxRateId: 'txr_existing',
                },
                {
                  active: true,
                  country: 'DE',
                  displayName: 'Reduced',
                  inclusive: true,
                  percentage: '7',
                  state: null,
                  stripeTaxRateId: 'txr_added',
                },
                {
                  active: true,
                  country: 'DE',
                  displayName: 'Super reduced',
                  inclusive: true,
                  percentage: '5',
                  state: null,
                  stripeTaxRateId: 'txr_unchanged',
                },
              ],
            },
          },
          before: {
            resourceId: 'tax-import-1',
            resourceType: 'taxRateBatch' as const,
            state: {
              rates: [
                {
                  active: true,
                  country: 'DE',
                  displayName: 'Old standard',
                  inclusive: true,
                  percentage: '19',
                  state: null,
                  stripeTaxRateId: 'txr_existing',
                },
                {
                  active: true,
                  country: 'DE',
                  displayName: 'Super reduced',
                  inclusive: true,
                  percentage: '5',
                  state: null,
                  stripeTaxRateId: 'txr_unchanged',
                },
              ],
            },
          },
          createdAt,
          id: 'audit-2',
          reason: 'Refresh tax rates',
          targetTenantName: 'Section',
        },
      ];

      const page = yield* readAuditPage(rows);

      expect(page.items).toEqual([
        expect.objectContaining({
          action: 'tenant.create',
          createdAt: '2026-07-10T09:15:00.000Z',
          reason: 'Provision requested by section board',
          targetTenantName: 'Section',
        }),
        expect.objectContaining({
          action: 'taxRates.import',
          after: expect.objectContaining({
            state: {
              taxRateAddedCount: 1,
              taxRateCount: 3,
              taxRateUnchangedCount: 1,
              taxRateUpdatedCount: 1,
            },
          }),
        }),
      ]);
      expect(page.items[0]?.after?.state).toMatchObject({
        paymentsConfigured: false,
      });
      expect(page.nextCursor).toBeNull();
      expect(page.items[0]?.after?.state).not.toHaveProperty('stripeAccountId');
      expect(page.items[0]).not.toHaveProperty('actorId');
      expect(page.items[0]).not.toHaveProperty('targetTenantId');
      expect(page.items[0]?.after).not.toHaveProperty('resourceId');
    }),
  );

  it.effect.each([
    {
      added: 1,
      after: ['role-new'],
      before: ['role-old'],
      name: 'same-count replacement',
      removed: 1,
    },
    {
      added: 1,
      after: ['role-kept', 'role-new'],
      before: ['role-kept'],
      name: 'addition',
      removed: 0,
    },
    {
      added: 0,
      after: ['role-kept'],
      before: ['role-kept', 'role-old'],
      name: 'removal',
      removed: 1,
    },
    {
      added: 0,
      after: ['role-kept'],
      before: ['role-kept'],
      name: 'unchanged assignment',
      removed: 0,
    },
    {
      added: 0,
      after: ['role-two', 'role-one'],
      before: ['role-one', 'role-two'],
      name: 'reordered assignment',
      removed: 0,
    },
    { added: 0, after: [], before: [], name: 'empty assignment', removed: 0 },
  ])(
    'summarizes $name without exposing member or role identifiers',
    (assignment) =>
      Effect.gen(function* () {
        const page = yield* readAuditPage([
          auditFixtureRow({
            action: 'user.assignRoles',
            after: {
              resourceId: 'private-member',
              resourceType: 'userRoleAssignment',
              state: { roleIds: assignment.after, userId: 'private-member' },
            },
            before: {
              resourceId: 'private-member',
              resourceType: 'userRoleAssignment',
              state: { roleIds: assignment.before, userId: 'private-member' },
            },
          }),
        ]);
        expect(page.items[0]?.before).toEqual({
          resourceType: 'userRoleAssignment',
          state: { roleCount: assignment.before.length },
        });
        expect(page.items[0]?.after).toEqual({
          resourceType: 'userRoleAssignment',
          state: {
            roleAddedCount: assignment.added,
            roleCount: assignment.after.length,
            roleRemovedCount: assignment.removed,
          },
        });
        expect(JSON.stringify(page)).not.toContain('private-member');
        expect(JSON.stringify(page)).not.toContain('roleIds');
        for (const roleId of [...assignment.before, ...assignment.after]) {
          expect(JSON.stringify(page)).not.toContain(roleId);
        }
      }),
  );

  it.effect.each([
    { name: 'missing role IDs', state: {} },
    { name: 'non-string role IDs', state: { roleIds: [123] } },
    { name: 'empty role IDs', state: { roleIds: [''] } },
  ])('rejects assignment audit snapshots with $name', ({ state }) =>
    Effect.gen(function* () {
      const exit = yield* readAuditPage([
        auditFixtureRow({
          action: 'user.assignRoles',
          after: {
            resourceId: 'member-1',
            resourceType: 'userRoleAssignment',
            state,
          },
          before: {
            resourceId: 'member-1',
            resourceType: 'userRoleAssignment',
            state: { roleIds: [] },
          },
        }),
      ]).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect('returns a bounded, deterministically ordered audit page', () =>
    Effect.gen(function* () {
      const rows = Array.from(
        { length: GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE + 1 },
        (_, index) =>
          auditFixtureRow({
            id: `audit-${String(index + 1).padStart(3, '0')}`,
          }),
      );
      const page = yield* readAuditPage(rows, null, (statement, parameters) => {
        expect(statement).toContain(
          'order by "platform_audit_entries"."created_at" desc, "platform_audit_entries"."id" asc',
        );
        expect(statement).not.toContain(' where ');
        expect(parameters).toEqual([GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE + 1]);
      });
      expect(page.items).toHaveLength(GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE);
      expect(page.items.at(-1)?.id).toBe('audit-050');
      expect(page.nextCursor).toEqual({
        createdAt: '2026-07-10T09:15:00.000000Z',
        id: 'audit-050',
      });
    }),
  );

  it.effect('returns the exact stored timestamp at a page boundary', () =>
    Effect.gen(function* () {
      const rows = Array.from(
        { length: GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE + 1 },
        (_, index) =>
          auditFixtureRow({
            createdAt: new Date('2026-07-10T09:15:00.123Z'),
            cursorCreatedAt: '2026-07-10T09:15:00.123456Z',
            id: `audit-${String(index + 1).padStart(3, '0')}`,
          }),
      );
      const page = yield* readAuditPage(rows);
      expect(page.nextCursor).toEqual({
        createdAt: '2026-07-10T09:15:00.123456Z',
        id: 'audit-050',
      });
      expect(page.items.at(-1)?.createdAt).toBe('2026-07-10T09:15:00.123Z');
    }),
  );

  it.effect('continues after equal timestamps by ascending audit id', () =>
    Effect.gen(function* () {
      const cursor = {
        createdAt: '2026-07-10T09:15:00.123456Z',
        id: 'audit-050',
      };
      const page = yield* readAuditPage([], cursor, (statement, parameters) => {
        expect(statement).toContain(
          '"platform_audit_entries"."created_at" < $1::timestamp',
        );
        expect(statement).toContain(
          '"platform_audit_entries"."created_at" = $2::timestamp',
        );
        expect(statement).toContain('"platform_audit_entries"."id" > $3');
        expect(parameters).toEqual([
          cursor.createdAt,
          cursor.createdAt,
          cursor.id,
          GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE + 1,
        ]);
      });
      expect(page).toEqual({ items: [], nextCursor: null });
    }),
  );

  it.effect('projects formatted descriptions as readable audit text', () =>
    Effect.gen(function* () {
      const page = yield* readAuditPage([
        auditFixtureRow({
          action: 'event.update',
          after: {
            resourceId: 'event-1',
            resourceType: 'event',
            state: {
              description:
                '<p>Welcome <strong>everyone</strong>.</p><ul><li>Bring ID</li></ul>',
            },
          },
          before: {
            resourceId: 'event-1',
            resourceType: 'event',
            state: { description: '<p>Welcome.</p>' },
          },
        }),
      ]);
      expect(page.items[0]?.before?.state.description).toBe('Welcome.');
      expect(page.items[0]?.after?.state.description).toBe(
        'Welcome everyone. Bring ID',
      );
      expect(JSON.stringify(page)).not.toContain('<p>');
    }),
  );

  it.effect(
    'preserves the current event listing decision in the safe audit projection',
    () =>
      Effect.gen(function* () {
        const page = yield* readAuditPage([
          auditFixtureRow({
            action: 'event.updateListing',
            after: {
              resourceId: 'event-1',
              resourceType: 'event',
              state: { unlisted: true },
            },
            before: {
              resourceId: 'event-1',
              resourceType: 'event',
              state: { unlisted: false },
            },
          }),
        ]);
        expect(page.items[0]?.after?.state).toEqual({ unlisted: true });
        expect(page.items[0]?.before?.state).toEqual({ unlisted: false });
      }),
  );

  it.effect('rejects tenant detail reads without platform authority', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findFirst: () => Effect.fail(new Error('database should not run')),
          },
        },
      };

      const error = yield* globalAdminHandlers['globalAdmin.tenants.findOne'](
        { id: 'tenant-1' },
        createRpcOptions(
          GlobalAdminRpcs.GlobalAdminTenantsFindOne.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(
              createRequestContext(['globalAdmin:manageTenants'], {
                platformAdministrator: false,
              }),
            ),
          ),
        )
        .pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.message).toBe('Platform administrator authority required');
    }),
  );

  it.effect('creates tenants with normalized operational settings', () =>
    Effect.gen(function* () {
      let capturedAudit: Record<string, unknown> | undefined;
      let capturedInsert: Record<string, unknown> | undefined;
      let capturedPrivacyPolicy: Record<string, unknown> | undefined;
      const insertQuery = {
        returning: () =>
          Effect.succeed([
            {
              currency: 'CZK',
              domain: 'section.example.org',
              id: 'tenant-1',
              name: 'Example Section',
              stripeAccountId: null,
              theme: 'esn',
              timezone: 'Europe/Prague',
            },
          ]),
        values: (value: Record<string, unknown>) => {
          capturedInsert = value;
          return insertQuery;
        },
      };
      const database = {
        insert: (table: unknown) => {
          if (table === tenantsTable) {
            return insertQuery;
          }
          if (table === tenantPrivacyPolicyVersions) {
            return {
              values: (value: Record<string, unknown>) => {
                capturedPrivacyPolicy = value;
                return {
                  returning: () => Effect.succeed([{ id: 'policy-1' }]),
                };
              },
            };
          }

          expect(table).toBe(platformAuditEntries);
          return {
            values: (value: Record<string, unknown>) => {
              capturedAudit = value;
              return Effect.void;
            },
          };
        },
        query: {
          tenants: {
            findFirst: () => Effect.succeed(undefined),
          },
        },
        transaction: (operation: (transaction: object) => unknown) =>
          operation(database),
      };

      const tenant = yield* globalAdminHandlers['globalAdmin.tenants.create'](
        {
          initialPrivacyPolicy: {
            privacyPolicyText: ' Section privacy policy ',
            privacyPolicyUrl: '',
          },
          reason: ' Provision requested by section board ',
          tenant: {
            currency: 'CZK',
            domain: ' https://Section.Example.Org ',
            name: ' Example Section ',
            theme: 'esn',
            timezone: 'Europe/Prague',
          },
        },
        createRpcOptions(
          GlobalAdminRpcs.GlobalAdminTenantsCreate.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(
              createRequestContext(['globalAdmin:manageTenants']),
            ),
          ),
        )
        .pipe(Effect.provide(provideDatabase(database)));

      expect(capturedInsert).toMatchObject({
        currency: 'CZK',
        domain: 'section.example.org',
        name: 'Example Section',
        stripeAccountId: null,
        theme: 'esn',
        timezone: 'Europe/Prague',
      });
      expect(capturedAudit).toMatchObject({
        action: 'tenant.create',
        actorEmail: 'platform@example.org',
        actorId: 'auth0|platform-admin',
        before: null,
        reason: 'Provision requested by section board',
        targetTenantId: 'tenant-1',
      });
      expect(capturedAudit?.['after']).toMatchObject({
        resourceId: 'tenant-1',
        resourceType: 'tenant',
        state: {
          domain: 'section.example.org',
          id: 'tenant-1',
          privacyPolicyDigestSha256: tenantPrivacyPolicyDigest({
            privacyPolicyText: 'Section privacy policy',
            privacyPolicyUrl: null,
          }),
          privacyPolicyVersionId: 'policy-1',
        },
      });
      expect(JSON.stringify(capturedAudit?.['after'])).not.toContain(
        'Section privacy policy',
      );
      expect(JSON.stringify(capturedAudit?.['after'])).not.toContain(
        'privacyPolicyUrl',
      );
      expect(capturedPrivacyPolicy).toEqual({
        createdByUserId: null,
        privacyPolicyText: 'Section privacy policy',
        privacyPolicyUrl: null,
        tenantId: 'tenant-1',
        version: 1,
      });
      expect(tenant).not.toHaveProperty('stripeAccountId');
      expect(tenant).toMatchObject({
        domain: 'section.example.org',
        name: 'Example Section',
        paymentsConfigured: false,
      });
    }),
  );

  it.effect(
    'maps duplicate tenant domains to bad requests before inserting',
    () =>
      Effect.gen(function* () {
        const database = {
          insert: () => {
            throw new Error('insert should not run');
          },
          query: {
            tenants: {
              findFirst: () => Effect.succeed({ id: 'existing-tenant' }),
            },
          },
        };

        const error = yield* globalAdminHandlers['globalAdmin.tenants.create'](
          {
            initialPrivacyPolicy: {
              privacyPolicyText: 'Tenant privacy policy',
              privacyPolicyUrl: '',
            },
            reason: 'Provision requested by tenant board',
            tenant: {
              currency: 'EUR',
              domain: 'Tenant.Example.com',
              name: 'Duplicate Tenant',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          createRpcOptions(
            GlobalAdminRpcs.GlobalAdminTenantsCreate.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['globalAdmin:manageTenants']),
              ),
            ),
          )
          .pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe('Organization domain already exists');
        if (error._tag !== 'RpcBadRequestError') {
          return yield* Effect.die(
            new Error('Expected a typed bad-request error'),
          );
        }
        expect(error.reason).toBe('tenant.example.com');
      }),
  );

  it.effect('requires an initial privacy policy before tenant creation', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findFirst: () => Effect.fail(new Error('database should not run')),
          },
        },
      };

      const error = yield* globalAdminHandlers['globalAdmin.tenants.create'](
        {
          initialPrivacyPolicy: {
            privacyPolicyText: ' ',
            privacyPolicyUrl: '',
          },
          reason: 'Provision requested by tenant board',
          tenant: {
            currency: 'EUR',
            domain: 'tenant.example.com',
            name: 'Tenant',
            theme: 'evorto',
            timezone: 'Europe/Berlin',
          },
        },
        createRpcOptions(
          GlobalAdminRpcs.GlobalAdminTenantsCreate.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(Effect.provide(requestContextLayer(createRequestContext([]))))
        .pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toContain('privacy policy');
    }),
  );

  it.effect(
    'updates tenant details while preserving the attached account and tax metadata',
    () =>
      Effect.gen(function* () {
        let capturedAudit: Record<string, unknown> | undefined;
        let capturedUpdate: Record<string, unknown> | undefined;
        let deletedTaxMetadata = false;
        const beforeTenant = {
          currency: 'EUR',
          domain: 'tenant.example.com',
          id: 'tenant-1',
          name: 'Tenant before update',
          stripeAccountId: 'acct_previous',
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        };
        const updateQuery = {
          returning: () =>
            Effect.succeed([
              {
                currency: 'EUR',
                domain: 'tenant.example.com',
                id: 'tenant-1',
                name: 'Tenant',
                stripeAccountId: 'acct_previous',
                theme: 'evorto',
                timezone: 'Europe/Berlin',
              },
            ]),
          set: (value: Record<string, unknown>) => {
            capturedUpdate = value;
            return updateQuery;
          },
          where: () => updateQuery,
        };
        const selectQuery = {
          for: () => Effect.succeed([beforeTenant]),
          from: () => selectQuery,
          where: () => selectQuery,
        };
        const pendingObligationsQuery = {
          from: () => pendingObligationsQuery,
          innerJoin: () => pendingObligationsQuery,
          limit: () => Effect.succeed([]),
          where: () => pendingObligationsQuery,
        };
        let selectCount = 0;
        const database = {
          delete: () => ({
            where: () => {
              deletedTaxMetadata = true;
              return Effect.void;
            },
          }),
          insert: (table: unknown) => ({
            values: (value: Record<string, unknown>) => {
              expect(table).toBe(platformAuditEntries);
              capturedAudit = value;
              return Effect.void;
            },
          }),
          query: {
            tenants: {
              findFirst: () => Effect.succeed({ id: 'tenant-1' }),
            },
          },
          select: () =>
            selectCount++ === 0 ? selectQuery : pendingObligationsQuery,
          transaction: (operation: (transaction: object) => unknown) =>
            operation(database),
          update: () => updateQuery,
        };

        const tenant = yield* globalAdminHandlers['globalAdmin.tenants.update'](
          {
            expectedSettings: Schema.decodeUnknownSync(
              PlatformTenantSettingsSnapshot,
            )(beforeTenant),
            id: 'tenant-1',
            reason: ' Tenant requested a support correction ',
            tenant: {
              currency: 'EUR',
              domain: 'tenant.example.com',
              name: 'Tenant',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          createRpcOptions(
            GlobalAdminRpcs.GlobalAdminTenantsUpdate.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['globalAdmin:manageTenants']),
              ),
            ),
          )
          .pipe(Effect.provide(provideDatabase(database)));

        expect(capturedUpdate).toMatchObject({
          domain: 'tenant.example.com',
          name: 'Tenant',
        });
        expect(deletedTaxMetadata).toBe(false);
        expect(capturedUpdate).not.toHaveProperty('stripeAccountId');
        expect(tenant).not.toHaveProperty('stripeAccountId');
        expect(capturedAudit).toMatchObject({
          action: 'tenant.update',
          actorEmail: 'platform@example.org',
          actorId: 'auth0|platform-admin',
          reason: 'Tenant requested a support correction',
          targetTenantId: 'tenant-1',
        });
        expect(capturedAudit?.['before']).toMatchObject({
          resourceId: 'tenant-1',
          resourceType: 'tenant',
          state: {
            name: 'Tenant before update',
            paymentsConfigured: true,
          },
        });
        expect(capturedAudit?.['after']).toMatchObject({
          resourceId: 'tenant-1',
          resourceType: 'tenant',
          state: {
            name: 'Tenant',
            paymentsConfigured: true,
          },
        });
        expect(tenant.paymentsConfigured).toBe(true);
      }),
  );

  it.effect(
    'blocks public URL migrations for pending Stripe links or active transfer offers after locking the tenant',
    () =>
      Effect.gen(function* () {
        const scenarios = [
          {
            activeRegistrationTransfers: false,
            pendingStripeObligations: true,
            reasonFragment: 'pending Stripe Checkout or refund',
          },
          {
            activeRegistrationTransfers: true,
            pendingStripeObligations: false,
            reasonFragment: 'active registration transfer',
          },
          {
            activeRegistrationTransfers: true,
            pendingStripeObligations: true,
            reasonFragment:
              'pending Stripe Checkout or refund and every active registration transfer',
          },
        ] as const;

        for (const scenario of scenarios) {
          const beforeTenant = {
            currency: 'EUR' as const,
            domain: 'tenant.example.com',
            id: 'tenant-1',
            name: 'Tenant',
            stripeAccountId: 'acct_current',
            theme: 'evorto' as const,
            timezone: 'Europe/Berlin' as const,
          };
          const lockTenant = vi.fn(() => Effect.succeed([beforeTenant]));
          const beforeSelect = {
            for: lockTenant,
            from: () => beforeSelect,
            where: () => beforeSelect,
          };
          const limitedSelect = (rows: readonly { id: string }[]) => {
            const query = {
              from: () => query,
              limit: () => Effect.succeed(rows),
              where: () => query,
            };
            return query;
          };
          const selectResults = [
            beforeSelect,
            limitedSelect(
              scenario.pendingStripeObligations
                ? [{ id: 'pending-checkout' }]
                : [],
            ),
            limitedSelect(
              scenario.activeRegistrationTransfers
                ? [{ id: 'active-transfer' }]
                : [],
            ),
          ];
          const select = vi.fn(() => {
            const result = selectResults.shift();
            if (!result) {
              throw new Error('unexpected select');
            }
            return result;
          });
          const update = vi.fn(() => {
            throw new Error('tenant update should not run');
          });
          const insert = vi.fn(() => {
            throw new Error('audit insert should not run');
          });
          const database = {
            insert,
            query: {
              tenants: {
                findFirst: () => Effect.succeed({ id: 'tenant-1' }),
              },
            },
            select,
            transaction: (operation: (transaction: object) => unknown) =>
              operation(database),
            update,
          };

          const error = yield* globalAdminHandlers[
            'globalAdmin.tenants.update'
          ](
            {
              expectedSettings: Schema.decodeUnknownSync(
                PlatformTenantSettingsSnapshot,
              )(beforeTenant),
              id: 'tenant-1',
              reason: 'Move the tenant to its verified replacement domain',
              tenant: {
                currency: 'EUR',
                domain: 'new.example.com',
                name: 'Tenant',
                theme: 'evorto',
                timezone: 'Europe/Berlin',
              },
            },
            createRpcOptions(
              GlobalAdminRpcs.GlobalAdminTenantsUpdate.middleware(
                RpcRequestContextMiddleware,
              ),
            ),
          )
            .pipe(Effect.provide(requestContextLayer(createRequestContext([]))))
            .pipe(Effect.provide(provideDatabase(database)), Effect.flip);

          expect(error._tag).toBe('GlobalAdminTenantUrlMigrationBlockedError');
          if (error._tag !== 'GlobalAdminTenantUrlMigrationBlockedError') {
            return yield* Effect.die(
              new Error('Expected a typed tenant URL migration error'),
            );
          }
          expect(error).toMatchObject({
            activeRegistrationTransfers: scenario.activeRegistrationTransfers,
            pendingStripeObligations: scenario.pendingStripeObligations,
            tenantId: 'tenant-1',
          });
          expect(error.reason).toContain(scenario.reasonFragment);
          expect(lockTenant).toHaveBeenCalledWith('update');
          expect(select).toHaveBeenCalledTimes(3);
          expect(update).not.toHaveBeenCalled();
          expect(insert).not.toHaveBeenCalled();
        }
      }),
  );

  it.effect(
    'blocks audited platform currency overrides when template prices already exist',
    () =>
      Effect.gen(function* () {
        const beforeTenant = {
          currency: 'EUR' as const,
          domain: 'tenant.example.com',
          id: 'tenant-1',
          name: 'Tenant',
          stripeAccountId: null,
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        };
        const beforeSelect = {
          for: () => Effect.succeed([beforeTenant]),
          from: () => beforeSelect,
          where: () => beforeSelect,
        };
        const update = vi.fn(() => {
          throw new Error('tenant update should not run');
        });
        const insert = vi.fn(() => {
          throw new Error('audit insert should not run');
        });
        const database = {
          insert,
          query: {
            eventInstances: {
              findFirst: () => {
                throw new Error(
                  'event query should not run after template hit',
                );
              },
            },
            eventTemplates: {
              findFirst: () => Effect.succeed({ id: 'template-1' }),
            },
            financeReceipts: {
              findFirst: () => {
                throw new Error(
                  'receipt query should not run after template hit',
                );
              },
            },
            tenants: {
              findFirst: () => Effect.succeed({ id: 'tenant-1' }),
            },
            transactions: {
              findFirst: () => {
                throw new Error(
                  'transaction query should not run after template hit',
                );
              },
            },
          },
          select: () => beforeSelect,
          transaction: (operation: (transaction: object) => unknown) =>
            operation(database),
          update,
        };

        const error = yield* globalAdminHandlers['globalAdmin.tenants.update'](
          {
            expectedSettings: Schema.decodeUnknownSync(
              PlatformTenantSettingsSnapshot,
            )(beforeTenant),
            id: 'tenant-1',
            reason: 'Switch the tenant to Australian dollars',
            tenant: {
              currency: 'AUD',
              domain: 'tenant.example.com',
              name: 'Tenant',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          createRpcOptions(
            GlobalAdminRpcs.GlobalAdminTenantsUpdate.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(Effect.provide(requestContextLayer(createRequestContext([]))))
          .pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'Currency cannot be changed after financial information has been added.',
        );
        if (error._tag !== 'RpcBadRequestError') {
          return yield* Effect.die(
            new Error('Expected a typed bad-request error'),
          );
        }
        expect(error.reason).toContain(
          'Keep the current currency to save these settings.',
        );
        expect(update).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'allows non-Stripe tenant edits when the connected account is unchanged',
    () =>
      Effect.gen(function* () {
        const beforeTenant = {
          currency: 'EUR',
          domain: 'tenant.example.com',
          id: 'tenant-1',
          name: 'Tenant before update',
          stripeAccountId: 'acct_current',
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        };
        const beforeSelect = {
          for: () => Effect.succeed([beforeTenant]),
          from: () => beforeSelect,
          where: () => beforeSelect,
        };
        const updateQuery = {
          returning: () =>
            Effect.succeed([{ ...beforeTenant, name: 'Tenant after update' }]),
          set: () => updateQuery,
          where: () => updateQuery,
        };
        const select = vi.fn(() => beforeSelect);
        const database = {
          insert: () => ({ values: () => Effect.void }),
          query: {
            tenants: {
              findFirst: () => Effect.succeed({ id: 'tenant-1' }),
            },
          },
          select,
          transaction: (operation: (transaction: object) => unknown) =>
            operation(database),
          update: () => updateQuery,
        };

        const tenant = yield* globalAdminHandlers['globalAdmin.tenants.update'](
          {
            expectedSettings: Schema.decodeUnknownSync(
              PlatformTenantSettingsSnapshot,
            )(beforeTenant),
            id: 'tenant-1',
            reason: 'Correct the tenant display name',
            tenant: {
              currency: 'EUR',
              domain: 'tenant.example.com',
              name: 'Tenant after update',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          createRpcOptions(
            GlobalAdminRpcs.GlobalAdminTenantsUpdate.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(Effect.provide(requestContextLayer(createRequestContext([]))))
          .pipe(Effect.provide(provideDatabase(database)));

        expect(tenant.name).toBe('Tenant after update');
        expect(select).toHaveBeenCalledTimes(1);
      }),
  );

  it.effect(
    'maps duplicate tenant domains to bad requests before updating',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            tenants: {
              findFirst: () => Effect.succeed({ id: 'other-tenant' }),
            },
          },
          update: () => {
            throw new Error('update should not run');
          },
        };

        const error = yield* globalAdminHandlers['globalAdmin.tenants.update'](
          {
            expectedSettings: platformTenantSettingsSnapshot(
              createRequestContext([]).tenant,
            ),
            id: 'tenant-1',
            reason: 'Tenant requested a domain correction',
            tenant: {
              currency: 'EUR',
              domain: 'Tenant.Example.com',
              name: 'Duplicate Tenant',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          createRpcOptions(
            GlobalAdminRpcs.GlobalAdminTenantsUpdate.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['globalAdmin:manageTenants']),
              ),
            ),
          )
          .pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe('Organization domain already exists');
        if (error._tag !== 'RpcBadRequestError') {
          return yield* Effect.die(
            new Error('Expected a typed bad-request error'),
          );
        }
        expect(error.reason).toBe('tenant.example.com');
      }),
  );

  it.effect('rejects invalid tenant domains before mutating tenants', () =>
    Effect.gen(function* () {
      const database = {
        insert: () => {
          throw new Error('database should not be touched');
        },
      };

      const error = yield* globalAdminHandlers['globalAdmin.tenants.create'](
        {
          initialPrivacyPolicy: {
            privacyPolicyText: 'Tenant privacy policy',
            privacyPolicyUrl: '',
          },
          reason: 'Provision requested by tenant board',
          tenant: {
            currency: 'EUR',
            domain: 'section.example.org/path',
            name: 'Section',
            theme: 'evorto',
            timezone: 'Europe/Berlin',
          },
        },
        createRpcOptions(
          GlobalAdminRpcs.GlobalAdminTenantsCreate.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(
              createRequestContext(['globalAdmin:manageTenants']),
            ),
          ),
        )
        .pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe('Invalid tenant settings');
    }),
  );

  it.effect(
    'rejects credential-like domains before deriving a trusted origin',
    () =>
      Effect.gen(function* () {
        const database = {
          insert: () => {
            throw new Error('database should not be touched');
          },
          query: {
            tenants: {
              findFirst: () =>
                Effect.fail(new Error('database should not be touched')),
            },
          },
        };

        const error = yield* globalAdminHandlers['globalAdmin.tenants.create'](
          {
            initialPrivacyPolicy: {
              privacyPolicyText: 'Tenant privacy policy',
              privacyPolicyUrl: '',
            },
            reason: 'Provision requested by tenant board',
            tenant: {
              currency: 'EUR',
              domain: 'section.example.org@attacker.invalid',
              name: 'Section',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          createRpcOptions(
            GlobalAdminRpcs.GlobalAdminTenantsCreate.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['globalAdmin:manageTenants']),
              ),
            ),
          )
          .pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe('Invalid tenant settings');
        if (error._tag !== 'RpcBadRequestError') {
          return yield* Effect.die(
            new Error('Expected a typed bad-request error'),
          );
        }
        expect(error.reason).toBe(
          'Enter the main website address only, for example section.example.org.',
        );
      }),
  );
  it.effect(
    'rejects stale platform settings against the locked row without an audit or write',
    () =>
      Effect.gen(function* () {
        const original = platformTenantSettingsSnapshot(
          createRequestContext([]).tenant,
        );
        const current = { ...original, id: 'tenant-1', theme: 'esn' as const };
        const write = vi.fn(() => {
          throw new Error('stale form must not write');
        });
        const lockedSelect = {
          for: vi.fn(() => Effect.succeed([current])),
          from: () => lockedSelect,
          where: () => lockedSelect,
        };
        const database = {
          insert: write,
          query: { tenants: { findFirst: () => Effect.succeed(current) } },
          select: () => lockedSelect,
          transaction: (operation: (transaction: object) => unknown) =>
            operation(database),
          update: write,
        };
        const error = yield* globalAdminHandlers['globalAdmin.tenants.update'](
          {
            expectedSettings: original,
            id: current.id,
            reason: 'Second editor correction',
            tenant: { ...original, name: 'Second editor name' },
          },
          createRpcOptions(
            GlobalAdminRpcs.GlobalAdminTenantsUpdate.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        ).pipe(
          Effect.provide(requestContextLayer(createRequestContext([]))),
          Effect.provide(provideDatabase(database)),
          Effect.flip,
        );
        expect(error._tag).toBe('TenantSettingsConflictError');
        expect(lockedSelect.for).toHaveBeenCalledWith('update');
        expect(write).not.toHaveBeenCalled();
      }),
  );
});
