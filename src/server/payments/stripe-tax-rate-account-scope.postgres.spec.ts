import type Stripe from 'stripe';

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from '@effect/vitest';
import { eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Cause, ConfigProvider, Effect, Exit, Layer, Schema } from 'effect';
import { Headers } from 'effect/unstable/http';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { Pool } from 'pg';

import { databaseLayer } from '../../db';
import { createId } from '../../db/create-id';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import {
  platformAuditEntries,
  tenants,
  tenantStripeTaxRates,
} from '../../db/schema';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../shared/rpc-contracts/app-rpcs';
import {
  AdminTenantImportStripeTaxRates,
  AdminTenantListImportedTaxRates,
} from '../../shared/rpc-contracts/app-rpcs/admin.rpcs';
import { PlatformAdministratorAuthority } from '../../types/custom/platform-authority';
import { Tenant } from '../../types/custom/tenant';
import { adminHandlers } from '../effect/rpc/handlers/admin.handlers';
import { platformTenantAdminHandlers } from '../effect/rpc/handlers/platform/platform-tenant-admin.handlers';
import { RpcAccess } from '../effect/rpc/handlers/shared/rpc-access.service';
import { StripeClient } from '../stripe-client';
import { createRejectingStripeClient } from '../testing/stripe-test-fixtures';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl)
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const rate = (id: string): Stripe.TaxRate => ({
  active: true,
  country: 'DE',
  created: 1_750_000_000,
  description: null,
  display_name: id,
  effective_percentage: 19,
  flat_amount: null,
  id,
  inclusive: true,
  jurisdiction: null,
  jurisdiction_level: null,
  livemode: false,
  metadata: {},
  object: 'tax_rate',
  percentage: 19,
  rate_type: null,
  state: null,
  tax_type: 'vat',
});
const lastResponse = {
  headers: {},
  requestId: 'req_tax_fixture',
  statusCode: 200,
};
const contextFor = (tenant: Tenant, platform: boolean) =>
  ({
    authData: {},
    authenticated: true,
    permissions: ['admin:tax'],
    platformAuthority: platform
      ? PlatformAdministratorAuthority.make({
          actorEmail: 'platform@example.com',
          actorId: 'auth0|tax-import-test',
          kind: 'platformAdministrator',
        })
      : null,
    tenant,
    user: null,
    userAssigned: false,
  }) satisfies RpcRequestContextShape;
const requestOptions = () => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
});

describe('tax import account ownership', () => {
  let pool: Pool;
  let database: NodePgDatabase<typeof relations>;
  const tenantIds: string[] = [];
  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });
  afterEach(async () => {
    await database
      .delete(platformAuditEntries)
      .where(inArray(platformAuditEntries.targetTenantId, tenantIds));
    await database
      .delete(tenantStripeTaxRates)
      .where(inArray(tenantStripeTaxRates.tenantId, tenantIds));
    await database.delete(tenants).where(inArray(tenants.id, tenantIds));
    tenantIds.length = 0;
  });
  afterAll(async () => {
    await pool.end();
  });

  it.each(['tenant', 'platform'] as const)(
    'keeps %s imports and catalogs within the current account',
    async (actor) => {
      const tenantId = createId();
      const otherTenantId = createId();
      tenantIds.push(tenantId, otherTenantId);
      const originalAccount = 'acct_original';
      const currentAccount = 'acct_current';
      await database.insert(tenants).values([
        {
          domain: `${tenantId}.tax.example`,
          id: tenantId,
          name: 'Tax import',
          stripeAccountId: originalAccount,
        },
        {
          domain: `${otherTenantId}.tax.example`,
          id: otherTenantId,
          name: 'Other tax import',
          stripeAccountId: currentAccount,
        },
      ]);
      const readTenant = async () =>
        Schema.decodeUnknownSync(Tenant)(
          await database.query.tenants.findFirst({ where: { id: tenantId } }),
        );
      const originalTenant = await readTenant();
      const stripe = createRejectingStripeClient();
      const retrieve = vi
        .spyOn(stripe.taxRates, 'retrieve')
        .mockImplementation(async (id) => ({ ...rate(id), lastResponse }));
      const list = vi.spyOn(stripe.taxRates, 'list').mockResolvedValue({
        data: ['txr_current', 'txr_old', 'txr_other_tenant'].map((id) =>
          rate(id),
        ),
        has_more: false,
        lastResponse,
        object: 'list',
        url: '/v1/tax_rates',
      });
      const config = ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: { DATABASE_TLS_REQUIRED: 'false', DATABASE_URL: databaseUrl },
        }),
      );
      const layer = Layer.mergeAll(
        config,
        databaseLayer.pipe(Layer.provide(config)),
        RpcAccess.Default,
        Layer.succeed(StripeClient, stripe),
      );
      const importRates = (tenant: Tenant) =>
        Effect.runPromiseExit(
          (actor === 'platform'
            ? platformTenantAdminHandlers['platform.taxRates.import'](
                {
                  ids: ['txr_current'],
                  reason: 'Import reviewed rates',
                  targetTenantId: tenantId,
                },
                undefined,
              )
            : adminHandlers['admin.tenant.importStripeTaxRates'](
                { ids: ['txr_current'] },
                {
                  ...requestOptions(),
                  rpc: AdminTenantImportStripeTaxRates.middleware(
                    RpcRequestContextMiddleware,
                  ),
                },
              )
          ).pipe(
            Effect.provideService(
              RpcRequestContext,
              contextFor(tenant, actor === 'platform'),
            ),
            Effect.provide(layer),
          ),
        );
      const rows = () =>
        database.query.tenantStripeTaxRates.findMany({ where: { tenantId } });
      const audit = () =>
        database.query.platformAuditEntries.findMany({
          where: { targetTenantId: tenantId },
        });
      const client = await pool.connect();
      let transactionOpen = false;
      let settle = Promise.resolve();
      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const backend = await client.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const pid = backend.rows[0]?.pid;
        if (!pid) throw new Error('Missing account writer backend');
        await client.query(
          'UPDATE tenants SET "stripeAccountId" = $1 WHERE id = $2',
          [currentAccount, tenantId],
        );
        const pending = importRates(originalTenant);
        settle = pending.then(() => {
          /* Await the import before releasing fixture ownership. */
        });
        const deadline = Date.now() + 10_000;
        let blocked = false;
        while (Date.now() < deadline) {
          const result = await pool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND $1::int = ANY(pg_blocking_pids(pid))`,
            [pid],
          );
          if (Number(result.rows[0]?.count) === 1) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await client.query('COMMIT');
        transactionOpen = false;
        const outcome = await pending;
        if (Exit.isSuccess(outcome))
          throw new Error('Imported rates from the obsolete account');
        expect(Cause.pretty(outcome.cause)).toContain(
          'Tenant Stripe account changed during tax-rate import',
        );
        expect(await rows()).toEqual([]);
        expect(await audit()).toEqual([]);
        expect(retrieve).toHaveBeenCalledWith('txr_current', undefined, {
          stripeAccount: originalAccount,
        });
      } finally {
        try {
          if (transactionOpen) {
            await client.query('ROLLBACK');
            transactionOpen = false;
          }
        } finally {
          try {
            client.release(transactionOpen);
          } finally {
            await settle;
          }
        }
      }
      const tenant = await readTenant();
      await database.insert(tenantStripeTaxRates).values({
        active: true,
        inclusive: true,
        percentage: '7',
        stripeAccountId: 'acct_conflicting',
        stripeTaxRateId: 'txr_current',
        tenantId,
      });
      const conflicting = await rows();
      const conflict = await importRates(tenant);
      if (Exit.isSuccess(conflict))
        throw new Error('Reassigned an imported tax rate to another account');
      expect(Cause.pretty(conflict.cause)).toContain(
        'Stored tax-rate account does not match the tenant account',
      );
      expect(await rows()).toEqual(conflicting);
      expect(await audit()).toEqual([]);
      await database
        .delete(tenantStripeTaxRates)
        .where(eq(tenantStripeTaxRates.tenantId, tenantId));
      const success = await importRates(tenant);
      if (Exit.isFailure(success)) throw Cause.squash(success.cause);
      expect(await rows()).toEqual([
        expect.objectContaining({
          active: true,
          inclusive: true,
          percentage: '19',
          stripeAccountId: currentAccount,
          stripeTaxRateId: 'txr_current',
          tenantId,
        }),
      ]);
      const importedAudit = await audit();
      expect(importedAudit).toHaveLength(actor === 'platform' ? 1 : 0);
      if (actor === 'platform')
        expect(importedAudit[0]).toMatchObject({
          action: 'taxRates.import',
          actorId: 'auth0|tax-import-test',
          reason: 'Import reviewed rates',
          targetTenantId: tenantId,
        });
      await database.insert(tenantStripeTaxRates).values([
        {
          active: true,
          inclusive: true,
          percentage: '19',
          stripeAccountId: originalAccount,
          stripeTaxRateId: 'txr_old',
          tenantId,
        },
        {
          active: true,
          inclusive: true,
          percentage: '19',
          stripeAccountId: currentAccount,
          stripeTaxRateId: 'txr_other_tenant',
          tenantId: otherTenantId,
        },
      ]);
      const imported = await Effect.runPromise(
        adminHandlers['admin.tenant.listImportedTaxRates'](undefined, {
          ...requestOptions(),
          rpc: AdminTenantListImportedTaxRates.middleware(
            RpcRequestContextMiddleware,
          ),
        }).pipe(
          Effect.provideService(RpcRequestContext, contextFor(tenant, false)),
          Effect.provide(layer),
        ),
      );
      expect(imported.map(({ stripeTaxRateId }) => stripeTaxRateId)).toEqual([
        'txr_current',
      ]);
      const catalog = await Effect.runPromise(
        platformTenantAdminHandlers['platform.taxRates.listStripe'](
          { targetTenantId: tenantId },
          undefined,
        ).pipe(
          Effect.provideService(RpcRequestContext, contextFor(tenant, true)),
          Effect.provide(layer),
        ),
      );
      expect(catalog.map(({ id, imported }) => ({ id, imported }))).toEqual([
        { id: 'txr_current', imported: true },
        { id: 'txr_old', imported: false },
        { id: 'txr_other_tenant', imported: false },
      ]);
      expect(list).toHaveBeenCalledWith(expect.any(Object), {
        stripeAccount: currentAccount,
      });
    },
    20_000,
  );
});
