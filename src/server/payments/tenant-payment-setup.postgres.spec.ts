import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer, Schema } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import Stripe from 'stripe';

import { databaseLayer } from '../../db/database.layer';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import { platformAuditEntries, tenants, transactions } from '../../db/schema';
import { StripeClient } from '../stripe-client';
import {
  attachTenantPaymentAccount,
  TenantPaymentSetupArguments,
  type TenantPaymentSetupOutcome,
} from './tenant-payment-setup';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

interface Fixture {
  readonly tenantId: string;
}
type StripeHttpRequestArguments = Parameters<
  InstanceType<typeof Stripe.HttpClient>['makeRequest']
>;

type TestDatabase = NodePgDatabase<typeof relations>;

class ReadyStripeAccountHttpClient extends Stripe.HttpClient {
  readonly requestedAccountIds: string[] = [];

  override getClientName(): string {
    return 'evorto-payment-setup-postgres-test';
  }

  override makeRequest(
    ...arguments_: StripeHttpRequestArguments
  ): Promise<ReadyStripeAccountResponse> {
    const [host, , path, method] = arguments_;
    const accountMatch = /^\/v1\/accounts\/([^/?]+)$/u.exec(path);
    if (host !== 'api.stripe.com' || method !== 'GET' || !accountMatch?.[1]) {
      return Promise.reject(
        new Error(`Unexpected Stripe request: ${method} ${host}${path}`),
      );
    }

    const accountId = decodeURIComponent(accountMatch[1]);
    this.requestedAccountIds.push(accountId);
    return Promise.resolve(
      new ReadyStripeAccountResponse({
        charges_enabled: true,
        details_submitted: true,
        id: accountId,
        object: 'account',
        payouts_enabled: true,
      }),
    );
  }
}

class ReadyStripeAccountResponse extends Stripe.HttpClientResponse {
  constructor(private readonly body: unknown) {
    super(200, { 'request-id': 'req_payment_setup_postgres' });
  }

  override getRawResponse(): unknown {
    return this.body;
  }

  override toJSON(): Promise<unknown> {
    return Promise.resolve(this.body);
  }
}

const makeDatabaseLayer = (url: string) =>
  databaseLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: Object.fromEntries([['DATABASE_URL', url]]),
        }),
      ),
    ),
  );

const makePaymentSetupLayer = (
  url: string,
  stripeHttpClient: ReadyStripeAccountHttpClient,
) =>
  Layer.mergeAll(
    makeDatabaseLayer(url),
    Layer.succeed(
      StripeClient,
      new Stripe('sk_test_payment_setup_postgres', {
        httpClient: stripeHttpClient,
        maxNetworkRetries: 0,
      }),
    ),
  );

const makeInput = ({
  accountId,
  domain,
  organizationId,
  reason,
}: {
  readonly accountId: string;
  readonly domain: string;
  readonly organizationId: string;
  readonly reason: string;
}): TenantPaymentSetupArguments =>
  Schema.decodeUnknownSync(TenantPaymentSetupArguments)({
    accountId,
    confirmation: 'attach-payment-account',
    expectedOrganizationDomain: domain,
    organizationId,
    reason,
  });

const waitForBlockedPaymentSetupLocks = async (
  pool: Pool,
  expectedCount: number,
): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%tenants%FOR UPDATE%'
    `);
    if (Number(blocked.rows[0]?.count ?? 0) >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for concurrent payment setup locks');
};

describe('tenant payment setup PostgreSQL serialization', () => {
  let database: TestDatabase;
  let pool: Pool;
  const fixtures: Fixture[] = [];

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    for (const fixture of fixtures.toReversed()) {
      await database
        .delete(platformAuditEntries)
        .where(eq(platformAuditEntries.targetTenantId, fixture.tenantId));
      await database
        .delete(transactions)
        .where(eq(transactions.tenantId, fixture.tenantId));
      await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
    }
    await pool.end();
  });

  it('serializes two concurrent first attachments so one wins and audits once', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = `setup-${suffix}`;
    const domain = `${suffix}.payment-setup.example`;
    const accountIds: readonly [string, string] = [
      `acct_first_${suffix}`,
      `acct_second_${suffix}`,
    ];
    const reasons: readonly [string, string] = [
      'Initial paid sign-up approval from the organization board',
      'Initial paid sign-up approval confirmed by the organization treasurer',
    ];
    fixtures.push({ tenantId });
    await database.insert(tenants).values({
      domain,
      id: tenantId,
      name: `Payment setup ${suffix}`,
    });

    const gate = await pool.connect();
    let gateOpen = false;
    let setupPromise: Promise<readonly TenantPaymentSetupOutcome[]> | undefined;
    try {
      await gate.query('BEGIN');
      gateOpen = true;
      await gate.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [
        tenantId,
      ]);

      const stripeHttpClient = new ReadyStripeAccountHttpClient();
      const inputs = accountIds.map((accountId, index) =>
        makeInput({
          accountId,
          domain,
          organizationId: tenantId,
          reason: reasons[index] ?? 'Initial paid sign-up approval',
        }),
      );
      setupPromise = Effect.runPromise(
        Effect.all(
          inputs.map((setupInput) => attachTenantPaymentAccount(setupInput)),
          { concurrency: 'unbounded' },
        ).pipe(
          Effect.provide(makePaymentSetupLayer(databaseUrl, stripeHttpClient)),
        ),
      );

      await waitForBlockedPaymentSetupLocks(pool, 2);
      await gate.query('COMMIT');
      gateOpen = false;

      const outcomes = await setupPromise;
      const winnerIndex = outcomes.findIndex((outcome) => outcome.attached);
      const winningAccountId = accountIds[winnerIndex];
      const winningReason = reasons[winnerIndex];
      if (!winningAccountId || !winningReason) {
        throw new Error('Concurrent payment setup produced no winner');
      }
      const loserIndex = winnerIndex === 0 ? 1 : 0;
      expect(outcomes.filter((outcome) => outcome.attached)).toHaveLength(1);
      expect(outcomes[loserIndex]).toEqual({
        attached: false,
        reason: 'already-configured',
      });
      expect(stripeHttpClient.requestedAccountIds.toSorted()).toEqual(
        accountIds.toSorted(),
      );

      const persistedTenant = await database.query.tenants.findFirst({
        where: { id: tenantId },
      });
      expect(persistedTenant?.stripeAccountId).toBe(winningAccountId);

      const auditRows = await database
        .select()
        .from(platformAuditEntries)
        .where(
          and(
            eq(platformAuditEntries.action, 'tenant.update'),
            eq(platformAuditEntries.targetTenantId, tenantId),
          ),
        );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        actorId: 'operations:payment-setup',
        after: {
          resourceId: tenantId,
          resourceType: 'tenant',
          state: { paymentsConfigured: true },
        },
        before: {
          resourceId: tenantId,
          resourceType: 'tenant',
          state: { paymentsConfigured: false },
        },
        reason: winningReason,
      });
      for (const accountId of accountIds) {
        expect(JSON.stringify(auditRows[0])).not.toContain(accountId);
      }
    } finally {
      if (gateOpen) {
        await gate.query('ROLLBACK').catch(() => null);
      }
      gate.release();
      await setupPromise?.catch(() => null);
    }
  }, 30_000);

  it('rejects a mismatched expected organization domain without a write or audit', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = `domain-${suffix}`;
    const domain = `${suffix}.expected-domain.example`;
    fixtures.push({ tenantId });
    await database.insert(tenants).values({
      domain,
      id: tenantId,
      name: `Domain check ${suffix}`,
    });

    const stripeHttpClient = new ReadyStripeAccountHttpClient();
    const outcome = await Effect.runPromise(
      attachTenantPaymentAccount(
        makeInput({
          accountId: `acct_domain_${suffix}`,
          domain: `different-${domain}`,
          organizationId: tenantId,
          reason: 'Initial paid sign-up approval after organization review',
        }),
      ).pipe(
        Effect.provide(makePaymentSetupLayer(databaseUrl, stripeHttpClient)),
      ),
    );

    expect(outcome).toEqual({
      attached: false,
      reason: 'organization-domain-mismatch',
    });
    expect(
      await database.query.tenants.findFirst({ where: { id: tenantId } }),
    ).toMatchObject({ stripeAccountId: null });
    expect(
      await database
        .select({ id: platformAuditEntries.id })
        .from(platformAuditEntries)
        .where(eq(platformAuditEntries.targetTenantId, tenantId)),
    ).toEqual([]);
  });

  it('rejects directly seeded pending payment work', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = `pending-${suffix}`;
    const transactionId = `refund-${suffix}`;
    const domain = `${suffix}.pending-payment.example`;
    fixtures.push({ tenantId });
    await database.insert(tenants).values({
      domain,
      id: tenantId,
      name: `Pending payment ${suffix}`,
    });
    await database.insert(transactions).values({
      amount: -1000,
      currency: 'EUR',
      id: transactionId,
      manuallyCreated: true,
      method: 'stripe',
      status: 'pending',
      stripeAccountId: `acct_previous_${suffix}`,
      tenantId,
      type: 'refund',
    });

    const stripeHttpClient = new ReadyStripeAccountHttpClient();
    const outcome = await Effect.runPromise(
      attachTenantPaymentAccount(
        makeInput({
          accountId: `acct_new_${suffix}`,
          domain,
          organizationId: tenantId,
          reason: 'Initial paid sign-up approval after payment review',
        }),
      ).pipe(
        Effect.provide(makePaymentSetupLayer(databaseUrl, stripeHttpClient)),
      ),
    );

    expect(outcome).toEqual({
      attached: false,
      reason: 'payment-in-progress',
    });
    expect(
      await database.query.tenants.findFirst({ where: { id: tenantId } }),
    ).toMatchObject({ stripeAccountId: null });
    expect(
      await database
        .select({ id: platformAuditEntries.id })
        .from(platformAuditEntries)
        .where(eq(platformAuditEntries.targetTenantId, tenantId)),
    ).toEqual([]);
  });
});
