import { describe, expect, it, vi } from '@effect/vitest';
import { TransactionRollbackError } from 'drizzle-orm';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../../db';
import {
  financeReceipts,
  financeReceiptUploads,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { ReceiptMediaServiceUnavailableError } from '../../../../../shared/rpc-contracts/app-rpcs/finance.errors';
import { RpcAccess } from '../shared/rpc-access.service';
import { financeReceiptSubmitterEmail } from './finance-receipts.handlers';
import { financeHandlers } from './finance.handlers';
import { ReceiptMediaService } from './receipt-media.service';

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

const createUser = (permissions: readonly Permission[]) => ({
  attributes: [],
  auth0Id: 'auth0|user-1',
  email: 'alice@example.com',
  firstName: 'Alice',
  iban: null,
  id: 'user-1',
  lastName: 'Doe',
  paypalEmail: null,
  permissions,
  roleIds: [],
});

const createContextLayer = (
  permissions: readonly Permission[],
  options: {
    database?: unknown;
    receiptMediaService?: unknown;
  } = {},
) => {
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions,
    tenant,
    user: createUser(permissions),
    userAssigned: true,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, requestContext),
    Layer.succeed(Database, (options.database ?? {}) as never),
    Layer.succeed(
      ReceiptMediaService,
      (options.receiptMediaService ?? {
        createUploadPolicy: () =>
          Effect.succeed({
            fields: { key: 'receipts/example.png' },
            storageKey: 'receipts/example.png',
            url: 'https://storage.example.test/bucket',
          }),
        inspectUpload: () =>
          Effect.succeed({
            mimeType: 'image/png',
            sizeBytes: 7,
            storageKey: 'receipts/example.png',
            storageUrl: 's3://bucket/receipts/example.png',
          }),
        objectExists: () => Effect.succeed(false),
        signedPreviewUrl: () =>
          Effect.succeed('https://signed.example.test/receipt'),
      }) as never,
    ),
  );
};

const uploadInput = {
  eventId: 'event-1',
  fileName: 'receipt.png',
  mimeType: 'image/png',
  sizeBytes: 7,
};

const receiptFieldsInput = {
  alcoholAmount: 0,
  depositAmount: 0,
  hasAlcohol: false,
  hasDeposit: false,
  purchaseCountry: 'NL',
  receiptDate: '2026-05-19',
  taxAmount: 20,
  totalAmount: 100,
};

const receiptSubmitInput = {
  attachment: {
    fileName: 'receipt.png',
    uploadId: 'upload-1',
  },
  eventId: 'event-1',
  fields: receiptFieldsInput,
};

const databaseWithNoOrganizerReceiptAccess = () => {
  const emptyRegistrationQuery = {
    from: () => emptyRegistrationQuery,
    innerJoin: () => emptyRegistrationQuery,
    limit: () => Effect.succeed([]),
    select: () => emptyRegistrationQuery,
    where: () => emptyRegistrationQuery,
  };

  return {
    select: () => emptyRegistrationQuery,
  };
};

const databaseWithTenantEvent = (event: { end?: Date; id?: string } = {}) => ({
  query: {
    eventInstances: {
      findFirst: () =>
        Effect.succeed({
          end: event.end ?? new Date('2026-05-18T12:00:00.000Z'),
          id: event.id ?? 'event-1',
        }),
    },
  },
});

const databaseWithReceiptInsert = (
  event: { end?: Date; id?: string } = {},
  options: {
    consumedUploadRows?: { id: string }[];
    existingReceiptRows?: { id: string }[];
    uploadRows?: { id: string; mimeType: string; sizeBytes: number }[];
  } = {},
) => {
  let consumedValues: unknown;
  let insertedValues: unknown;
  const insertQuery = {
    returning: () => Effect.succeed([{ id: 'receipt-1' }]),
    values: (values: unknown) => {
      insertedValues = values;
      return insertQuery;
    },
  };
  const consumedUploadQuery = {
    returning: () =>
      Effect.succeed(options.consumedUploadRows ?? [{ id: 'upload-1' }]),
    set: (values: unknown) => {
      consumedValues = values;
      return consumedUploadQuery;
    },
    where: () => consumedUploadQuery,
  };
  let selectCount = 0;
  const uploadQuery = {
    for: () =>
      Effect.succeed(
        options.uploadRows ?? [
          { id: 'upload-1', mimeType: 'image/png', sizeBytes: 7 },
        ],
      ),
    from: () => uploadQuery,
    where: () => uploadQuery,
  };
  const existingReceiptQuery = {
    from: () => existingReceiptQuery,
    limit: () => Effect.succeed(options.existingReceiptRows ?? []),
    where: () => existingReceiptQuery,
  };
  const tx = {
    insert: (table: unknown) => {
      expect(table).toBe(financeReceipts);
      return insertQuery;
    },
    rollback: () => Effect.die(new TransactionRollbackError()),
    select: () => {
      selectCount += 1;
      return selectCount === 1 ? uploadQuery : existingReceiptQuery;
    },
    update: (table: unknown) => {
      expect(table).toBe(financeReceiptUploads);
      return consumedUploadQuery;
    },
  };

  return {
    consumedValues: () => consumedValues,
    database: {
      ...databaseWithTenantEvent(event),
      transaction: (run: (transaction: typeof tx) => Effect.Effect<unknown>) =>
        run(tx),
    },
    insertedValues: () => insertedValues,
  };
};

const databaseWithReceiptUploadLifecycle = (steps: string[]) => {
  const insertQuery = {
    returning: () => {
      steps.push('preflight');
      return Effect.succeed([{ id: 'upload-1' }]);
    },
    values: () => insertQuery,
  };
  const updateQuery = {
    returning: () => {
      steps.push('finalize');
      return Effect.succeed([{ id: 'upload-1' }]);
    },
    set: () => updateQuery,
    where: () => updateQuery,
  };

  return {
    ...databaseWithTenantEvent(),
    insert: (table: unknown) => {
      expect(table).toBe(financeReceiptUploads);
      return insertQuery;
    },
    update: (table: unknown) => {
      expect(table).toBe(financeReceiptUploads);
      return updateQuery;
    },
  };
};

const databaseWithSubmittedReceipt = () => ({
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () =>
              Effect.succeed([
                {
                  eventTitle: 'City tour',
                  id: 'receipt-1',
                  status: 'submitted' as const,
                  submittedByCommunicationEmail: null,
                  submittedByEmail: 'alice@example.com',
                },
              ]),
          }),
        }),
      }),
    }),
  }),
  update: () =>
    Effect.die(
      new Error('receipt update should not run after validation fails'),
    ),
});

const databaseWithReviewReceiptStatus = (
  status: 'approved' | 'refunded' | 'rejected' | 'submitted',
) => {
  const evidenceQuery = {
    from: () => evidenceQuery,
    innerJoin: () => evidenceQuery,
    limit: () => Effect.succeed([{ ...submittedReceiptRow, status }]),
    where: () => evidenceQuery,
  };
  const reviewQuery = {
    for: () =>
      Effect.succeed([
        {
          eventTitle: 'City tour',
          id: 'receipt-1',
          status,
          submittedByCommunicationEmail: null,
          submittedByEmail: 'alice@example.com',
        },
      ]),
    from: () => reviewQuery,
    innerJoin: () => reviewQuery,
    limit: () => reviewQuery,
    where: () => reviewQuery,
  };
  const tx = {
    select: () => reviewQuery,
    update: () =>
      Effect.die(
        new Error(
          'receipt review update should not run after validation fails',
        ),
      ),
  };

  return {
    select: () => evidenceQuery,
    transaction: (run: (transaction: typeof tx) => Effect.Effect<unknown>) =>
      run(tx),
  };
};

const databaseWithRefundableReceipts = (
  receipts: {
    currency: 'AUD' | 'CZK' | 'EUR';
    eventId: string;
    id: string;
    submittedByUserId: string;
    totalAmount: number;
  }[],
) => {
  const receiptQuery = {
    for: () => Effect.succeed(receipts),
    from: () => receiptQuery,
    orderBy: () => receiptQuery,
    where: () => receiptQuery,
  };
  const tx = { select: () => receiptQuery };

  return {
    transaction: (run: (transaction: typeof tx) => Effect.Effect<unknown>) =>
      run(tx),
  };
};

const databaseWithRefundableReceiptForPayout = (payoutUser: {
  iban: null | string;
  id: string;
  paypalEmail: null | string;
}) => {
  const receiptQuery = {
    for: () =>
      Effect.succeed([
        {
          currency: 'EUR' as const,
          eventId: 'event-1',
          id: 'receipt-1',
          submittedByUserId: payoutUser.id,
          totalAmount: 100,
        },
      ]),
    from: () => receiptQuery,
    orderBy: () => receiptQuery,
    where: () => receiptQuery,
  };
  const payoutQuery = {
    for: () => Effect.succeed([payoutUser]),
    from: () => payoutQuery,
    where: () => payoutQuery,
  };
  let selectCount = 0;
  const tx = {
    select: () => (selectCount++ === 0 ? receiptQuery : payoutQuery),
  };

  return {
    transaction: (run: (transaction: typeof tx) => Effect.Effect<unknown>) =>
      run(tx),
  };
};

const databaseWithRefundPreconditionRace = () => {
  const receipts = [
    {
      currency: 'EUR' as const,
      eventId: 'event-1',
      id: 'receipt-1',
      submittedByUserId: 'user-1',
      totalAmount: 100,
    },
  ];
  const receiptQuery = {
    for: () => Effect.succeed(receipts),
    from: () => receiptQuery,
    orderBy: () => receiptQuery,
    where: () => receiptQuery,
  };
  const payoutQuery = {
    for: () =>
      Effect.succeed([
        {
          iban: 'NL91ABNA0417164300',
          id: 'user-1',
          paypalEmail: null,
        },
      ]),
    from: () => payoutQuery,
    where: () => payoutQuery,
  };
  const insertQuery = {
    returning: () => Effect.succeed([{ id: 'transaction-1' }]),
    values: () => insertQuery,
  };
  const updateQuery = {
    returning: () => Effect.succeed([]),
    set: () => updateQuery,
    where: () => updateQuery,
  };
  let selectCount = 0;
  const tx = {
    insert: () => insertQuery,
    select: () => (selectCount++ === 0 ? receiptQuery : payoutQuery),
    update: () => updateQuery,
  };

  return {
    transaction: (run: (transaction: typeof tx) => Effect.Effect<unknown>) =>
      run(tx),
  };
};

const databaseWithSuccessfulRefund = () => {
  const operations: string[] = [];
  let insertedTransaction: Record<string, unknown> | undefined;
  const receiptQuery = {
    for: (lock: string) => {
      operations.push(`receipts:${lock}`);
      return Effect.succeed([
        {
          currency: 'CZK' as const,
          eventId: 'event-1',
          id: 'receipt-1',
          submittedByUserId: 'user-1',
          totalAmount: 125,
        },
      ]);
    },
    from: () => receiptQuery,
    orderBy: () => receiptQuery,
    where: () => receiptQuery,
  };
  const payoutQuery = {
    for: (lock: string) => {
      operations.push(`payout:${lock}`);
      return Effect.succeed([
        {
          iban: 'NL91ABNA0417164300',
          id: 'user-1',
          paypalEmail: null,
        },
      ]);
    },
    from: () => payoutQuery,
    where: () => payoutQuery,
  };
  const insertQuery = {
    returning: () => Effect.succeed([{ id: 'transaction-1' }]),
    values: (values: Record<string, unknown>) => {
      operations.push('transaction:insert');
      insertedTransaction = values;
      return insertQuery;
    },
  };
  const updateQuery = {
    returning: () => {
      operations.push('receipt:update');
      return Effect.succeed([{ id: 'receipt-1' }]);
    },
    set: () => updateQuery,
    where: () => updateQuery,
  };
  let selectCount = 0;
  const tx = {
    insert: () => insertQuery,
    select: () => (selectCount++ === 0 ? receiptQuery : payoutQuery),
    update: () => updateQuery,
  };

  return {
    database: {
      transaction: (run: (transaction: typeof tx) => Effect.Effect<unknown>) =>
        run(tx),
    },
    insertedTransaction: () => insertedTransaction,
    operations,
  };
};

const submittedReceiptRow = {
  alcoholAmount: 0,
  attachmentFileName: 'receipt.png',
  attachmentMimeType: 'image/png',
  attachmentStorageKey: 'receipts/tenant-2/event-1/user-1/upload-1-receipt.png',
  attachmentStorageUrl: 'https://storage.example/foreign-receipt.png',
  attachmentUploadConsumedAt: new Date('2026-05-19T09:59:00.000Z'),
  attachmentUploadedAt: new Date('2026-05-19T09:58:00.000Z'),
  attachmentUploadedByUserId: 'user-1',
  attachmentUploadEventId: 'event-1',
  attachmentUploadId: 'upload-1',
  attachmentUploadStatus: 'consumed' as const,
  attachmentUploadTenantId: 'tenant-1',
  createdAt: new Date('2026-05-19T10:00:00.000Z'),
  currency: 'AUD' as const,
  depositAmount: 0,
  eventId: 'event-1',
  eventStart: new Date('2026-05-18T18:00:00.000Z'),
  eventTitle: 'City Walk',
  hasAlcohol: false,
  hasDeposit: false,
  id: 'receipt-1',
  previewImageUrl: 'https://attacker.example/preview.png',
  purchaseCountry: 'NL',
  receiptDate: new Date('2026-05-18T00:00:00.000Z'),
  refundedAt: null,
  refundTransactionId: null,
  rejectionReason: null,
  reviewedAt: null,
  status: 'submitted' as const,
  submittedByUserId: 'user-1',
  taxAmount: 20,
  tenantId: 'tenant-1',
  totalAmount: 100,
  updatedAt: new Date('2026-05-19T10:00:00.000Z'),
};

const databaseWithMyReceipts = (
  rows: readonly (typeof submittedReceiptRow)[] = [submittedReceiptRow],
) => {
  const query = {
    from: () => query,
    innerJoin: () => query,
    orderBy: () => Effect.succeed(rows),
    select: () => query,
    where: () => query,
  };

  return {
    select: () => query,
  };
};

const databaseWithPendingReceipts = () => {
  const query = {
    from: () => query,
    innerJoin: () => query,
    orderBy: () =>
      Effect.succeed([
        {
          ...submittedReceiptRow,
          submittedByCommunicationEmail: null,
          submittedByEmail: 'alice@example.com',
          submittedByFirstName: 'Alice',
          submittedByLastName: 'Doe',
        },
      ]),
    select: () => query,
    where: () => query,
  };

  return {
    select: () => query,
  };
};

const databaseWithReceiptReviewLifecycle = ({
  lockedEvidence = {
    ...submittedReceiptRow,
    attachmentStorageKey:
      'receipts/tenant-1/event-1/user-1/upload-1-receipt.png',
    attachmentStorageUrl: 'https://storage.example.test/receipt.png',
  },
  preflightEvidence = {
    ...submittedReceiptRow,
    attachmentStorageKey:
      'receipts/tenant-1/event-1/user-1/upload-1-receipt.png',
    attachmentStorageUrl: 'https://storage.example.test/receipt.png',
  },
}: {
  lockedEvidence?: typeof submittedReceiptRow;
  preflightEvidence?: typeof submittedReceiptRow;
} = {}) => {
  const operations: string[] = [];
  const preflightQuery = {
    from: () => preflightQuery,
    innerJoin: () => preflightQuery,
    limit: () => {
      operations.push('preflight');
      return Effect.succeed([preflightEvidence]);
    },
    where: () => preflightQuery,
  };
  const lockedReceiptQuery = {
    for: () => {
      operations.push('receipt:lock');
      return Effect.succeed([
        {
          attachmentUploadId: 'upload-1',
          eventTitle: 'City tour',
          id: 'receipt-1',
          status: 'submitted' as const,
          submittedByCommunicationEmail: null,
          submittedByEmail: 'alice@example.com',
        },
      ]);
    },
    from: () => lockedReceiptQuery,
    innerJoin: () => lockedReceiptQuery,
    limit: () => lockedReceiptQuery,
    where: () => lockedReceiptQuery,
  };
  const lockedEvidenceQuery = {
    for: () => {
      operations.push('evidence:lock');
      return Effect.succeed([lockedEvidence]);
    },
    from: () => lockedEvidenceQuery,
    innerJoin: () => lockedEvidenceQuery,
    limit: () => lockedEvidenceQuery,
    where: () => lockedEvidenceQuery,
  };
  let updatedStatus: 'approved' | 'rejected' = 'approved';
  const updateQuery = {
    returning: () => {
      operations.push('receipt:update');
      return Effect.succeed([{ id: 'receipt-1', status: updatedStatus }]);
    },
    set: (values: { status: 'approved' | 'rejected' }) => {
      updatedStatus = values.status;
      return updateQuery;
    },
    where: () => updateQuery,
  };
  const emailQuery = {
    onConflictDoNothing: () => {
      operations.push('email:enqueue');
      return Effect.succeed([]);
    },
    values: () => emailQuery,
  };
  let selectCount = 0;
  const transaction = {
    insert: () => emailQuery,
    select: () =>
      selectCount++ === 0 ? lockedReceiptQuery : lockedEvidenceQuery,
    update: () => updateQuery,
  };

  return {
    database: {
      select: () => preflightQuery,
      transaction: (
        run: (transaction: typeof transaction) => Effect.Effect<unknown>,
      ) => {
        operations.push('transaction:start');
        return run(transaction);
      },
    },
    operations,
  };
};

describe('financeHandlers composition', () => {
  it('contains the full finance rpc handler set', () => {
    expect(Object.keys(financeHandlers).toSorted()).toEqual([
      'finance.receiptMedia.createUpload',
      'finance.receiptMedia.finalizeUpload',
      'finance.receipts.byEvent',
      'finance.receipts.createRefund',
      'finance.receipts.findOneForApproval',
      'finance.receipts.my',
      'finance.receipts.pendingApprovalGrouped',
      'finance.receipts.refundableGroupedByRecipient',
      'finance.receipts.review',
      'finance.receipts.submit',
      'finance.transactions.findMany',
    ]);
  });
});

describe('finance profile receipt reads', () => {
  it('uses notification email for finance receipt submitter displays', () => {
    expect(
      financeReceiptSubmitterEmail({
        submittedByCommunicationEmail: 'notify@example.com',
        submittedByEmail: 'login@example.com',
      }),
    ).toBe('notify@example.com');
    expect(
      financeReceiptSubmitterEmail({
        submittedByCommunicationEmail: null,
        submittedByEmail: 'login@example.com',
      }),
    ).toBe('login@example.com');
    expect(
      financeReceiptSubmitterEmail({
        submittedByCommunicationEmail: ' '.repeat(3),
        submittedByEmail: 'login@example.com',
      }),
    ).toBe('login@example.com');
  });

  it.effect(
    'returns current-user receipt media for an exact scoped upload binding',
    () =>
      Effect.gen(function* () {
        const attachmentStorageKey =
          'receipts/tenant-1/event-1/user-1/upload-1-receipt.png';
        const result = yield* financeHandlers['finance.receipts.my'](
          undefined,
          { headers: {} } as never,
        ).pipe(
          Effect.provide(
            createContextLayer([], {
              database: databaseWithMyReceipts([
                {
                  ...submittedReceiptRow,
                  attachmentStorageKey,
                  attachmentStorageUrl: 'local-unavailable://receipt',
                },
              ]),
            }),
          ),
        );

        expect(result).toEqual([
          expect.objectContaining({
            attachmentStorageKey,
            currency: 'AUD',
            id: 'receipt-1',
            previewImageUrl: null,
          }),
        ]);
      }),
  );

  it.effect(
    'fails closed for invalid upload bindings in current-user receipt rows',
    () =>
      Effect.gen(function* () {
        const result = yield* financeHandlers['finance.receipts.my'](
          undefined,
          { headers: {} } as never,
        ).pipe(
          Effect.provide(
            createContextLayer([], {
              database: databaseWithMyReceipts(),
            }),
          ),
        );

        expect(result).toEqual([
          {
            alcoholAmount: 0,
            attachmentFileName: 'receipt.png',
            attachmentMimeType: 'image/png',
            attachmentStorageKey: null,
            createdAt: '2026-05-19T10:00:00.000Z',
            currency: 'AUD',
            depositAmount: 0,
            eventId: 'event-1',
            eventStart: '2026-05-18T18:00:00.000Z',
            eventTitle: 'City Walk',
            hasAlcohol: false,
            hasDeposit: false,
            id: 'receipt-1',
            previewImageUrl: null,
            purchaseCountry: 'NL',
            receiptDate: '2026-05-18T00:00:00.000Z',
            refundedAt: null,
            refundTransactionId: null,
            rejectionReason: null,
            reviewedAt: null,
            status: 'submitted',
            submittedByUserId: 'user-1',
            taxAmount: 20,
            totalAmount: 100,
            updatedAt: '2026-05-19T10:00:00.000Z',
          },
        ]);
      }),
  );

  it.effect(
    'fails closed for invalid upload bindings in pending approval groups',
    () =>
      Effect.gen(function* () {
        const result = yield* financeHandlers[
          'finance.receipts.pendingApprovalGrouped'
        ](undefined, { headers: {} } as never).pipe(
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], {
              database: databaseWithPendingReceipts(),
            }),
          ),
        );

        expect(result).toHaveLength(1);
        expect(result[0]?.receipts[0]).toEqual(
          expect.objectContaining({
            attachmentStorageKey: null,
            id: 'receipt-1',
            previewImageUrl: null,
          }),
        );
      }),
  );
});

describe('finance receipt media permissions', () => {
  it.effect('rejects receipt uploads without receipt-submit access', () =>
    Effect.gen(function* () {
      let isUploadCalled = false;
      const error = yield* financeHandlers['finance.receiptMedia.createUpload'](
        uploadInput,
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer([], {
            database: databaseWithNoOrganizerReceiptAccess(),
            receiptMediaService: {
              createUploadPolicy: () => {
                isUploadCalled = true;
                return Effect.succeed({
                  fields: {},
                  storageKey: 'receipts/tenant-1/event-1/user-1/file.png',
                  url: 'https://storage.example.test/bucket',
                });
              },
            },
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('finance:submitReceipts:event-1');
      expect(isUploadCalled).toBe(false);
    }),
  );

  it.effect('uploads receipt media after receipt-submit preflight passes', () =>
    Effect.gen(function* () {
      let capturedInput: unknown;
      const lifecycleSteps: string[] = [];
      const result = yield* financeHandlers[
        'finance.receiptMedia.createUpload'
      ](uploadInput, { headers: {} } as never).pipe(
        Effect.provide(
          createContextLayer(['events:organizeAll'], {
            database: databaseWithReceiptUploadLifecycle(lifecycleSteps),
            receiptMediaService: {
              createUploadPolicy: (input: unknown) => {
                capturedInput = input;
                lifecycleSteps.push('storage');
                return Effect.succeed({
                  fields: { key: 'receipts/example.png' },
                  storageKey: 'receipts/tenant-1/event-1/user-1/file.png',
                  url: 'https://storage.example.test/bucket',
                });
              },
            },
          }),
        ),
      );

      expect(capturedInput).toEqual(
        expect.objectContaining({
          eventId: 'event-1',
          tenantId: 'tenant-1',
          uploadId: expect.any(String),
          userId: 'user-1',
        }),
      );
      expect(result).toEqual({
        expiresAt: expect.any(String),
        fields: { key: 'receipts/example.png' },
        uploadId: expect.any(String),
        url: 'https://storage.example.test/bucket',
      });
      expect(lifecycleSteps).toEqual(['preflight', 'storage']);
    }),
  );

  it.effect(
    'does not finalize an upload when receipt storage is unavailable',
    () =>
      Effect.gen(function* () {
        const lifecycleSteps: string[] = [];
        const error = yield* financeHandlers[
          'finance.receiptMedia.createUpload'
        ](uploadInput, { headers: {} } as never).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['events:organizeAll'], {
              database: databaseWithReceiptUploadLifecycle(lifecycleSteps),
              receiptMediaService: {
                createUploadPolicy: () =>
                  Effect.fail(
                    new ReceiptMediaServiceUnavailableError({
                      message: 'Receipt storage is unavailable',
                    }),
                  ),
                objectExists: () => Effect.succeed(false),
                signedPreviewUrl: () =>
                  Effect.succeed('https://signed.example.test/receipt'),
              },
            }),
          ),
        );

        expect(error['_tag']).toBe('ReceiptMediaServiceUnavailableError');
        expect(lifecycleSteps).toEqual(['preflight']);
      }),
  );
});

describe('finance transaction permissions', () => {
  it.effect(
    'rejects transaction reads without finance transaction access',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.transactions.findMany'](
          { limit: 10, offset: 0 },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(createContextLayer([])));

        expect(error['_tag']).toBe('RpcForbiddenError');
        expect(error.permission).toBe('finance:viewTransactions');
      }),
  );
});

describe('finance receipt reimbursement', () => {
  it.effect(
    'locks the recorded amount, currency, status, and payout details before recording reimbursement',
    () =>
      Effect.gen(function* () {
        const fixture = databaseWithSuccessfulRefund();

        const result = yield* financeHandlers['finance.receipts.createRefund'](
          {
            payoutReference: 'NL91ABNA0417164300',
            payoutType: 'iban',
            receiptIds: ['receipt-1'],
          },
          { headers: {} } as never,
        ).pipe(
          Effect.provide(
            createContextLayer(['finance:refundReceipts'], {
              database: fixture.database,
            }),
          ),
        );

        expect(result).toEqual({
          receiptCount: 1,
          totalAmount: 125,
          transactionId: 'transaction-1',
        });
        expect(fixture.insertedTransaction()).toMatchObject({
          amount: -125,
          currency: 'CZK',
          targetUserId: 'user-1',
        });
        expect(fixture.operations).toEqual([
          'receipts:update',
          'payout:share',
          'transaction:insert',
          'receipt:update',
        ]);
      }),
  );

  it.effect(
    'rejects reimbursement records when selected receipts have mixed submitters',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.createRefund'](
          {
            payoutReference: 'NL91ABNA0417164300',
            payoutType: 'iban',
            receiptIds: ['receipt-1', 'receipt-2'],
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:refundReceipts'], {
              database: databaseWithRefundableReceipts([
                {
                  currency: 'EUR',
                  eventId: 'event-1',
                  id: 'receipt-1',
                  submittedByUserId: 'user-1',
                  totalAmount: 100,
                },
                {
                  currency: 'EUR',
                  eventId: 'event-1',
                  id: 'receipt-2',
                  submittedByUserId: 'user-2',
                  totalAmount: 50,
                },
              ]),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('mismatchedSubmitter');
      }),
  );

  it.effect(
    'rejects reimbursement records that mix recorded receipt currencies',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.createRefund'](
          {
            payoutReference: 'NL91ABNA0417164300',
            payoutType: 'iban',
            receiptIds: ['receipt-eur', 'receipt-czk'],
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:refundReceipts'], {
              database: databaseWithRefundableReceipts([
                {
                  currency: 'EUR',
                  eventId: 'event-1',
                  id: 'receipt-eur',
                  submittedByUserId: 'user-1',
                  totalAmount: 100,
                },
                {
                  currency: 'CZK',
                  eventId: 'event-1',
                  id: 'receipt-czk',
                  submittedByUserId: 'user-1',
                  totalAmount: 200,
                },
              ]),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('mismatchedReceiptCurrency');
      }),
  );

  it.effect(
    'rejects zero-value reimbursements before recording a refund transaction',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.createRefund'](
          {
            payoutReference: 'NL91ABNA0417164300',
            payoutType: 'iban',
            receiptIds: ['receipt-1'],
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:refundReceipts'], {
              database: databaseWithRefundableReceipts([
                {
                  currency: 'EUR',
                  eventId: 'event-1',
                  id: 'receipt-1',
                  submittedByUserId: 'user-1',
                  totalAmount: 0,
                },
              ]),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('invalidReimbursementTotal');
      }),
  );

  it.effect(
    'rejects iban reimbursement records when the submitter has no iban',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.createRefund'](
          {
            payoutReference: 'NL91ABNA0417164300',
            payoutType: 'iban',
            receiptIds: ['receipt-1'],
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:refundReceipts'], {
              database: databaseWithRefundableReceiptForPayout({
                iban: null,
                id: 'user-1',
                paypalEmail: 'alice@example.com',
              }),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('missingIban');
      }),
  );

  it.effect(
    'rejects paypal reimbursement records when the submitter has no paypal email',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.createRefund'](
          {
            payoutReference: 'alice@example.com',
            payoutType: 'paypal',
            receiptIds: ['receipt-1'],
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:refundReceipts'], {
              database: databaseWithRefundableReceiptForPayout({
                iban: 'NL91ABNA0417164300',
                id: 'user-1',
                paypalEmail: null,
              }),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('missingPaypal');
      }),
  );

  it.effect(
    'rejects reimbursement records when the payout reference no longer matches the submitter',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.createRefund'](
          {
            payoutReference: 'other@example.com',
            payoutType: 'paypal',
            receiptIds: ['receipt-1'],
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:refundReceipts'], {
              database: databaseWithRefundableReceiptForPayout({
                iban: 'NL91ABNA0417164300',
                id: 'user-1',
                paypalEmail: 'alice@example.com',
              }),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('payoutReferenceMismatch');
      }),
  );

  it.effect(
    'rejects reimbursement records when receipt preconditions change before update',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.createRefund'](
          {
            payoutReference: 'NL91ABNA0417164300',
            payoutType: 'iban',
            receiptIds: ['receipt-1'],
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:refundReceipts'], {
              database: databaseWithRefundPreconditionRace(),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('receiptRefundPreconditionFailed');
      }),
  );
});

describe('finance receipt approval evidence', () => {
  it.effect(
    'approves only after HEAD succeeds and revalidates the locked binding',
    () =>
      Effect.gen(function* () {
        const fixture = databaseWithReceiptReviewLifecycle();
        const result = yield* financeHandlers['finance.receipts.review'](
          {
            ...receiptFieldsInput,
            id: 'receipt-1',
            status: 'approved',
          },
          { headers: {} } as never,
        ).pipe(
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], {
              database: fixture.database,
              receiptMediaService: {
                createUploadPolicy: () =>
                  Effect.dieMessage('Unexpected receipt upload'),
                objectExists: ({ storageKey }: { storageKey: string }) =>
                  Effect.sync(() => {
                    expect(storageKey).toBe(
                      'receipts/tenant-1/event-1/user-1/upload-1-receipt.png',
                    );
                    fixture.operations.push('storage:head');
                    return true;
                  }),
                signedPreviewUrl: () =>
                  Effect.succeed('https://signed.example.test/receipt'),
              },
            }),
          ),
        );

        expect(result).toEqual({ id: 'receipt-1', status: 'approved' });
        expect(fixture.operations).toEqual([
          'preflight',
          'storage:head',
          'transaction:start',
          'receipt:lock',
          'evidence:lock',
          'receipt:update',
          'email:enqueue',
        ]);
      }),
  );

  it.effect('blocks approval when the exact object is missing', () =>
    Effect.gen(function* () {
      const fixture = databaseWithReceiptReviewLifecycle();
      const error = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          status: 'approved',
        },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: fixture.database,
            receiptMediaService: {
              createUploadPolicy: () =>
                Effect.dieMessage('Unexpected receipt upload'),
              objectExists: () => Effect.succeed(false),
              signedPreviewUrl: () =>
                Effect.succeed('https://signed.example.test/receipt'),
            },
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('receiptEvidenceUnavailable');
      expect(fixture.operations).toEqual(['preflight']);
    }),
  );

  it.effect('blocks approval when the exact object cannot be signed', () =>
    Effect.gen(function* () {
      const fixture = databaseWithReceiptReviewLifecycle();
      const error = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          status: 'approved',
        },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: fixture.database,
            receiptMediaService: {
              createUploadPolicy: () =>
                Effect.dieMessage('Unexpected receipt upload'),
              objectExists: () => Effect.succeed(true),
              signedPreviewUrl: () =>
                Effect.fail(
                  new ReceiptMediaServiceUnavailableError({
                    message: 'Receipt storage is unavailable',
                  }),
                ),
            },
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('receiptEvidenceUnavailable');
      expect(fixture.operations).toEqual(['preflight']);
    }),
  );

  it.effect('rejects a foreign-scope key without sending it to storage', () =>
    Effect.gen(function* () {
      const fixture = databaseWithReceiptReviewLifecycle({
        preflightEvidence: submittedReceiptRow,
      });
      const objectExists = vi.fn(() => Effect.succeed(true));
      const error = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          status: 'approved',
        },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: fixture.database,
            receiptMediaService: {
              createUploadPolicy: () =>
                Effect.dieMessage('Unexpected receipt upload'),
              objectExists,
              signedPreviewUrl: () =>
                Effect.succeed('https://signed.example.test/receipt'),
            },
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('receiptEvidenceUnavailable');
      expect(objectExists).not.toHaveBeenCalled();
      expect(fixture.operations).toEqual(['preflight']);
    }),
  );

  it.effect(
    'rejects a same-scope key for a different upload without checking storage',
    () =>
      Effect.gen(function* () {
        const fixture = databaseWithReceiptReviewLifecycle({
          preflightEvidence: {
            ...submittedReceiptRow,
            attachmentStorageKey:
              'receipts/tenant-1/event-1/user-1/upload-2-receipt.png',
            attachmentStorageUrl:
              'https://storage.example.test/upload-2-receipt.png',
          },
        });
        const objectExists = vi.fn(() => Effect.succeed(true));
        const error = yield* financeHandlers['finance.receipts.review'](
          {
            ...receiptFieldsInput,
            id: 'receipt-1',
            status: 'approved',
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], {
              database: fixture.database,
              receiptMediaService: {
                createUploadPolicy: () =>
                  Effect.dieMessage('Unexpected receipt upload'),
                objectExists,
                signedPreviewUrl: () =>
                  Effect.succeed('https://signed.example.test/receipt'),
              },
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('receiptEvidenceUnavailable');
        expect(objectExists).not.toHaveBeenCalled();
        expect(fixture.operations).toEqual(['preflight']);
      }),
  );

  it.effect('refuses approval when the evidence key changes after HEAD', () =>
    Effect.gen(function* () {
      const fixture = databaseWithReceiptReviewLifecycle({
        lockedEvidence: {
          ...submittedReceiptRow,
          attachmentStorageKey:
            'receipts/tenant-1/event-1/user-1/upload-1-replaced.png',
          attachmentStorageUrl:
            'https://storage.example.test/upload-1-replaced.png',
        },
      });
      const error = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          status: 'approved',
        },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: fixture.database,
            receiptMediaService: {
              createUploadPolicy: () =>
                Effect.dieMessage('Unexpected receipt upload'),
              objectExists: () => Effect.succeed(true),
              signedPreviewUrl: () =>
                Effect.succeed('https://signed.example.test/receipt'),
            },
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('receiptEvidenceUnavailable');
      expect(fixture.operations).toEqual([
        'preflight',
        'transaction:start',
        'receipt:lock',
        'evidence:lock',
      ]);
    }),
  );

  it.effect('allows rejection without storage evidence', () =>
    Effect.gen(function* () {
      const fixture = databaseWithReceiptReviewLifecycle();
      const objectExists = vi.fn(() => Effect.succeed(false));
      const result = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          rejectionReason: 'The attachment cannot be reviewed',
          status: 'rejected',
        },
        { headers: {} } as never,
      ).pipe(
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: fixture.database,
            receiptMediaService: {
              createUploadPolicy: () =>
                Effect.dieMessage('Unexpected receipt upload'),
              objectExists,
              signedPreviewUrl: () =>
                Effect.succeed('https://signed.example.test/receipt'),
            },
          }),
        ),
      );

      expect(result).toEqual({ id: 'receipt-1', status: 'rejected' });
      expect(objectExists).not.toHaveBeenCalled();
      expect(fixture.operations).toEqual([
        'transaction:start',
        'receipt:lock',
        'receipt:update',
        'email:enqueue',
      ]);
    }),
  );
});

describe('finance receipt amount validation', () => {
  it.effect('allows receipt submissions before the event has ended', () =>
    Effect.gen(function* () {
      const receiptDatabase = databaseWithReceiptInsert({
        end: new Date(Date.now() + 60 * 60 * 1000),
      });

      const result = yield* financeHandlers['finance.receipts.submit'](
        receiptSubmitInput,
        { headers: {} } as never,
      ).pipe(
        Effect.provide(
          createContextLayer(['events:organizeAll'], {
            database: receiptDatabase.database,
          }),
        ),
      );

      expect(result).toEqual({ id: 'receipt-1' });
      expect(receiptDatabase.consumedValues()).toEqual({
        consumedAt: expect.any(Date),
        status: 'consumed',
      });
      expect(receiptDatabase.insertedValues()).toEqual(
        expect.objectContaining({
          attachmentUploadId: 'upload-1',
          currency: 'EUR',
          eventId: 'event-1',
          status: 'submitted',
          submittedByUserId: 'user-1',
          tenantId: 'tenant-1',
        }),
      );
    }),
  );

  it.effect(
    'rejects receipt submissions without a matching uploaded preflight',
    () =>
      Effect.gen(function* () {
        const receiptDatabase = databaseWithReceiptInsert(
          {},
          { uploadRows: [] },
        );

        const error = yield* financeHandlers['finance.receipts.submit'](
          receiptSubmitInput,
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['events:organizeAll'], {
              database: receiptDatabase.database,
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('receipt_upload_unavailable');
        expect(receiptDatabase.insertedValues()).toBeUndefined();
      }),
  );

  it.effect('rejects reusing a receipt upload', () =>
    Effect.gen(function* () {
      const receiptDatabase = databaseWithReceiptInsert(
        {},
        { existingReceiptRows: [{ id: 'receipt-existing' }] },
      );

      const error = yield* financeHandlers['finance.receipts.submit'](
        receiptSubmitInput,
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['events:organizeAll'], {
            database: receiptDatabase.database,
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('receipt_upload_unavailable');
      expect(receiptDatabase.insertedValues()).toBeUndefined();
    }),
  );

  it.effect('rejects receipt submissions when tax exceeds total', () =>
    Effect.gen(function* () {
      const error = yield* financeHandlers['finance.receipts.submit'](
        {
          ...receiptSubmitInput,
          fields: {
            ...receiptFieldsInput,
            taxAmount: 101,
            totalAmount: 100,
          },
        },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['events:organizeAll'], {
            database: databaseWithTenantEvent(),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('tax_amount_exceeds_total');
    }),
  );

  it.effect('rejects receipt review updates when tax exceeds total', () =>
    Effect.gen(function* () {
      const error = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          status: 'approved',
          taxAmount: 101,
          totalAmount: 100,
        },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: databaseWithSubmittedReceipt(),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('taxAmountExceedsTotal');
    }),
  );

  it.effect('rejects review updates for refunded receipts', () =>
    Effect.gen(function* () {
      const error = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          status: 'approved',
        },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: databaseWithReviewReceiptStatus('refunded'),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('refundedReceipt');
    }),
  );

  it.effect.each(['approved', 'rejected'] as const)(
    'rejects review updates for already %s receipts',
    (status) =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.review'](
          {
            ...receiptFieldsInput,
            id: 'receipt-1',
            status: 'approved',
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], {
              database: databaseWithReviewReceiptStatus(status),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('receiptAlreadyReviewed');
      }),
  );

  it.effect('requires a rejection reason when rejecting receipts', () =>
    Effect.gen(function* () {
      const error = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          rejectionReason: null,
          status: 'rejected',
        },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: databaseWithReviewReceiptStatus('submitted'),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('missingRejectionReason');
    }),
  );

  it.effect('rejects receipt review updates with invalid receipt dates', () =>
    Effect.gen(function* () {
      const error = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          receiptDate: 'not-a-date',
          status: 'approved',
        },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: databaseWithReviewReceiptStatus('submitted'),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('invalidReceiptDate');
    }),
  );
});
