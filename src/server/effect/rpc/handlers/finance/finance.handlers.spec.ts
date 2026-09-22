import { describe, expect, it, vi } from '@effect/vitest';
import { TransactionRollbackError } from 'drizzle-orm';
import { Context, Effect, Exit, Layer } from 'effect';
import { Headers } from 'effect/unstable/http';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';

import { Database } from '../../../../../db';
import {
  financeReceipts,
  financeReceiptUploads,
} from '../../../../../db/schema';
import { RpcInternalServerError } from '../../../../../shared/errors/rpc-errors';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  AppRpcs,
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { ReceiptMediaServiceUnavailableError } from '../../../../../shared/rpc-contracts/app-rpcs/finance.errors';
import {
  ObjectStorage,
  ObjectStorageNotFoundError,
} from '../../../../integrations/object-storage';
import { RpcAccess } from '../shared/rpc-access.service';
import { financeReceiptSubmitterEmail } from './finance-receipts.handlers';
import { financeHandlers } from './finance.handlers';
import { ReceiptMediaService } from './receipt-media.service';

const receiptUploadRpc = [...AppRpcs.requests.values()].find(
  (rpc) => rpc._tag === 'finance.receiptMedia.finalizeUpload',
);
if (!receiptUploadRpc) throw new Error('Receipt finalization RPC is missing');
const receiptUploadOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: receiptUploadRpc.middleware(RpcRequestContextMiddleware),
};

const receiptReviewRpc = [...AppRpcs.requests.values()].find(
  (rpc) => rpc._tag === 'finance.receipts.review',
);
if (!receiptReviewRpc) throw new Error('Receipt review RPC is missing');
const receiptReviewOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: receiptReviewRpc.middleware(RpcRequestContextMiddleware),
};

const receiptCreateUploadRpc = [...AppRpcs.requests.values()].find(
  (rpc) => rpc._tag === 'finance.receiptMedia.createUpload',
);
if (!receiptCreateUploadRpc)
  throw new Error('finance.receiptMedia.createUpload RPC is missing');
const receiptCreateUploadOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: receiptCreateUploadRpc.middleware(RpcRequestContextMiddleware),
};

const receiptRefundRpc = [...AppRpcs.requests.values()].find(
  (rpc) => rpc._tag === 'finance.receipts.createRefund',
);
if (!receiptRefundRpc)
  throw new Error('finance.receipts.createRefund RPC is missing');
const receiptRefundOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: receiptRefundRpc.middleware(RpcRequestContextMiddleware),
};

const receiptMyRpc = [...AppRpcs.requests.values()].find(
  (rpc) => rpc._tag === 'finance.receipts.my',
);
if (!receiptMyRpc) throw new Error('finance.receipts.my RPC is missing');
const receiptMyOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: receiptMyRpc.middleware(RpcRequestContextMiddleware),
};

const receiptApprovalQueueRpc = [...AppRpcs.requests.values()].find(
  (rpc) => rpc._tag === 'finance.receipts.pendingApprovalGrouped',
);
if (!receiptApprovalQueueRpc)
  throw new Error('finance.receipts.pendingApprovalGrouped RPC is missing');
const receiptApprovalQueueOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: receiptApprovalQueueRpc.middleware(RpcRequestContextMiddleware),
};

const receiptSubmitRpc = [...AppRpcs.requests.values()].find(
  (rpc) => rpc._tag === 'finance.receipts.submit',
);
if (!receiptSubmitRpc)
  throw new Error('finance.receipts.submit RPC is missing');
const receiptSubmitOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: receiptSubmitRpc.middleware(RpcRequestContextMiddleware),
};

const financeTransactionsRpc = [...AppRpcs.requests.values()].find(
  (rpc) => rpc._tag === 'finance.transactions.findMany',
);
if (!financeTransactionsRpc)
  throw new Error('finance.transactions.findMany RPC is missing');
const financeTransactionsOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: financeTransactionsRpc.middleware(RpcRequestContextMiddleware),
};

const tenant = {
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR' as const,
  defaultLocation: undefined,
  discountProviders: {
    esnCard: {
      config: {},
      status: 'disabled' as const,
    },
  },
  domain: 'tenant.example.com',
  id: 'tenant-1',
  maxActiveRegistrationsPerUser: 0,
  name: 'Tenant',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  refundFeesOnCancellation: true,
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
  transferDeadlineHoursBeforeStart: 0,
};

const createUser = (permissions: readonly Permission[]) => ({
  auth0Id: 'auth0|user-1',
  communicationEmail: 'alice@example.com',
  email: 'alice@example.com',
  firstName: 'Alice',
  homeTenantId: undefined,
  homeTenantName: undefined,
  iban: undefined,
  id: 'user-1',
  lastName: 'Doe',
  paypalEmail: undefined,
  permissions,
  roleIds: [],
});

const createContextLayer = (
  permissions: readonly Permission[],
  options: {
    database?: unknown;
    receiptMediaService?: Partial<
      Context.Service.Shape<typeof ReceiptMediaService>
    >;
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
    Layer.succeed(ReceiptMediaService, {
      createUploadPolicy: () =>
        Effect.succeed({
          fields: { key: 'receipts/example.png' },
          storageKey: 'receipts/example.png',
          url: 'https://storage.example.test/bucket',
        }),
      discardPromotedUpload: () => Effect.void,
      inspectUpload: () =>
        Effect.succeed({
          body: new Uint8Array(7),
          mimeType: 'image/png',
          sizeBytes: 7,
          storageKey: 'receipts/example.png',
        }),
      objectExists: () => Effect.succeed(false),
      promoteUpload: () => Effect.void,
      signedPreviewUrl: () =>
        Effect.succeed('https://signed.example.test/receipt'),
      ...options.receiptMediaService,
    }),
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

const databaseWithPendingReceiptUpload = (failure?: {
  afterCommit: boolean;
  step: 'destination' | 'ready';
}) => {
  const upload: Pick<
    typeof financeReceiptUploads.$inferSelect,
    | 'eventId'
    | 'expiresAt'
    | 'fileName'
    | 'id'
    | 'mimeType'
    | 'rejectionReason'
    | 'sizeBytes'
    | 'status'
    | 'storageKey'
  > = {
    eventId: 'event-1',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    fileName: 'receipt.png',
    id: 'upload-1',
    mimeType: 'image/png',
    rejectionReason: null,
    sizeBytes: 7,
    status: 'pending',
    storageKey: 'receipt-uploads/tenant-1/event-1/user-1/upload-1-receipt.png',
  };
  let updatedValues: Partial<typeof financeReceiptUploads.$inferInsert> = {};
  const persistUpdate = () =>
    Effect.gen(function* () {
      const fails =
        (failure?.step === 'destination' &&
          updatedValues.storageKey !== undefined) ||
        (failure?.step === 'ready' && updatedValues.status === 'ready');
      if (!fails || failure?.afterCommit) {
        Object.assign(upload, updatedValues);
      }
      if (fails) {
        return yield* Effect.fail(new Error('Database response failed'));
      }
      return [{ ...upload }];
    });
  const updateQuery = {
    returning: persistUpdate,
    set: (values: Partial<typeof financeReceiptUploads.$inferInsert>) => {
      updatedValues = values;
      return updateQuery;
    },
    where: () => Object.assign(persistUpdate(), { returning: persistUpdate }),
  };

  return {
    database: {
      query: {
        financeReceiptUploads: {
          findFirst: () => Effect.sync(() => ({ ...upload })),
        },
      },
      update: (table: unknown) => {
        expect(table).toBe(financeReceiptUploads);
        return updateQuery;
      },
    },
    upload,
  };
};

const databaseWithConcurrentReceiptUpload = (winnerStorageKey: string) => {
  const pendingStorageKey =
    'receipt-uploads/tenant-1/event-1/user-1/upload-1-receipt.png';
  let loadCount = 0;
  const updateQuery = {
    returning: () => Effect.succeed([]),
    set: () => updateQuery,
    where: () => updateQuery,
  };

  return {
    query: {
      financeReceiptUploads: {
        findFirst: () =>
          Effect.succeed(
            loadCount++ === 0
              ? {
                  eventId: 'event-1',
                  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
                  fileName: 'receipt.png',
                  id: 'upload-1',
                  mimeType: 'image/png',
                  sizeBytes: 7,
                  status: 'pending' as const,
                  storageKey: pendingStorageKey,
                }
              : {
                  eventId: 'event-1',
                  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
                  fileName: 'receipt.png',
                  id: 'upload-1',
                  mimeType: 'image/png',
                  sizeBytes: 7,
                  status: 'ready' as const,
                  storageKey: winnerStorageKey,
                },
          ),
      },
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
  purchaseCountry: 'NL',
  receiptDate: '2026-05-18',
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
  },
  preflightEvidence = {
    ...submittedReceiptRow,
    attachmentStorageKey:
      'receipts/tenant-1/event-1/user-1/upload-1-receipt.png',
  },
  recordedCountry = 'NL',
}: {
  lockedEvidence?: typeof submittedReceiptRow;
  preflightEvidence?: typeof submittedReceiptRow;
  recordedCountry?: string;
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
          purchaseCountry: recordedCountry,
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
  let updatedCountry: string | undefined;
  const updateQuery = {
    returning: () => {
      operations.push('receipt:update');
      return Effect.succeed([{ id: 'receipt-1', status: updatedStatus }]);
    },
    set: (values: {
      purchaseCountry: string;
      status: 'approved' | 'rejected';
    }) => {
      updatedStatus = values.status;
      updatedCountry = values.purchaseCountry;
      return updateQuery;
    },
    where: () => updateQuery,
  };
  let queuedEmail: Record<string, unknown> | undefined;
  const emailQuery = {
    onConflictDoNothing: () => {
      operations.push('email:enqueue');
      return Effect.succeed([]);
    },
    values: (values: Record<string, unknown>) => {
      queuedEmail = values;
      return emailQuery;
    },
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
        run: (transactionClient: typeof transaction) => Effect.Effect<unknown>,
      ) => {
        operations.push('transaction:start');
        return run(transaction);
      },
    },
    operations,
    queuedEmail: () => queuedEmail,
    updatedCountry: () => updatedCountry,
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
        const objectExists = vi.fn(() =>
          Effect.die(new Error('Receipt list must not check object storage')),
        );
        const signedPreviewUrl = vi.fn(() =>
          Effect.die(new Error('Receipt list must not sign previews')),
        );
        const result = yield* financeHandlers['finance.receipts.my'](
          undefined,
          receiptMyOptions,
        ).pipe(
          Effect.provide(
            createContextLayer([], {
              database: databaseWithMyReceipts([
                {
                  ...submittedReceiptRow,
                  attachmentStorageKey,
                },
              ]),
              receiptMediaService: {
                objectExists,
                signedPreviewUrl,
              },
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
        expect(objectExists).not.toHaveBeenCalled();
        expect(signedPreviewUrl).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'fails closed for invalid upload bindings in current-user receipt rows',
    () =>
      Effect.gen(function* () {
        const result = yield* financeHandlers['finance.receipts.my'](
          undefined,
          receiptMyOptions,
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
            receiptDate: '2026-05-18',
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
        const objectExists = vi.fn(() =>
          Effect.die(new Error('Approval queue must not check object storage')),
        );
        const signedPreviewUrl = vi.fn(() =>
          Effect.die(new Error('Approval queue must not sign previews')),
        );
        const result = yield* financeHandlers[
          'finance.receipts.pendingApprovalGrouped'
        ](undefined, receiptApprovalQueueOptions).pipe(
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], {
              database: databaseWithPendingReceipts(),
              receiptMediaService: {
                objectExists,
                signedPreviewUrl,
              },
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
        expect(objectExists).not.toHaveBeenCalled();
        expect(signedPreviewUrl).not.toHaveBeenCalled();
      }),
  );
});

describe('finance receipt media permissions', () => {
  it.effect('rejects receipt uploads without receipt-submit access', () =>
    Effect.gen(function* () {
      let isUploadCalled = false;
      const error = yield* financeHandlers['finance.receiptMedia.createUpload'](
        uploadInput,
        receiptCreateUploadOptions,
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
      expect(error).toMatchObject({
        permission: 'finance:submitReceipts:event-1',
      });
      expect(isUploadCalled).toBe(false);
    }),
  );

  it.effect('uploads receipt media after receipt-submit preflight passes', () =>
    Effect.gen(function* () {
      let capturedInput: unknown;
      const lifecycleSteps: string[] = [];
      const result = yield* financeHandlers[
        'finance.receiptMedia.createUpload'
      ](uploadInput, receiptCreateUploadOptions).pipe(
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
    'explains when the event is no longer available for a receipt',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers[
          'finance.receiptMedia.createUpload'
        ](uploadInput, receiptCreateUploadOptions).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['events:organizeAll'], {
              database: {
                query: {
                  eventInstances: {
                    findFirst: () => Effect.succeed(undefined),
                  },
                },
              },
            }),
          ),
        );

        expect(error['_tag']).toBe('FinanceResourceNotFoundError');
        expect(error.message).toBe(
          'This event is no longer available, so no receipt was added. Go back and choose an available event before adding a receipt.',
        );
      }),
  );

  it.effect(
    'asks for the file again when an upload is no longer available',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers[
          'finance.receiptMedia.finalizeUpload'
        ]({ uploadId: 'missing-upload' }, receiptUploadOptions).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['events:organizeAll'], {
              database: {
                query: {
                  financeReceiptUploads: {
                    findFirst: () => Effect.succeed(undefined),
                  },
                },
              },
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'This receipt file is no longer available. Add the file again.',
        );
      }),
  );

  it.effect(
    'does not finalize an upload when receipt storage is unavailable',
    () =>
      Effect.gen(function* () {
        const lifecycleSteps: string[] = [];
        const error = yield* financeHandlers[
          'finance.receiptMedia.createUpload'
        ](uploadInput, receiptCreateUploadOptions).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['events:organizeAll'], {
              database: databaseWithReceiptUploadLifecycle(lifecycleSteps),
              receiptMediaService: {
                createUploadPolicy: () =>
                  Effect.fail(
                    new ReceiptMediaServiceUnavailableError({
                      message:
                        'Receipt files could not be opened or saved. No receipt was added or changed. Try opening or saving the receipt once more; if it fails again, contact Evorto support.',
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

  for (const missing of [true, false]) {
    it.effect(
      missing
        ? 'rejects a missing uploaded object and asks for a new file'
        : 'preserves finalizing ownership when inspection has a storage outage',
      () =>
        Effect.gen(function* () {
          const fixture = databaseWithPendingReceiptUpload();
          const get = vi.fn(() =>
            Effect.fail(
              missing
                ? new ObjectStorageNotFoundError()
                : new RpcInternalServerError({
                    message: 'Storage unavailable',
                  }),
            ),
          );
          const put = vi.fn(() =>
            Effect.die(new Error('Unexpected promotion')),
          );
          const storage = Layer.succeed(ObjectStorage)({
            deleteObject: () => Effect.die(new Error('Unexpected deletion')),
            exists: () => Effect.die(new Error('Unexpected existence probe')),
            get,
            metadata: () => Effect.die(new Error('Unexpected metadata read')),
            presignGet: () =>
              Effect.die(new Error('Unexpected preview signing')),
            presignPost: () =>
              Effect.die(new Error('Unexpected upload signing')),
            put,
          });
          const inspectUpload: Context.Service.Shape<
            typeof ReceiptMediaService
          >['inspectUpload'] = (input) =>
            ReceiptMediaService.inspectUpload(input).pipe(
              Effect.provide(ReceiptMediaService.Default),
              Effect.provide(storage),
            );
          const context = createContextLayer(['events:organizeAll'], {
            database: fixture.database,
            receiptMediaService: { inspectUpload },
          });
          const error = yield* financeHandlers[
            'finance.receiptMedia.finalizeUpload'
          ]({ uploadId: 'upload-1' }, receiptUploadOptions).pipe(
            Effect.flip,
            Effect.provide(context),
          );

          expect(error._tag).toBe(
            missing
              ? 'ReceiptMediaBadRequestError'
              : 'ReceiptMediaServiceUnavailableError',
          );
          expect(fixture.upload).toMatchObject({
            rejectionReason: missing
              ? 'This receipt file is no longer available. Add the file again.'
              : null,
            status: missing ? 'rejected' : 'finalizing',
            storageKey:
              'receipt-uploads/tenant-1/event-1/user-1/upload-1-receipt.png',
          });
          if (missing) {
            expect(error.message).toBe(
              'This receipt file is no longer available. Add the file again.',
            );
          }
          expect(get).toHaveBeenCalledExactlyOnceWith(
            fixture.upload.storageKey,
          );
          expect(put).not.toHaveBeenCalled();

          const retryError = yield* financeHandlers[
            'finance.receiptMedia.finalizeUpload'
          ]({ uploadId: 'upload-1' }, receiptUploadOptions).pipe(
            Effect.flip,
            Effect.provide(context),
          );
          expect(retryError._tag).toBe('RpcBadRequestError');
          expect(retryError.message).toBe(
            'This receipt file can no longer be used. Add the file again.',
          );
          expect(get).toHaveBeenCalledOnce();
          expect(put).not.toHaveBeenCalled();
        }),
    );
  }

  it.effect(
    'records the promoted immutable key when finalizing an upload',
    () =>
      Effect.gen(function* () {
        const fixture = databaseWithPendingReceiptUpload();
        const finalStorageKey = `receipts/tenant-1/event-1/user-1/upload-1-${'a'.repeat(64)}-receipt.png`;
        const promoteUpload = vi.fn(() =>
          Effect.sync(() => {
            expect(fixture.upload).toMatchObject({
              status: 'finalizing',
              storageKey: finalStorageKey,
            });
          }),
        );

        const result = yield* financeHandlers[
          'finance.receiptMedia.finalizeUpload'
        ]({ uploadId: 'upload-1' }, receiptUploadOptions).pipe(
          Effect.provide(
            createContextLayer(['events:organizeAll'], {
              database: fixture.database,
              receiptMediaService: {
                inspectUpload: () =>
                  Effect.succeed({
                    body: new Uint8Array(7),
                    mimeType: 'image/png',
                    sizeBytes: 7,
                    storageKey: finalStorageKey,
                  }),
                promoteUpload,
              },
            }),
          ),
        );

        expect(result).toEqual({
          fileName: 'receipt.png',
          mimeType: 'image/png',
          sizeBytes: 7,
          uploadId: 'upload-1',
        });
        expect(fixture.upload).toMatchObject({
          status: 'ready',
          storageKey: finalStorageKey,
        });
        expect(promoteUpload).toHaveBeenCalledOnce();
      }),
  );

  for (const step of ['destination', 'ready'] as const) {
    for (const afterCommit of [false, true]) {
      it.effect(
        `retains upload ownership when ${step} persistence fails ${afterCommit ? 'after' : 'before'} commit`,
        () =>
          Effect.gen(function* () {
            const fixture = databaseWithPendingReceiptUpload({
              afterCommit,
              step,
            });
            const finalStorageKey = `receipts/tenant-1/event-1/user-1/upload-1-${'a'.repeat(64)}-receipt.png`;
            const promoteUpload = vi.fn(() => Effect.void);
            const discardPromotedUpload = vi.fn(() => Effect.void);
            const inspectUpload = vi.fn<
              Context.Service.Shape<typeof ReceiptMediaService>['inspectUpload']
            >(() =>
              Effect.succeed({
                body: new Uint8Array(7),
                mimeType: 'image/png',
                sizeBytes: 7,
                storageKey: finalStorageKey,
              }),
            );
            const layer = createContextLayer(['events:organizeAll'], {
              database: fixture.database,
              receiptMediaService: {
                discardPromotedUpload,
                inspectUpload,
                promoteUpload,
              },
            });
            const error = yield* financeHandlers[
              'finance.receiptMedia.finalizeUpload'
            ]({ uploadId: 'upload-1' }, receiptUploadOptions).pipe(
              Effect.flip,
              Effect.provide(layer),
            );

            expect(error._tag).toBe('ReceiptMediaInternalError');
            expect(promoteUpload).toHaveBeenCalledTimes(
              step === 'ready' ? 1 : 0,
            );
            expect(discardPromotedUpload).not.toHaveBeenCalled();
            expect(fixture.upload.storageKey).toBe(
              step === 'ready' || afterCommit
                ? finalStorageKey
                : 'receipt-uploads/tenant-1/event-1/user-1/upload-1-receipt.png',
            );
            expect(fixture.upload.status).toBe(
              step === 'ready' && afterCommit ? 'ready' : 'finalizing',
            );
            if (step === 'ready' && afterCommit) {
              const retried = yield* financeHandlers[
                'finance.receiptMedia.finalizeUpload'
              ]({ uploadId: 'upload-1' }, receiptUploadOptions).pipe(
                Effect.provide(layer),
              );
              expect(retried.uploadId).toBe('upload-1');
              expect(inspectUpload).toHaveBeenCalledOnce();
              expect(promoteUpload).toHaveBeenCalledOnce();
            }
          }),
      );
    }
  }

  it.effect('keeps interrupted storage promotion owned by orphan cleanup', () =>
    Effect.gen(function* () {
      const fixture = databaseWithPendingReceiptUpload();
      const finalStorageKey = `receipts/tenant-1/event-1/user-1/upload-1-${'a'.repeat(64)}-receipt.png`;
      const discardPromotedUpload = vi.fn(() => Effect.void);
      const exit = yield* financeHandlers[
        'finance.receiptMedia.finalizeUpload'
      ]({ uploadId: 'upload-1' }, receiptUploadOptions).pipe(
        Effect.exit,
        Effect.provide(
          createContextLayer(['events:organizeAll'], {
            database: fixture.database,
            receiptMediaService: {
              discardPromotedUpload,
              inspectUpload: () =>
                Effect.succeed({
                  body: new Uint8Array(7),
                  mimeType: 'image/png',
                  sizeBytes: 7,
                  storageKey: finalStorageKey,
                }),
              promoteUpload: () => Effect.interrupt,
            },
          }),
        ),
      );
      expect(Exit.hasInterrupts(exit)).toBe(true);
      expect(fixture.upload).toMatchObject({
        status: 'finalizing',
        storageKey: finalStorageKey,
      });
      expect(discardPromotedUpload).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    'does not repeat storage inspection after a concurrent finalization wins',
    () =>
      Effect.gen(function* () {
        const winnerStorageKey = `receipts/tenant-1/event-1/user-1/upload-1-${'a'.repeat(64)}-receipt.png`;
        const discarded: string[] = [];
        const inspectUpload = vi.fn<
          Context.Service.Shape<typeof ReceiptMediaService>['inspectUpload']
        >(() =>
          Effect.die(new Error('Concurrent callers must not inspect storage')),
        );

        const result = yield* financeHandlers[
          'finance.receiptMedia.finalizeUpload'
        ]({ uploadId: 'upload-1' }, receiptUploadOptions).pipe(
          Effect.provide(
            createContextLayer(['events:organizeAll'], {
              database: databaseWithConcurrentReceiptUpload(winnerStorageKey),
              receiptMediaService: {
                discardPromotedUpload: (storageKey: string) =>
                  Effect.sync(() => {
                    discarded.push(storageKey);
                  }),
                inspectUpload,
              },
            }),
          ),
        );

        expect(result).toEqual({
          fileName: 'receipt.png',
          mimeType: 'image/png',
          sizeBytes: 7,
          uploadId: 'upload-1',
        });
        expect(inspectUpload).not.toHaveBeenCalled();
        expect(discarded).toEqual([]);
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
          financeTransactionsOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer([])));

        expect(error['_tag']).toBe('RpcForbiddenError');
        expect(error).toMatchObject({ permission: 'finance:viewTransactions' });
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
          receiptRefundOptions,
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
          comment:
            'Receipt reimbursement via bank transfer for 1 receipt across 1 event',
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
          receiptRefundOptions,
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
        expect(error).toMatchObject({ reason: 'mismatchedSubmitter' });
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
          receiptRefundOptions,
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
        expect(error).toMatchObject({ reason: 'mismatchedReceiptCurrency' });
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
          receiptRefundOptions,
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
        expect(error).toMatchObject({ reason: 'invalidReimbursementTotal' });
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
          receiptRefundOptions,
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
        expect(error).toMatchObject({ reason: 'missingIban' });
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
          receiptRefundOptions,
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
        expect(error).toMatchObject({ reason: 'missingPaypal' });
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
          receiptRefundOptions,
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
        expect(error).toMatchObject({ reason: 'payoutReferenceMismatch' });
      }),
  );

  it.effect(
    'surfaces a non-canonical persisted iban instead of recording a reimbursement',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.createRefund'](
          {
            payoutReference: 'DE89370400440532013000',
            payoutType: 'iban',
            receiptIds: ['receipt-1'],
          },
          receiptRefundOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:refundReceipts'], {
              database: databaseWithRefundableReceiptForPayout({
                iban: 'DE89 3704 0044 0532 0130 00',
                id: 'user-1',
                paypalEmail: 'alice@example.com',
              }),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error).toMatchObject({ reason: 'invalidIban' });
      }),
  );

  it.effect(
    'surfaces a non-canonical persisted paypal address instead of recording a reimbursement',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.createRefund'](
          {
            payoutReference: 'alice@example.com',
            payoutType: 'paypal',
            receiptIds: ['receipt-1'],
          },
          receiptRefundOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:refundReceipts'], {
              database: databaseWithRefundableReceiptForPayout({
                iban: 'NL91ABNA0417164300',
                id: 'user-1',
                paypalEmail: 'Alice@Example.Com',
              }),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error).toMatchObject({ reason: 'invalidPaypal' });
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
          receiptRefundOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:refundReceipts'], {
              database: databaseWithRefundPreconditionRace(),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'The selected receipts changed while this page was open. No reimbursement was recorded. Return to the reimbursement list and review the current selection.',
        );
        expect(error).toMatchObject({
          reason: 'receiptRefundPreconditionFailed',
        });
      }),
  );
});

describe('finance receipt approval evidence', () => {
  it.effect(
    'approves only after HEAD succeeds and revalidates the locked binding',
    () =>
      Effect.gen(function* () {
        const fixture = databaseWithReceiptReviewLifecycle();
        const signedPreviewUrl = vi.fn(() =>
          Effect.die(new Error('Approval must not sign a preview URL')),
        );
        const result = yield* financeHandlers['finance.receipts.review'](
          {
            ...receiptFieldsInput,
            id: 'receipt-1',
            status: 'approved',
          },
          receiptReviewOptions,
        ).pipe(
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], {
              database: fixture.database,
              receiptMediaService: {
                createUploadPolicy: () =>
                  Effect.die(new Error('Unexpected receipt upload')),
                objectExists: ({ storageKey }: { storageKey: string }) =>
                  Effect.sync(() => {
                    expect(storageKey).toBe(
                      'receipts/tenant-1/event-1/user-1/upload-1-receipt.png',
                    );
                    fixture.operations.push('storage:head');
                    return true;
                  }),
                signedPreviewUrl,
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
        expect(signedPreviewUrl).not.toHaveBeenCalled();
      }),
  );

  it.effect('blocks approval when the exact object is missing', () =>
    Effect.gen(function* () {
      const fixture = databaseWithReceiptReviewLifecycle();
      const signedPreviewUrl = vi.fn(() =>
        Effect.die(new Error('Approval must not sign a preview URL')),
      );
      const error = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          status: 'approved',
        },
        receiptReviewOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: fixture.database,
            receiptMediaService: {
              createUploadPolicy: () =>
                Effect.die(new Error('Unexpected receipt upload')),
              objectExists: () => Effect.succeed(false),
              signedPreviewUrl,
            },
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error).toMatchObject({ reason: 'receiptEvidenceUnavailable' });
      expect(fixture.operations).toEqual(['preflight']);
      expect(signedPreviewUrl).not.toHaveBeenCalled();
    }),
  );

  it.effect('propagates an approval evidence verification outage', () =>
    Effect.gen(function* () {
      const fixture = databaseWithReceiptReviewLifecycle();
      const signedPreviewUrl = vi.fn(() =>
        Effect.die(new Error('Approval must not sign a preview URL')),
      );
      const error = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          status: 'approved',
        },
        receiptReviewOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: fixture.database,
            receiptMediaService: {
              createUploadPolicy: () =>
                Effect.die(new Error('Unexpected receipt upload')),
              objectExists: () =>
                Effect.fail(
                  new ReceiptMediaServiceUnavailableError({
                    message:
                      'Receipt files could not be opened or saved. No receipt was added or changed. Try opening or saving the receipt once more; if it fails again, contact Evorto support.',
                  }),
                ),
              signedPreviewUrl,
            },
          }),
        ),
      );

      expect(error['_tag']).toBe('ReceiptMediaServiceUnavailableError');
      expect(error.message).toBe(
        'Receipt files could not be opened or saved. No receipt was added or changed. Try opening or saving the receipt once more; if it fails again, contact Evorto support.',
      );
      expect(fixture.operations).toEqual(['preflight']);
      expect(signedPreviewUrl).not.toHaveBeenCalled();
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
        receiptReviewOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: fixture.database,
            receiptMediaService: {
              createUploadPolicy: () =>
                Effect.die(new Error('Unexpected receipt upload')),
              objectExists,
              signedPreviewUrl: () =>
                Effect.succeed('https://signed.example.test/receipt'),
            },
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error).toMatchObject({ reason: 'receiptEvidenceUnavailable' });
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
          },
        });
        const objectExists = vi.fn(() => Effect.succeed(true));
        const error = yield* financeHandlers['finance.receipts.review'](
          {
            ...receiptFieldsInput,
            id: 'receipt-1',
            status: 'approved',
          },
          receiptReviewOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], {
              database: fixture.database,
              receiptMediaService: {
                createUploadPolicy: () =>
                  Effect.die(new Error('Unexpected receipt upload')),
                objectExists,
                signedPreviewUrl: () =>
                  Effect.succeed('https://signed.example.test/receipt'),
              },
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error).toMatchObject({ reason: 'receiptEvidenceUnavailable' });
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
        },
      });
      const error = yield* financeHandlers['finance.receipts.review'](
        {
          ...receiptFieldsInput,
          id: 'receipt-1',
          status: 'approved',
        },
        receiptReviewOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: fixture.database,
            receiptMediaService: {
              createUploadPolicy: () =>
                Effect.die(new Error('Unexpected receipt upload')),
              objectExists: () => Effect.succeed(true),
              signedPreviewUrl: () =>
                Effect.succeed('https://signed.example.test/receipt'),
            },
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error).toMatchObject({ reason: 'receiptEvidenceUnavailable' });
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
        receiptReviewOptions,
      ).pipe(
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: fixture.database,
            receiptMediaService: {
              createUploadPolicy: () =>
                Effect.die(new Error('Unexpected receipt upload')),
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

describe('finance receipt review countries', () => {
  it.effect.each([
    { country: 'DE', status: 'approved' },
    { country: 'DE', status: 'rejected' },
    { country: 'OTHER', status: 'approved' },
    { country: 'OTHER', status: 'rejected' },
  ] as const)(
    'preserves recorded $country during $status review',
    ({ country, status }) =>
      Effect.gen(function* () {
        const fixture = databaseWithReceiptReviewLifecycle({
          recordedCountry: country,
        });
        const result = yield* financeHandlers['finance.receipts.review'](
          {
            ...receiptFieldsInput,
            id: 'receipt-1',
            purchaseCountry: country,
            rejectionReason:
              status === 'rejected' ? 'Receipt could not be verified' : null,
            status,
          },
          receiptReviewOptions,
        ).pipe(
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], {
              database: fixture.database,
              receiptMediaService: { objectExists: () => Effect.succeed(true) },
            }),
          ),
        );
        expect(result).toEqual({ id: 'receipt-1', status });
        expect(fixture.updatedCountry()).toBe(country);
        expect(fixture.operations).toContain('receipt:lock');
        expect(fixture.operations).toContain('email:enqueue');
      }),
  );

  it.effect(
    'allows replacing a removed country with a currently allowed one',
    () =>
      Effect.gen(function* () {
        const fixture = databaseWithReceiptReviewLifecycle({
          recordedCountry: 'DE',
        });
        yield* financeHandlers['finance.receipts.review'](
          {
            ...receiptFieldsInput,
            id: 'receipt-1',
            rejectionReason: 'Receipt could not be verified',
            status: 'rejected',
          },
          receiptReviewOptions,
        ).pipe(
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], {
              database: fixture.database,
            }),
          ),
        );
        expect(fixture.updatedCountry()).toBe('NL');
      }),
  );

  it.effect(
    'rejects an unrelated unlisted replacement after locking the stored receipt',
    () =>
      Effect.gen(function* () {
        const fixture = databaseWithReceiptReviewLifecycle({
          recordedCountry: 'DE',
        });
        const error = yield* financeHandlers['finance.receipts.review'](
          {
            ...receiptFieldsInput,
            id: 'receipt-1',
            purchaseCountry: 'AT',
            rejectionReason: 'Receipt could not be verified',
            status: 'rejected',
          },
          receiptReviewOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], {
              database: fixture.database,
            }),
          ),
        );
        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'invalidPurchaseCountry',
        });
        expect(fixture.operations).toEqual([
          'transaction:start',
          'receipt:lock',
        ]);
        expect(fixture.updatedCountry()).toBeUndefined();
        expect(fixture.queuedEmail()).toBeUndefined();
      }),
  );
});

describe('finance receipt amount validation', () => {
  it.effect(
    'explains when an unavailable event prevents receipt submission',
    () =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.submit'](
          receiptSubmitInput,
          receiptSubmitOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['events:organizeAll'], {
              database: {
                query: {
                  eventInstances: {
                    findFirst: () => Effect.succeed(undefined),
                  },
                },
              },
            }),
          ),
        );

        expect(error['_tag']).toBe('FinanceResourceNotFoundError');
        expect(error.message).toBe(
          'This event is no longer available, so the receipt was not submitted. Go back and choose an available event before submitting a receipt.',
        );
      }),
  );

  it.effect('allows receipt submissions before the event has ended', () =>
    Effect.gen(function* () {
      const receiptDatabase = databaseWithReceiptInsert({
        end: new Date(Date.now() + 60 * 60 * 1000),
      });

      const result = yield* financeHandlers['finance.receipts.submit'](
        receiptSubmitInput,
        receiptSubmitOptions,
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
          receiptSubmitOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['events:organizeAll'], {
              database: receiptDatabase.database,
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error).toMatchObject({ reason: 'receipt_upload_unavailable' });
        expect(error.message).toBe(
          'This receipt file is no longer available. Add the file again.',
        );
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
        receiptSubmitOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['events:organizeAll'], {
            database: receiptDatabase.database,
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error).toMatchObject({ reason: 'receipt_upload_unavailable' });
      expect(error.message).toBe(
        'This receipt file has already been submitted.',
      );
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
        receiptSubmitOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['events:organizeAll'], {
            database: databaseWithTenantEvent(),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error).toMatchObject({ reason: 'taxAmountExceedsTotal' });
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
        receiptReviewOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: databaseWithSubmittedReceipt(),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error).toMatchObject({ reason: 'taxAmountExceedsTotal' });
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
        receiptReviewOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: databaseWithReviewReceiptStatus('refunded'),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error).toMatchObject({ reason: 'refundedReceipt' });
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
          receiptReviewOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], {
              database: databaseWithReviewReceiptStatus(status),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error).toMatchObject({ reason: 'receiptAlreadyReviewed' });
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
        receiptReviewOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: databaseWithReviewReceiptStatus('submitted'),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error).toMatchObject({ reason: 'missingRejectionReason' });
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
        receiptReviewOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer(['finance:approveReceipts'], {
            database: databaseWithReviewReceiptStatus('submitted'),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error).toMatchObject({ reason: 'invalidReceiptDate' });
    }),
  );

  it.effect.each([
    {
      expectedReason: 'invalidTotalAmount',
      override: { totalAmount: 0 },
    },
    {
      expectedReason: 'invalidTotalAmount',
      override: { totalAmount: 100.5 },
    },
    {
      expectedReason: 'depositAmountContradiction',
      override: { depositAmount: 10, hasDeposit: false },
    },
    {
      expectedReason: 'depositAmountContradiction',
      override: { depositAmount: 0, hasDeposit: true },
    },
    {
      expectedReason: 'alcoholAmountContradiction',
      override: { alcoholAmount: 10, hasAlcohol: false },
    },
  ] as const)(
    'rejects invalid receipt amount state %#',
    ({ expectedReason, override }) =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.review'](
          {
            ...receiptFieldsInput,
            ...override,
            id: 'receipt-1',
            status: 'approved',
          },
          receiptReviewOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], { database: {} }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error).toMatchObject({ reason: expectedReason });
      }),
  );

  it.effect.each(['2026-02-30', '2026-5-19', '2026-05-19T00:00:00.000Z'])(
    'rejects non-calendar receipt date %s',
    (receiptDate) =>
      Effect.gen(function* () {
        const error = yield* financeHandlers['finance.receipts.review'](
          {
            ...receiptFieldsInput,
            id: 'receipt-1',
            receiptDate,
            status: 'approved',
          },
          receiptReviewOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['finance:approveReceipts'], { database: {} }),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error).toMatchObject({ reason: 'invalidReceiptDate' });
      }),
  );
});
