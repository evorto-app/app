import { expect, layer, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';

import { Database } from '../../../../db';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from './shared/rpc-access.service';
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
  name: 'Tenant',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  stripeAccountId: 'acct_current',
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
};

const createRequestContext = (
  permissions: readonly Permission[],
  currentTenant = tenant,
) =>
  ({
    authData: {},
    authenticated: true,
    permissions,
    platformAuthority: null,
    tenant: currentTenant,
    user: null,
    userAssigned: false,
  }) satisfies RpcRequestContextShape;

const taxRateHandlerLayer = Layer.mergeAll(
  RpcAccess.Default,
  Layer.succeed(RpcRequestContext, createRequestContext(['templates:view'])),
);

layer(taxRateHandlerLayer)('taxRateHandlers permissions', (it) => {
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
            headers: Headers.empty,
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
            headers: Headers.empty,
          } as never,
        ).pipe(
          Effect.provideService(
            RpcRequestContext,
            createRequestContext(['templates:view'], {
              ...tenant,
              stripeAccountId: null,
            }),
          ),
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
        headers: Headers.empty,
      } as never).pipe(
        Effect.provideService(
          RpcRequestContext,
          createRequestContext(['events:create']),
        ),
        Effect.provide(Layer.succeed(Database, database as never)),
      );

      expect(result).toEqual([]);
    }),
  );

  it.effect('rejects authenticated users without template visibility', () =>
    Effect.gen(function* () {
      const error = yield* taxRateHandlers['taxRates.listActive'](undefined, {
        headers: Headers.empty,
      } as never).pipe(
        Effect.provideService(RpcRequestContext, createRequestContext([])),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('templates:view');
    }),
  );
});
