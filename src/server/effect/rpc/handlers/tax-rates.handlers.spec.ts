import { expect, layer } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';

import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import { TaxRatesListActive } from '../../../../shared/rpc-contracts/app-rpcs/tax-rates.rpcs';
import { Tenant } from '../../../../types/custom/tenant';
import { createRegistrationDatabaseTestLayer } from '../../../testing/registration-database';
import { RpcAccess } from './shared/rpc-access.service';
import { taxRateHandlers } from './tax-rates.handlers';

const createTenant = (stripeAccountId: string | undefined = 'acct_current') =>
  new Tenant({
    cancellationDeadlineHoursBeforeStart: 120,
    currency: 'EUR',
    defaultLocation: undefined,
    discountProviders: { esnCard: { config: {}, status: 'disabled' } },
    domain: 'tenant.example.com',
    id: 'tenant-1',
    maxActiveRegistrationsPerUser: 0,
    name: 'Tenant',
    receiptSettings: { allowOther: false, receiptCountries: ['NL'] },
    refundFeesOnCancellation: true,
    stripeAccountId,
    theme: 'evorto',
    timezone: 'Europe/Amsterdam',
    transferDeadlineHoursBeforeStart: 0,
  });
const createRequestContext = (
  permissions: readonly Permission[],
  tenant = createTenant(),
) =>
  ({
    authData: {},
    authenticated: true,
    permissions,
    platformAuthority: null,
    tenant,
    user: null,
    userAssigned: false,
  }) satisfies RpcRequestContextShape;
const options = () => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: TaxRatesListActive.middleware(RpcRequestContextMiddleware),
});
const databaseFixture = (includeRate: boolean, allowedRead = true) => {
  let readCount = 0;
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        expect(allowedRead).toBe(true);
        expect(statement).toBe(
          'select "d0"."country" as "country", "d0"."displayName" as "displayName", "d0"."id" as "id", "d0"."percentage" as "percentage", "d0"."state" as "state", "d0"."stripeTaxRateId" as "stripeTaxRateId" from "tenant_stripe_tax_rates" as "d0" where (("d0"."active" = $1) and ("d0"."inclusive" = $2) and (("d0"."percentage" is not null)) and ("d0"."stripeAccountId" = $3) and ("d0"."tenantId" = $4)) order by "d0"."displayName" asc, "d0"."stripeTaxRateId" asc',
        );
        expect(parameters).toEqual([true, true, 'acct_current', 'tenant-1']);
        readCount += 1;
        return includeRate
          ? [
              ['NL', 'Dutch VAT', 'tax-rate-1', '21', null, 'txr_vat_21'],
              ['NL', 'Zero VAT', 'tax-rate-0', '0', null, 'txr_vat_0'],
            ]
          : [];
      }),
    transactionControl: () =>
      Effect.die(new Error('Tax listing must not open a transaction')),
  });
  return { databaseLayer, readCount: () => readCount };
};

layer(
  Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, createRequestContext(['templates:view'])),
  ),
)('taxRateHandlers permissions', (it) => {
  it.effect(
    'lists percentage-based active inclusive rates including zero for the current tenant account',
    () =>
      Effect.gen(function* () {
        const fixture = databaseFixture(true);
        const result = yield* taxRateHandlers['taxRates.listActive'](
          undefined,
          options(),
        ).pipe(Effect.provide(fixture.databaseLayer));
        expect(result).toEqual([
          {
            country: 'NL',
            displayName: 'Dutch VAT',
            id: 'tax-rate-1',
            percentage: '21',
            state: null,
            stripeTaxRateId: 'txr_vat_21',
          },
          {
            country: 'NL',
            displayName: 'Zero VAT',
            id: 'tax-rate-0',
            percentage: '0',
            state: null,
            stripeTaxRateId: 'txr_vat_0',
          },
        ]);
        expect(fixture.readCount()).toBe(1);
      }),
  );
  it.effect(
    'does not expose legacy unscoped rates without a current account',
    () =>
      Effect.gen(function* () {
        const fixture = databaseFixture(false, false);
        const tenant = new Tenant({
          ...createTenant(),
          stripeAccountId: undefined,
        });
        const result = yield* taxRateHandlers['taxRates.listActive'](
          undefined,
          options(),
        ).pipe(
          Effect.provideService(
            RpcRequestContext,
            createRequestContext(['templates:view'], tenant),
          ),
          Effect.provide(fixture.databaseLayer),
        );
        expect(result).toEqual([]);
        expect(fixture.readCount()).toBe(0);
      }),
  );
  it.effect('allows template view through permission dependencies', () =>
    Effect.gen(function* () {
      const fixture = databaseFixture(false);
      const result = yield* taxRateHandlers['taxRates.listActive'](
        undefined,
        options(),
      ).pipe(
        Effect.provideService(
          RpcRequestContext,
          createRequestContext(['events:create']),
        ),
        Effect.provide(fixture.databaseLayer),
      );
      expect(result).toEqual([]);
      expect(fixture.readCount()).toBe(1);
    }),
  );
  it.effect('rejects authenticated users without template visibility', () =>
    Effect.gen(function* () {
      const fixture = databaseFixture(false, false);
      const error = yield* taxRateHandlers['taxRates.listActive'](
        undefined,
        options(),
      ).pipe(
        Effect.provideService(RpcRequestContext, createRequestContext([])),
        Effect.provide(fixture.databaseLayer),
        Effect.flip,
      );
      expect(error._tag).toBe('RpcForbiddenError');
      if (error._tag !== 'RpcForbiddenError') {
        return yield* Effect.die(
          new Error('Expected a forbidden tax-rate response'),
        );
      }
      expect(error.permission).toBe('templates:view');
      expect(fixture.readCount()).toBe(0);
    }),
  );
});
