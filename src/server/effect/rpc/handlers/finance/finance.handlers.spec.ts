import { describe, expect, it } from '@effect/vitest';
import { TransactionRollbackError } from 'drizzle-orm';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../../db';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
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
        uploadOriginal: () =>
          Effect.succeed({
            storageKey: 'receipts/tenant-1/event-1/user-1/file.png',
            storageUrl: 'local-unavailable://receipt',
          }),
      }) as never,
    ),
  );
};

const uploadInput = {
  eventId: 'event-1',
  fileBase64: Buffer.from('receipt').toString('base64'),
  fileName: 'receipt.png',
  fileSizeBytes: 7,
  mimeType: 'image/png',
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
    mimeType: 'image/png',
    sizeBytes: 7,
    storageKey: 'receipts/tenant-1/event-1/user-1/file.png',
    storageUrl: 'local-unavailable://receipt',
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

const databaseWithReceiptInsert = (event: { end?: Date; id?: string } = {}) => {
  let insertedValues: unknown;
  const insertQuery = {
    returning: () => Effect.succeed([{ id: 'receipt-1' }]),
    values: (values: unknown) => {
      insertedValues = values;
      return insertQuery;
    },
  };

  return {
    database: {
      ...databaseWithTenantEvent(event),
      insert: () => insertQuery,
    },
    insertedValues: () => insertedValues,
  };
};

const databaseWithSubmittedReceipt = () => ({
  query: {
    financeReceipts: {
      findFirst: () =>
        Effect.succeed({
          id: 'receipt-1',
          status: 'submitted' as const,
        }),
    },
  },
  update: () =>
    Effect.die(
      new Error('receipt update should not run after validation fails'),
    ),
});

const databaseWithRefundableReceipts = (
  receipts: {
    eventId: string;
    id: string;
    submittedByUserId: string;
    totalAmount: number;
  }[],
) => {
  const receiptQuery = {
    from: () => receiptQuery,
    select: () => receiptQuery,
    where: () => Effect.succeed(receipts),
  };

  return {
    query: {
      users: {
        findFirst: () =>
          Effect.die(new Error('payout user lookup should not run')),
      },
    },
    select: () => receiptQuery,
    transaction: () =>
      Effect.die(new Error('reimbursement transaction should not run')),
  };
};

const databaseWithRefundableReceiptForPayout = (payoutUser: {
  iban: null | string;
  id: string;
  paypalEmail: null | string;
}) => {
  const receiptQuery = {
    from: () => receiptQuery,
    select: () => receiptQuery,
    where: () =>
      Effect.succeed([
        {
          eventId: 'event-1',
          id: 'receipt-1',
          submittedByUserId: payoutUser.id,
          totalAmount: 100,
        },
      ]),
  };

  return {
    query: {
      users: {
        findFirst: () => Effect.succeed(payoutUser),
      },
    },
    select: () => receiptQuery,
    transaction: () =>
      Effect.die(new Error('reimbursement transaction should not run')),
  };
};

const databaseWithRefundPreconditionRace = () => {
  const receipts = [
    {
      eventId: 'event-1',
      id: 'receipt-1',
      submittedByUserId: 'user-1',
      totalAmount: 100,
    },
  ];
  const receiptQuery = {
    from: () => receiptQuery,
    select: () => receiptQuery,
    where: () => Effect.succeed(receipts),
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
  const tx = {
    insert: () => insertQuery,
    rollback: () => Effect.die(new TransactionRollbackError()),
    update: () => updateQuery,
  };

  return {
    query: {
      users: {
        findFirst: () =>
          Effect.succeed({
            iban: 'NL91ABNA0417164300',
            id: 'user-1',
            paypalEmail: null,
          }),
      },
    },
    select: () => receiptQuery,
    transaction: (run: (transaction: typeof tx) => Effect.Effect<unknown>) =>
      run(tx),
  };
};

const submittedReceiptRow = {
  alcoholAmount: 0,
  attachmentFileName: 'receipt.png',
  attachmentMimeType: 'image/png',
  attachmentStorageKey: 'local-unavailable/receipt.png',
  createdAt: new Date('2026-05-19T10:00:00.000Z'),
  depositAmount: 0,
  eventId: 'event-1',
  eventStart: new Date('2026-05-18T18:00:00.000Z'),
  eventTitle: 'City Walk',
  hasAlcohol: false,
  hasDeposit: false,
  id: 'receipt-1',
  previewImageUrl: 'local-unavailable://receipt.png',
  purchaseCountry: 'NL',
  receiptDate: new Date('2026-05-18T00:00:00.000Z'),
  refundedAt: null,
  refundTransactionId: null,
  rejectionReason: null,
  reviewedAt: null,
  status: 'submitted' as const,
  submittedByUserId: 'user-1',
  taxAmount: 20,
  totalAmount: 100,
  updatedAt: new Date('2026-05-19T10:00:00.000Z'),
};

const databaseWithMyReceipts = () => {
  const query = {
    from: () => query,
    innerJoin: () => query,
    orderBy: () => Effect.succeed([submittedReceiptRow]),
    select: () => query,
    where: () => query,
  };

  return {
    select: () => query,
  };
};

describe('financeHandlers composition', () => {
  it('contains the full finance rpc handler set', () => {
    expect(Object.keys(financeHandlers).toSorted()).toEqual([
      'finance.receiptMedia.uploadOriginal',
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
        submittedByCommunicationEmail: '   ',
        submittedByEmail: 'login@example.com',
      }),
    ).toBe('login@example.com');
  });

  it.effect(
    'returns normalized current-user receipt rows for profile display',
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
            attachmentStorageKey: 'local-unavailable/receipt.png',
            createdAt: '2026-05-19T10:00:00.000Z',
            depositAmount: 0,
            eventId: 'event-1',
            eventStart: '2026-05-18T18:00:00.000Z',
            eventTitle: 'City Walk',
            hasAlcohol: false,
            hasDeposit: false,
            id: 'receipt-1',
            previewImageUrl: 'local-unavailable://receipt.png',
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
});

describe('finance receipt media permissions', () => {
  it.effect('rejects receipt uploads without receipt-submit access', () =>
    Effect.gen(function* () {
      let uploadCalled = false;
      const error = yield* financeHandlers[
        'finance.receiptMedia.uploadOriginal'
      ](uploadInput, { headers: {} } as never).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer([], {
            database: databaseWithNoOrganizerReceiptAccess(),
            receiptMediaService: {
              uploadOriginal: () => {
                uploadCalled = true;
                return Effect.succeed({
                  storageKey: 'receipts/tenant-1/event-1/user-1/file.png',
                  storageUrl: 'local-unavailable://receipt',
                });
              },
            },
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('finance:submitReceipts:event-1');
      expect(uploadCalled).toBe(false);
    }),
  );

  it.effect('uploads receipt media after receipt-submit preflight passes', () =>
    Effect.gen(function* () {
      let capturedInput: unknown;
      const result = yield* financeHandlers[
        'finance.receiptMedia.uploadOriginal'
      ](uploadInput, { headers: {} } as never).pipe(
        Effect.provide(
          createContextLayer(['events:organizeAll'], {
            database: databaseWithTenantEvent(),
            receiptMediaService: {
              uploadOriginal: (input: unknown) => {
                capturedInput = input;
                return Effect.succeed({
                  storageKey: 'receipts/tenant-1/event-1/user-1/file.png',
                  storageUrl: 'local-unavailable://receipt',
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
          userId: 'user-1',
        }),
      );
      expect(result).toEqual({
        sizeBytes: 7,
        storageKey: 'receipts/tenant-1/event-1/user-1/file.png',
        storageUrl: 'local-unavailable://receipt',
      });
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
                  eventId: 'event-1',
                  id: 'receipt-1',
                  submittedByUserId: 'user-1',
                  totalAmount: 100,
                },
                {
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
      expect(receiptDatabase.insertedValues()).toEqual(
        expect.objectContaining({
          eventId: 'event-1',
          status: 'submitted',
          submittedByUserId: 'user-1',
          tenantId: 'tenant-1',
        }),
      );
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
});
