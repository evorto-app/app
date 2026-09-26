import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Headers } from 'effect/unstable/http';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

import { createId } from '../../../../../db/create-id';
import { databaseLayer } from '../../../../../db/database.layer';
import { createNodePgPoolConfig } from '../../../../../db/pg-connection-config';
import { relations } from '../../../../../db/relations';
import {
  emailOutbox,
  eventInstances,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  financeReceiptAlcoholAmountConsistentCheckName,
  financeReceiptComponentsWithinTotalCheckName,
  financeReceiptDepositAmountConsistentCheckName,
  financeReceipts,
  financeReceiptTaxAmountValidCheckName,
  financeReceiptTotalAmountPositiveCheckName,
  financeReceiptUploads,
  platformAuditEntries,
  tenants,
  transactions,
  users,
} from '../../../../../db/schema';
import { RpcInternalServerError } from '../../../../../shared/errors/rpc-errors';
import {
  AppRpcs,
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import {
  PlatformFinanceReceiptApprovalDetail,
  PlatformFinanceReceiptApprovalQueue,
  PlatformFinanceReceiptReview,
  PlatformFinanceRefundRecoveryQueue,
  PlatformFinanceReimbursementQueue,
} from '../../../../../shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';
import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { processReceiptOrphans } from '../../../../finance/receipt-orphan-cleanup';
import {
  ObjectStorage,
  ObjectStorageNotFoundError,
} from '../../../../integrations/object-storage';
import { platformTenantFinanceHandlers } from '../platform/platform-tenant-finance.handlers';
import { RpcAccess } from '../shared/rpc-access.service';
import { financeHandlers } from './finance.handlers';
import {
  buildReceiptStorageKey,
  buildReceiptUploadStorageKey,
  ReceiptMediaService,
} from './receipt-media.service';

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
          env: Object.fromEntries([
            ['DATABASE_TLS_REQUIRED', 'false'],
            ['DATABASE_URL', url],
          ]),
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
      .delete(emailOutbox)
      .where(inArray(emailOutbox.tenantId, tenantIds));
    await database
      .delete(platformAuditEntries)
      .where(inArray(platformAuditEntries.targetTenantId, tenantIds));
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
      .delete(eventRegistrations)
      .where(inArray(eventRegistrations.tenantId, tenantIds));
    await database
      .delete(eventRegistrationOptions)
      .where(inArray(eventRegistrationOptions.eventId, eventIds));
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
      reviewedAt: new Date(),
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
      tenantId,
      uploadedAt: receiptUploadedAt,
      uploadedByUserId: userId,
    });
    await database.insert(financeReceipts).values({
      alcoholAmount: 0,
      attachmentFileName: 'receipt.png',
      attachmentUploadId: receiptUploadId,
      currency: 'CZK',
      depositAmount: 0,
      eventId,
      hasAlcohol: false,
      hasDeposit: false,
      id: receiptId,
      purchaseCountry: 'NL',
      receiptDate: '2026-07-31',
      status,
      submittedByUserId: userId,
      taxAmount: 0,
      tenantId,
      totalAmount: 100,
    });

    const tenant = {
      cancellationDeadlineHoursBeforeStart: 120,
      currency: 'CZK' as const,
      defaultLocation: undefined,
      discountProviders: {
        esnCard: { config: {}, status: 'disabled' as const },
      },
      domain: `${suffix}.receipt-lock.example`,
      id: tenantId,
      maxActiveRegistrationsPerUser: 0,
      name: `Receipt lock ${suffix}`,
      receiptSettings: { allowOther: false, receiptCountries: ['NL'] },
      refundFeesOnCancellation: true,
      stripeAccountId: null,
      theme: 'evorto' as const,
      timezone: 'Europe/Berlin',
      transferDeadlineHoursBeforeStart: 0,
    };
    const user = {
      auth0Id: `auth0|receipt-lock-${suffix}`,
      communicationEmail: `receipt-lock-${suffix}@example.com`,
      email: `receipt-lock-${suffix}@example.com`,
      firstName: 'Receipt',
      homeTenantId: undefined,
      homeTenantName: undefined,
      iban: 'NL91ABNA0417164300',
      id: userId,
      lastName: 'Lock',
      paypalEmail: undefined,
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
      Layer.succeed(ReceiptMediaService, {
        createUploadPolicy: () =>
          Effect.die(new Error('Unexpected receipt upload')),
        discardPromotedUpload: () =>
          Effect.die(new Error('Unexpected receipt discard')),
        inspectUpload: () =>
          Effect.die(new Error('Unexpected receipt inspection')),
        objectExists: () => Effect.die(new Error('Unexpected receipt lookup')),
        promoteUpload: () =>
          Effect.die(new Error('Unexpected upload promotion')),
        signedPreviewUrl: () =>
          Effect.die(new Error('Unexpected receipt preview')),
      }),
      Layer.succeed(RpcRequestContext, requestContext),
      makeDatabaseServiceLayer(databaseUrl),
    );

    return {
      eventId,
      handlerLayer,
      receiptId,
      receiptUploadId,
      requestContext,
      tenantId,
      userId,
    };
  };

  it('rejects reused or foreign receipt evidence and foreign reimbursement links', async () => {
    const target = await seedReceipt('submitted');
    const foreign = await seedReceipt('submitted');
    const receipt = await database.query.financeReceipts.findFirst({
      where: { id: target.receiptId },
    });
    const targetUpload = await database.query.financeReceiptUploads.findFirst({
      where: { id: target.receiptUploadId },
    });
    const foreignUpload = await database.query.financeReceiptUploads.findFirst({
      where: { id: foreign.receiptUploadId },
    });
    if (!receipt || !targetUpload || !foreignUpload)
      throw new Error('Missing receipt ownership fixture');
    for (const owner of [
      foreignUpload,
      { ...targetUpload, uploadedByUserId: foreign.userId },
    ]) {
      const id = createId();
      receiptUploadIds.push(id);
      await database
        .insert(financeReceiptUploads)
        .values({ ...owner, id, storageKey: `${owner.storageKey}-${id}` });
      await expect(
        database
          .update(financeReceipts)
          .set({ attachmentUploadId: id })
          .where(eq(financeReceipts.id, target.receiptId)),
      ).rejects.toMatchObject({
        cause: {
          code: '23503',
          constraint: 'finance_receipts_attachment_upload_scope_fk',
        },
      });
    }
    const duplicateId = createId();
    receiptIds.push(duplicateId);
    await expect(
      database.insert(financeReceipts).values({ ...receipt, id: duplicateId }),
    ).rejects.toMatchObject({
      cause: {
        code: '23505',
        constraint: 'finance_receipts_attachment_upload_unique',
      },
    });
    const transactionId = createId();
    await database.insert(transactions).values({
      amount: -100,
      currency: 'CZK',
      id: transactionId,
      method: 'transfer',
      status: 'successful',
      tenantId: foreign.tenantId,
      type: 'other',
    });
    await expect(
      database
        .update(financeReceipts)
        .set({ refundTransactionId: transactionId })
        .where(eq(financeReceipts.id, target.receiptId)),
    ).rejects.toMatchObject({
      cause: {
        code: '23503',
        constraint: 'finance_receipts_refund_transaction_tenant_fk',
      },
    });
    expect(
      await database.query.financeReceipts.findFirst({
        columns: { attachmentUploadId: true, refundTransactionId: true },
        where: { id: target.receiptId },
      }),
    ).toEqual({
      attachmentUploadId: target.receiptUploadId,
      refundTransactionId: null,
    });
  });

  it('scopes platform receipt queues and detail reads to the selected tenant', async () => {
    const target = await seedReceipt('submitted');
    const foreign = await seedReceipt('submitted');
    const platformAuthority = PlatformAdministratorAuthority.make({
      actorEmail: 'platform@example.org',
      actorId: 'auth0|receipt-platform-admin',
      kind: 'platformAdministrator',
    });
    const context = {
      ...target.requestContext,
      authData: { sub: platformAuthority.actorId },
      permissions: [],
      platformAuthority,
      user: null,
      userAssigned: false,
    } satisfies RpcRequestContextShape;
    const options = {
      client: new Rpc.ServerClient(1),
      headers: Headers.empty,
      requestId: RpcMessage.RequestId(1),
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* platformTenantFinanceHandlers[
          'platform.finance.receipts.approvalQueue'
        ](
          { targetTenantId: target.tenantId },
          {
            ...options,
            rpc: PlatformFinanceReceiptApprovalQueue.middleware(
              RpcRequestContextMiddleware,
            ),
          },
        );
        expect(queue.tenantContext.targetTenantId).toBe(target.tenantId);
        expect(
          queue.groups.flatMap((group) =>
            group.receipts.map((receipt) => receipt.id),
          ),
        ).toEqual([target.receiptId]);

        const foreignDetail = yield* platformTenantFinanceHandlers[
          'platform.finance.receipts.approvalDetail'
        ](
          { id: foreign.receiptId, targetTenantId: target.tenantId },
          {
            ...options,
            rpc: PlatformFinanceReceiptApprovalDetail.middleware(
              RpcRequestContextMiddleware,
            ),
          },
        ).pipe(Effect.flip);
        expect(foreignDetail).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'receiptNotFound',
        });

        yield* Effect.promise(() =>
          database
            .update(financeReceipts)
            .set({ status: 'approved' })
            .where(
              inArray(financeReceipts.id, [
                target.receiptId,
                foreign.receiptId,
              ]),
            ),
        );
        const reimbursements = yield* platformTenantFinanceHandlers[
          'platform.finance.receipts.reimbursementQueue'
        ](
          { targetTenantId: target.tenantId },
          {
            ...options,
            rpc: PlatformFinanceReimbursementQueue.middleware(
              RpcRequestContextMiddleware,
            ),
          },
        );
        expect(reimbursements.tenantContext.targetTenantId).toBe(
          target.tenantId,
        );
        expect(
          reimbursements.groups.flatMap((group) =>
            group.receipts.map((receipt) => receipt.id),
          ),
        ).toEqual([target.receiptId]);
      }).pipe(
        Effect.provideService(RpcRequestContext, context),
        Effect.provide(target.handlerLayer),
      ),
    );
  });

  it('rejects changed evidence after storage validation but allows rejection without storage', async () => {
    const fixture = await seedReceipt('submitted');
    const platformAuthority = PlatformAdministratorAuthority.make({
      actorEmail: 'platform@example.org',
      actorId: 'auth0|receipt-platform-admin',
      kind: 'platformAdministrator',
    });
    const context = {
      ...fixture.requestContext,
      authData: { sub: platformAuthority.actorId },
      permissions: [],
      platformAuthority,
      user: null,
      userAssigned: false,
    } satisfies RpcRequestContextShape;
    const fields = {
      alcoholAmount: 0,
      depositAmount: 0,
      hasAlcohol: false,
      hasDeposit: false,
      id: fixture.receiptId,
      purchaseCountry: 'NL',
      reason: 'Review the submitted receipt',
      receiptDate: '2026-07-31',
      targetTenantId: fixture.tenantId,
      taxAmount: 0,
      totalAmount: 100,
    };
    const options = {
      client: new Rpc.ServerClient(1),
      headers: Headers.empty,
      requestId: RpcMessage.RequestId(1),
      rpc: PlatformFinanceReceiptReview.middleware(RpcRequestContextMiddleware),
    };
    let storageChecks = 0;
    await Effect.runPromise(
      Effect.gen(function* () {
        const media = yield* ReceiptMediaService;
        const error = yield* platformTenantFinanceHandlers[
          'platform.finance.receipts.review'
        ]({ ...fields, status: 'approved' }, options).pipe(
          Effect.provideService(ReceiptMediaService, {
            ...media,
            objectExists: ({ storageKey }) =>
              Effect.promise(async () => {
                storageChecks += 1;
                // The provider lookup overlaps a committed change to the evidence.
                await database
                  .update(financeReceiptUploads)
                  .set({ storageKey: `${storageKey}.replaced` })
                  .where(eq(financeReceiptUploads.id, fixture.receiptUploadId));
                return true;
              }),
          }),
          Effect.flip,
        );
        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'receiptEvidenceUnavailable',
        });
        expect(
          yield* Effect.promise(() =>
            database.query.financeReceipts.findFirst({
              columns: { status: true },
              where: { id: fixture.receiptId },
            }),
          ),
        ).toEqual({ status: 'submitted' });
        expect(
          yield* Effect.promise(() =>
            database
              .select({ id: platformAuditEntries.id })
              .from(platformAuditEntries)
              .where(eq(platformAuditEntries.targetTenantId, fixture.tenantId)),
          ),
        ).toEqual([]);
        // The original fixture media service dies if rejection touches storage.
        const rejected = yield* platformTenantFinanceHandlers[
          'platform.finance.receipts.review'
        ](
          {
            ...fields,
            rejectionReason: 'Evidence was withdrawn',
            status: 'rejected',
          },
          options,
        );
        expect(rejected).toEqual({ id: fixture.receiptId, status: 'rejected' });
        expect(storageChecks).toBe(1);
      }).pipe(
        Effect.provideService(RpcRequestContext, context),
        Effect.provide(fixture.handlerLayer),
      ),
    );
    expect(
      await database.query.financeReceipts.findFirst({
        columns: { status: true },
        where: { id: fixture.receiptId },
      }),
    ).toEqual({ status: 'rejected' });
    expect(
      await database
        .select({ actorId: platformAuditEntries.actorId })
        .from(platformAuditEntries)
        .where(eq(platformAuditEntries.targetTenantId, fixture.tenantId)),
    ).toEqual([{ actorId: platformAuthority.actorId }]);
  });

  it('shows exhausted refund claims despite stale schedules and scopes recovery to the selected tenant', async () => {
    const target = await seedReceipt('submitted');
    const foreign = await seedReceipt('submitted');
    const eligibleIds: string[] = [];
    const sourceIds: string[] = [];
    const future = new Date(Date.now() + 60_000);
    for (const fixture of [target, foreign]) {
      const optionId = createId();
      const registrationId = createId();
      const sourceId = createId();
      sourceIds.push(sourceId);
      await database.insert(eventRegistrationOptions).values({
        closeRegistrationTime: new Date('2026-07-31T23:00:00Z'),
        eventId: fixture.eventId,
        id: optionId,
        isPaid: true,
        openRegistrationTime: new Date('2026-07-01T00:00:00Z'),
        organizingRegistration: false,
        price: 100,
        registrationMode: 'fcfs',
        spots: 10,
        title: 'Paid admission',
      });
      await database.insert(eventRegistrations).values({
        basePriceAtRegistration: 100,
        discountAmount: 0,
        eventId: fixture.eventId,
        id: registrationId,
        registrationOptionId: optionId,
        status: 'CANCELLED',
        tenantId: fixture.tenantId,
        userId: fixture.userId,
      });
      const payment = {
        amount: 100,
        currency: 'CZK',
        eventId: fixture.eventId,
        eventRegistrationId: registrationId,
        method: 'stripe',
        stripeAccountId: `acct_${fixture.tenantId}`,
        targetUserId: fixture.userId,
        tenantId: fixture.tenantId,
      } as const;
      await database.insert(transactions).values({
        ...payment,
        id: sourceId,
        status: 'successful',
        type: 'registration',
      });
      for (const scenario of [
        'exhausted',
        'scheduled',
        'leased',
        'successful',
      ] as const) {
        const id = createId();
        if (scenario === 'exhausted') eligibleIds.push(id);
        await database.insert(transactions).values({
          ...payment,
          amount: -100,
          id,
          refundOperationKey: `test:${id}`,
          sourceTransactionId: sourceId,
          status: scenario === 'successful' ? 'successful' : 'pending',
          stripeRefundApplicationFee: true,
          stripeRefundAttempts: scenario === 'scheduled' ? 1 : 8,
          stripeRefundClaimLeaseExpiresAt:
            scenario === 'leased' ? future : null,
          stripeRefundClaimLeaseId:
            scenario === 'leased' ? `lease:${id}` : null,
          stripeRefundId: `re_${id}`,
          stripeRefundNextAttemptAt: future,
          stripeRefundStatus:
            scenario === 'successful' ? 'succeeded' : 'pending',
          type: 'refund',
        });
      }
    }
    const [claimId] = eligibleIds;
    const [sourceId, foreignSourceId] = sourceIds;
    if (!claimId || !sourceId || !foreignSourceId)
      throw new Error('Missing payment ownership fixture');
    for (const invalid of [
      { stripeRefundAttempts: -1 },
      { stripeRefundAttempts: 9 },
      { stripeRefundMaxAttempts: 0 },
      { stripeRefundClaimLeaseId: 'orphaned-lease' },
      { stripeRefundClaimLeaseExpiresAt: future },
      { refundOperationKey: null },
      { stripeRefundApplicationFee: null },
    ]) {
      await expect(
        database
          .update(transactions)
          .set(invalid)
          .where(eq(transactions.id, claimId)),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    }
    await expect(
      database
        .update(transactions)
        .set({ sourceTransactionId: foreignSourceId })
        .where(eq(transactions.id, claimId)),
    ).rejects.toMatchObject({
      cause: { code: '23503', constraint: 'transactions_source_payment_fk' },
    });
    for (const invalid of [
      { method: 'cash' },
      { eventId: sql`NULL` },
      { eventRegistrationId: sql`NULL` },
    ] as const) {
      await expect(
        database
          .update(transactions)
          .set(invalid)
          .where(eq(transactions.id, sourceId)),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    }
    const platformAuthority = PlatformAdministratorAuthority.make({
      actorEmail: 'platform@example.org',
      actorId: 'auth0|receipt-platform-admin',
      kind: 'platformAdministrator',
    });
    const options = {
      client: new Rpc.ServerClient(1),
      headers: Headers.empty,
      requestId: RpcMessage.RequestId(1),
      rpc: PlatformFinanceRefundRecoveryQueue.middleware(
        RpcRequestContextMiddleware,
      ),
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* platformTenantFinanceHandlers[
          'platform.finance.refundClaims.recoveryQueue'
        ]({ targetTenantId: target.tenantId }, options);
        expect(queue.claims.map((claim) => claim.id)).toEqual([eligibleIds[0]]);
        expect(queue.claims[0]).toMatchObject({
          amount: 100,
          attendeeFirstName: 'Receipt',
          attendeeLastName: 'Lock',
          eventId: target.eventId,
          eventTitle: 'Receipt lock event',
          mode: 'resumeGeneration',
        });
        const denied = yield* platformTenantFinanceHandlers[
          'platform.finance.refundClaims.recoveryQueue'
        ]({ targetTenantId: target.tenantId }, options).pipe(
          Effect.provideService(RpcRequestContext, target.requestContext),
          Effect.flip,
        );
        expect(denied).toMatchObject({ _tag: 'RpcForbiddenError' });
      }).pipe(
        Effect.provideService(RpcRequestContext, {
          ...target.requestContext,
          authData: { sub: platformAuthority.actorId },
          permissions: [],
          platformAuthority,
          user: null,
          userAssigned: false,
        }),
        Effect.provide(target.handlerLayer),
      ),
    );
  });

  it('cleans a recorded promotion after the storage response is lost and preserves attached evidence', async () => {
    const fixture = await seedReceipt('submitted');
    const consumedWitness = await seedReceipt('submitted');
    const readyWitness = await seedReceipt('submitted');
    const now = new Date();
    const body = new TextEncoder().encode('%PDF-1.7');
    const scope = {
      eventId: fixture.eventId,
      fileName: 'receipt.pdf',
      tenantId: fixture.tenantId,
      uploadId: fixture.receiptUploadId,
      userId: fixture.userId,
    };
    const temporaryKey = buildReceiptUploadStorageKey(scope);
    const finalKey = buildReceiptStorageKey({
      ...scope,
      contentDigest: createHash('sha256').update(body).digest('hex'),
    });
    await database
      .delete(financeReceipts)
      .where(
        inArray(financeReceipts.id, [
          fixture.receiptId,
          readyWitness.receiptId,
        ]),
      );
    await database
      .update(financeReceiptUploads)
      .set({
        consumedAt: null,
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
        fileName: scope.fileName,
        mimeType: 'application/pdf',
        sizeBytes: body.byteLength,
        status: 'pending',
        storageKey: temporaryKey,
        uploadedAt: null,
      })
      .where(eq(financeReceiptUploads.id, fixture.receiptUploadId));
    await database
      .update(financeReceiptUploads)
      .set({
        consumedAt: null,
        status: 'ready',
        updatedAt: now,
      })
      .where(eq(financeReceiptUploads.id, readyWitness.receiptUploadId));

    const deletedKeys: string[] = [];
    const objects = new Map<string, Uint8Array>([[temporaryKey, body]]);
    const objectStorageLayer = Layer.succeed(ObjectStorage)({
      deleteObject: (key) =>
        Effect.sync(() => {
          deletedKeys.push(key);
          objects.delete(key);
        }),
      exists: (key) => Effect.sync(() => objects.has(key)),
      get: (key) =>
        Effect.suspend(() => {
          const stored = objects.get(key);
          return stored
            ? Effect.succeed(Uint8Array.from(stored))
            : Effect.fail(new ObjectStorageNotFoundError());
        }),
      metadata: () => Effect.die(new Error('Unexpected metadata read')),
      presignGet: () => Effect.die(new Error('Unexpected signed preview')),
      presignPost: () => Effect.die(new Error('Unexpected upload policy')),
      put: (input) =>
        Effect.sync(() => {
          objects.set(input.key, input.body);
        }).pipe(
          Effect.andThen(
            Effect.fail(
              new RpcInternalServerError({
                message: 'Object was written but the response was lost',
              }),
            ),
          ),
        ),
    });
    const permissions = ['events:organizeAll'] as const;
    const requestContext = {
      ...fixture.requestContext,
      permissions,
      user: { ...fixture.requestContext.user, permissions },
    } satisfies RpcRequestContextShape;
    const uploadRpc = [...AppRpcs.requests.values()].find(
      (rpc) => rpc._tag === 'finance.receiptMedia.finalizeUpload',
    );
    if (!uploadRpc) throw new Error('Receipt finalization RPC is missing');

    const error = await trackHandlerOperation(
      Effect.runPromise(
        financeHandlers['finance.receiptMedia.finalizeUpload'](
          { uploadId: fixture.receiptUploadId },
          {
            client: new Rpc.ServerClient(1),
            headers: Headers.empty,
            requestId: RpcMessage.RequestId(1),
            rpc: uploadRpc.middleware(RpcRequestContextMiddleware),
          },
        ).pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(
              RpcAccess.Default,
              Layer.succeed(RpcRequestContext, requestContext),
              makeDatabaseServiceLayer(databaseUrl),
              ReceiptMediaService.Default.pipe(
                Layer.provide(objectStorageLayer),
              ),
            ),
          ),
        ),
      ),
    );
    expect(error._tag).toBe('ReceiptMediaServiceUnavailableError');
    expect(objects.has(finalKey)).toBe(true);
    expect(
      await database.query.financeReceiptUploads.findFirst({
        columns: { status: true, storageKey: true },
        where: { id: fixture.receiptUploadId },
      }),
    ).toEqual({ status: 'finalizing', storageKey: finalKey });

    const cleaned = await trackHandlerOperation(
      Effect.runPromise(
        processReceiptOrphans({
          now: new Date(now.getTime() + 21 * 60 * 1000),
        }).pipe(
          Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
          Effect.provide(objectStorageLayer),
        ),
      ),
    );
    expect(cleaned).toEqual({ deleted: 1, scanned: 1 });
    expect(deletedKeys).toEqual([finalKey]);
    expect(objects.has(finalKey)).toBe(false);
    expect(
      await database.query.financeReceiptUploads.findFirst({
        columns: { id: true },
        where: { id: fixture.receiptUploadId },
      }),
    ).toBeUndefined();
    for (const [witness, status] of [
      [consumedWitness, 'consumed'],
      [readyWitness, 'ready'],
    ] as const) {
      expect(
        await database.query.financeReceiptUploads.findFirst({
          columns: { status: true },
          where: { id: witness.receiptUploadId },
        }),
      ).toEqual({ status });
    }
  });

  it('stores receipt dates as calendar days and rejects invalid amount states at the database boundary', async () => {
    const fixture = await seedReceipt('submitted');
    const stored = await pool.query<{ receiptDate: string }>(
      'SELECT "receiptDate" FROM finance_receipts WHERE id = $1',
      [fixture.receiptId],
    );
    expect(stored.rows[0]?.receiptDate).toBe('2026-07-31');

    const invalidUpdates = [
      {
        constraint: financeReceiptTotalAmountPositiveCheckName,
        sql: 'UPDATE finance_receipts SET "totalAmount" = 0 WHERE id = $1',
      },
      {
        constraint: financeReceiptTaxAmountValidCheckName,
        sql: 'UPDATE finance_receipts SET "taxAmount" = 101 WHERE id = $1',
      },
      {
        constraint: financeReceiptDepositAmountConsistentCheckName,
        sql: 'UPDATE finance_receipts SET "depositAmount" = 1, "hasDeposit" = false WHERE id = $1',
      },
      {
        constraint: financeReceiptAlcoholAmountConsistentCheckName,
        sql: 'UPDATE finance_receipts SET "alcoholAmount" = 0, "hasAlcohol" = true WHERE id = $1',
      },
      {
        constraint: financeReceiptComponentsWithinTotalCheckName,
        sql: 'UPDATE finance_receipts SET "depositAmount" = 60, "hasDeposit" = true, "alcoholAmount" = 50, "hasAlcohol" = true WHERE id = $1',
      },
    ];

    for (const update of invalidUpdates) {
      await expect(
        pool.query(update.sql, [fixture.receiptId]),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: update.constraint,
      });
    }
  });

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
