import * as PgClient from '@effect/sql-pg/PgClient';
import { expect, layer, vi } from '@effect/vitest';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Effect, Layer, Schema } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';

import { Database } from '../../../../db';
import { relations } from '../../../../db/relations';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import { TaxRatesListActive } from '../../../../shared/rpc-contracts/app-rpcs/tax-rates.rpcs';
import { Tenant } from '../../../../types/custom/tenant';
import { RpcAccess } from './shared/rpc-access.service';
import { taxRateHandlers } from './tax-rates.handlers';

const tenant = Schema.decodeUnknownSync(Tenant)({
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
});

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

const unexpectedDatabaseAccess = Effect.die(
  new Error('Unexpected database access before authorization'),
);
const noDatabaseAccessLayer = Layer.effect(
  Database,
  PgDrizzle.makeWithDefaults({ relations }),
).pipe(
  Layer.provide(
    PgClient.layerFrom(
      PgClient.makeWith({
        acquirer: unexpectedDatabaseAccess,
        config: {},
        listenAcquirer: unexpectedDatabaseAccess,
        transactionAcquirer: unexpectedDatabaseAccess,
      }),
    ),
  ),
);
const rpcOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: TaxRatesListActive.middleware(RpcRequestContextMiddleware),
};

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
          rpcOptions,
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
          rpcOptions,
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

      const result = yield* taxRateHandlers['taxRates.listActive'](
        undefined,
        rpcOptions,
      ).pipe(
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
      const error = yield* taxRateHandlers['taxRates.listActive'](
        undefined,
        rpcOptions,
      ).pipe(
        Effect.provideService(RpcRequestContext, createRequestContext([])),
        Effect.provide(noDatabaseAccessLayer),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      if (error._tag !== 'RpcForbiddenError') return yield* Effect.die(error);
      expect(error.permission).toBe('templates:view');
    }),
  );
});
