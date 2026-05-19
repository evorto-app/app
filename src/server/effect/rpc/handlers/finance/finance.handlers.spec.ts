import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from '../shared/rpc-access.service';
import { financeHandlers } from './finance.handlers';

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

const createContextLayer = (permissions: readonly Permission[]) => {
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions,
    tenant,
    user: null,
    userAssigned: false,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, requestContext),
  );
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
