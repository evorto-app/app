import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../../db';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from '../shared/rpc-access.service';
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

const databaseWithTenantEvent = () => ({
  query: {
    eventInstances: {
      findFirst: () => Effect.succeed({ id: 'event-1' }),
    },
  },
});

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
