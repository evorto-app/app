import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

import { databaseLayer } from '../../../../../db/database.layer';
import { createNodePgPoolConfig } from '../../../../../db/pg-connection-config';
import { relations } from '../../../../../db/relations';
import {
  eventInstances,
  eventTemplateCategories,
  eventTemplates,
  financeReceipts,
  financeReceiptUploads,
  tenants,
  transactions,
  users,
} from '../../../../../db/schema';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from '../shared/rpc-access.service';
import { financeHandlers } from './finance.handlers';
import { buildReceiptStorageKey } from './receipt-media.service';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const lockObservationTimeoutMs = 30_000;
const lockPollIntervalMs = 50;
const postgresConcurrencyTestTimeoutMs = 60_000;

type TestDatabase = NodePgDatabase<typeof relations>;

const makeDatabaseServiceLayer = (url: string) =>
  databaseLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: Object.fromEntries([['DATABASE_URL', url]]),
        }),
      ),
    ),
  );

const waitForBlockedReceiptLock = async (pool: Pool, blockingPid: number) => {
  const deadline = Date.now() + lockObservationTimeoutMs;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM pg_stat_activity AS activity
      WHERE activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND activity.state = 'active'
        AND activity.wait_event_type = 'Lock'
        AND $1::int = ANY(pg_blocking_pids(activity.pid))
    `,
      [blockingPid],
    );
    if (Number(blocked.rows[0]?.count ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, lockPollIntervalMs));
  }
  throw new Error('Timed out waiting for blocked finance receipt lock');
};

const readBackendPid = async (client: PoolClient): Promise<number> => {
  const result = await client.query<{ pid: number }>(
    'SELECT pg_backend_pid() AS pid',
  );
  const pid = result.rows[0]?.pid;
  if (!Number.isInteger(pid)) {
    throw new TypeError('PostgreSQL lock holder has no backend PID');
  }
  return pid;
};

describe('receipt review and reimbursement serialization', () => {
  let database: TestDatabase;
  let pool: Pool;
  const categoryIds: string[] = [];
  const eventIds: string[] = [];
  const receiptIds: string[] = [];
  const receiptUploadIds: string[] = [];
  const templateIds: string[] = [];
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const handlerOperations: Promise<boolean>[] = [];

  const trackHandlerOperation = <A>(operation: Promise<A>): Promise<A> => {
    handlerOperations.push(
      operation.then(
        () => true,
        () => false,
      ),
    );
    return operation;
  };

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    await Promise.all(handlerOperations);
    await database
      .delete(financeReceipts)
      .where(inArray(financeReceipts.id, receiptIds));
    await database
      .delete(financeReceiptUploads)
      .where(inArray(financeReceiptUploads.id, receiptUploadIds));
    await database
      .delete(transactions)
      .where(inArray(transactions.tenantId, tenantIds));
    await database
      .delete(eventInstances)
      .where(inArray(eventInstances.id, eventIds));
    await database
      .delete(eventTemplates)
      .where(inArray(eventTemplates.id, templateIds));
    await database
      .delete(eventTemplateCategories)
      .where(inArray(eventTemplateCategories.id, categoryIds));
    await database.delete(users).where(inArray(users.id, userIds));
    await database.delete(tenants).where(inArray(tenants.id, tenantIds));
    await pool.end();
  }, postgresConcurrencyTestTimeoutMs);

  const seedReceipt = async (status: 'approved' | 'submitted') => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = `rf-tenant-${suffix}`.slice(0, 20);
    const userId = `rf-user-${suffix}`.slice(0, 20);
    const categoryId = `rf-category-${suffix}`.slice(0, 20);
    const templateId = `rf-template-${suffix}`.slice(0, 20);
    const eventId = `rf-event-${suffix}`.slice(0, 20);
    const receiptId = `rf-receipt-${suffix}`.slice(0, 20);
    const receiptUploadId = `rf-upload-${suffix}`.slice(0, 20);
    tenantIds.push(tenantId);
    userIds.push(userId);
    categoryIds.push(categoryId);
    templateIds.push(templateId);
    eventIds.push(eventId);
    receiptIds.push(receiptId);
    receiptUploadIds.push(receiptUploadId);

    await database.insert(tenants).values({
      currency: 'CZK',
      domain: `${suffix}.receipt-lock.example`,
      id: tenantId,
      name: `Receipt lock ${suffix}`,
    });
    await database.insert(users).values({
      auth0Id: `auth0|receipt-lock-${suffix}`,
      communicationEmail: `receipt-lock-${suffix}@example.com`,
      email: `receipt-lock-${suffix}@example.com`,
      firstName: 'Receipt',
      homeTenantId: tenantId,
      iban: 'NL91ABNA0417164300',
      id: userId,
      lastName: 'Lock',
    });
    await database.insert(eventTemplateCategories).values({
      icon: { iconColor: 0, iconName: 'circle' },
      id: categoryId,
      tenantId,
      title: 'Receipt lock category',
    });
    await database.insert(eventTemplates).values({
      categoryId,
      description: 'Receipt lock template',
      icon: { iconColor: 0, iconName: 'circle' },
      id: templateId,
      tenantId,
      title: 'Receipt lock template',
    });
    await database.insert(eventInstances).values({
      creatorId: userId,
      description: 'Receipt lock event',
      end: new Date('2026-08-01T12:00:00.000Z'),
      icon: { iconColor: 0, iconName: 'circle' },
      id: eventId,
      start: new Date('2026-08-01T10:00:00.000Z'),
      status: 'APPROVED',
      templateId,
      tenantId,
      title: 'Receipt lock event',
    });
    const receiptUploadedAt = new Date('2026-07-31T00:00:00.000Z');
    await database.insert(financeReceiptUploads).values({
      consumedAt: receiptUploadedAt,
      eventId,
      fileName: 'receipt.png',
      id: receiptUploadId,
      mimeType: 'image/png',
      sizeBytes: 7,
      status: 'consumed',
      storageKey: buildReceiptStorageKey({
        contentDigest: createHash('sha256')
          .update(receiptUploadId)
          .digest('hex'),
        eventId,
        fileName: 'receipt.png',
        tenantId,
        uploadId: receiptUploadId,
        userId,
      }),
      storageUrl: 'https://storage.example.test/receipt.png',
      tenantId,
      uploadedAt: receiptUploadedAt,
      uploadedByUserId: userId,
    });
    await database.insert(financeReceipts).values({
      attachmentFileName: 'receipt.png',
      attachmentMimeType: 'image/png',
      attachmentSizeBytes: 7,
      attachmentUploadId: receiptUploadId,
      currency: 'CZK',
      eventId,
      id: receiptId,
      purchaseCountry: 'NL',
      receiptDate: new Date('2026-07-31T00:00:00.000Z'),
      status,
      submittedByUserId: userId,
      tenantId,
      totalAmount: 100,
    });

    const tenant = {
      currency: 'CZK' as const,
      defaultLocation: null,
      discountProviders: {
        esnCard: { config: {}, status: 'disabled' as const },
      },
      domain: `${suffix}.receipt-lock.example`,
      id: tenantId,
      locale: 'de-DE',
      name: `Receipt lock ${suffix}`,
      receiptSettings: { allowOther: false, receiptCountries: ['NL'] },
      stripeAccountId: null,
      theme: 'evorto' as const,
      timezone: 'Europe/Berlin',
    };
    const user = {
      attributes: [],
      auth0Id: `auth0|receipt-lock-${suffix}`,
      communicationEmail: `receipt-lock-${suffix}@example.com`,
      email: `receipt-lock-${suffix}@example.com`,
      firstName: 'Receipt',
      iban: 'NL91ABNA0417164300',
      id: userId,
      lastName: 'Lock',
      paypalEmail: null,
      permissions: [
        'finance:approveReceipts',
        'finance:refundReceipts',
      ] as const,
      roleIds: [],
    };
    const requestContext = {
      authData: {},
      authenticated: true,
      permissions: user.permissions,
      tenant,
      user,
      userAssigned: true,
    } satisfies RpcRequestContextShape;
    const handlerLayer = Layer.mergeAll(
      RpcAccess.Default,
      Layer.succeed(RpcRequestContext, requestContext),
      makeDatabaseServiceLayer(databaseUrl),
    );

    return { eventId, handlerLayer, receiptId, tenantId, userId };
  };

  it(
    're-reads the locked amount and currency before inserting the reimbursement ledger row',
    async () => {
      const fixture = await seedReceipt('approved');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const blockingPid = await readBackendPid(client);
        await client.query(
          'SELECT id FROM finance_receipts WHERE id = $1 FOR UPDATE',
          [fixture.receiptId],
        );
        await client.query(
          'UPDATE finance_receipts SET "totalAmount" = 200 WHERE id = $1',
          [fixture.receiptId],
        );

        const refund = trackHandlerOperation(
          Effect.runPromise(
            financeHandlers['finance.receipts.createRefund'](
              {
                payoutReference: 'NL91ABNA0417164300',
                payoutType: 'iban',
                receiptIds: [fixture.receiptId],
              },
              { headers: {} } as never,
            ).pipe(Effect.provide(fixture.handlerLayer)),
          ),
        );

        await waitForBlockedReceiptLock(pool, blockingPid);
        await client.query('COMMIT');
        const result = await refund;

        expect(result.totalAmount).toBe(200);
        expect(
          await database.query.transactions.findFirst({
            columns: { amount: true, currency: true },
            where: { id: result.transactionId },
          }),
        ).toEqual({ amount: -200, currency: 'CZK' });
        expect(
          await database.query.financeReceipts.findFirst({
            columns: { status: true, totalAmount: true },
            where: { id: fixture.receiptId },
          }),
        ).toEqual({ status: 'refunded', totalAmount: 200 });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
      } finally {
        client.release();
      }
    },
    postgresConcurrencyTestTimeoutMs,
  );

  it(
    'rejects a stale rejection that waits behind a concurrent reimbursement transition',
    async () => {
      const fixture = await seedReceipt('approved');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const blockingPid = await readBackendPid(client);
        await client.query(
          'SELECT id FROM finance_receipts WHERE id = $1 FOR UPDATE',
          [fixture.receiptId],
        );
        await client.query(
          "UPDATE finance_receipts SET status = 'refunded' WHERE id = $1",
          [fixture.receiptId],
        );

        const review = trackHandlerOperation(
          Effect.runPromise(
            financeHandlers['finance.receipts.review'](
              {
                alcoholAmount: 0,
                depositAmount: 0,
                hasAlcohol: false,
                hasDeposit: false,
                id: fixture.receiptId,
                purchaseCountry: 'NL',
                receiptDate: '2026-07-31',
                rejectionReason: 'The receipt should be rejected',
                status: 'rejected',
                taxAmount: 20,
                totalAmount: 300,
              },
              { headers: {} } as never,
            ).pipe(Effect.flip, Effect.provide(fixture.handlerLayer)),
          ),
        );

        await waitForBlockedReceiptLock(pool, blockingPid);
        await client.query('COMMIT');
        const error = await review;

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'refundedReceipt',
        });
        expect(
          await database.query.financeReceipts.findFirst({
            columns: { status: true, totalAmount: true },
            where: { id: fixture.receiptId },
          }),
        ).toEqual({ status: 'refunded', totalAmount: 100 });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
      } finally {
        client.release();
      }
    },
    postgresConcurrencyTestTimeoutMs,
  );
});
