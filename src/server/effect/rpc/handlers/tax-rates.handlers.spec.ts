import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../db';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';
import { taxRateHandlers } from './tax-rates.handlers';

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
  stripeAccountId: 'acct_current',
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
};

const createHeaders = (
  permissions: readonly Permission[],
  currentTenant = tenant,
) => ({
  [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
  [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson(permissions),
  [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(currentTenant),
});

describe('taxRateHandlers permissions', () => {
  it.effect(
    'lists only compatible active inclusive rates for the current tenant',
    () =>
      Effect.gen(function* () {
        const findMany = vi.fn(() =>
          Effect.succeed([
            {
              country: 'NL',
              displayName: 'Dutch VAT',
              id: 'tax-rate-1',
              percentage: '21',
              state: null,
              stripeTaxRateId: 'txr_vat_21',
            },
          ]),
        );
        const database = {
          query: {
            tenantStripeTaxRates: {
              findMany,
            },
          },
        };

        const result = yield* taxRateHandlers['taxRates.listActive'](
          undefined,
          {
            headers: createHeaders(['templates:view']),
          } as never,
        ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

        expect(result).toEqual([
          {
            country: 'NL',
            displayName: 'Dutch VAT',
            id: 'tax-rate-1',
            percentage: '21',
            state: null,
            stripeTaxRateId: 'txr_vat_21',
          },
        ]);
        expect(findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            columns: expect.objectContaining({
              displayName: true,
              stripeTaxRateId: true,
            }),
            where: {
              active: true,
              inclusive: true,
              stripeAccountId: 'acct_current',
              tenantId: 'tenant-1',
            },
          }),
        );
      }),
  );

  it.effect(
    'does not expose legacy unscoped rates without a current account',
    () =>
      Effect.gen(function* () {
        const findMany = vi.fn(() => Effect.succeed([]));
        const result = yield* taxRateHandlers['taxRates.listActive'](
          undefined,
          {
            headers: createHeaders(['templates:view'], {
              ...tenant,
              stripeAccountId: null,
            }),
          } as never,
        ).pipe(
          Effect.provide(
            Layer.succeed(Database, {
              query: { tenantStripeTaxRates: { findMany } },
            } as never),
          ),
        );

        expect(result).toEqual([]);
        expect(findMany).not.toHaveBeenCalled();
      }),
  );

  it.effect('allows template view through permission dependencies', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenantStripeTaxRates: {
            findMany: () => Effect.succeed([]),
          },
        },
      };

      const result = yield* taxRateHandlers['taxRates.listActive'](undefined, {
        headers: createHeaders(['events:create']),
      } as never).pipe(
        Effect.provide(Layer.succeed(Database, database as never)),
      );

      expect(result).toEqual([]);
    }),
  );

  it.effect('rejects authenticated users without template visibility', () =>
    Effect.gen(function* () {
      const error = yield* taxRateHandlers['taxRates.listActive'](undefined, {
        headers: createHeaders([]),
      } as never).pipe(Effect.flip);

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('templates:view');
    }),
  );
});
