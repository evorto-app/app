import { expect, layer } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Headers from 'effect/http/Headers';
import { Rpc, RpcMessage } from 'effect/rpc';

import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import { TemplateCategoriesFindMany } from '../../../../shared/rpc-contracts/app-rpcs/template-categories.rpcs';
import { Tenant } from '../../../../types/custom/tenant';
import { createRegistrationDatabaseTestLayer } from '../../../testing/registration-database';
import { RpcAccess } from './shared/rpc-access.service';
import { templateCategoryHandlers } from './template-categories.handlers';

const tenant = new Tenant({
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
  stripeAccountId: undefined,
  theme: 'evorto',
  timezone: 'Europe/Amsterdam',
  transferDeadlineHoursBeforeStart: 0,
});

const createRequestContext = (
  permissions: readonly Permission[],
  overrides: { authenticated?: boolean; userAssigned?: boolean } = {},
) =>
  ({
    authData: {},
    authenticated: overrides.authenticated ?? true,
    permissions,
    platformAuthority: null,
    tenant,
    user: null,
    userAssigned: overrides.userAssigned ?? false,
  }) satisfies RpcRequestContextShape;

const options = () => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: TemplateCategoriesFindMany.middleware(RpcRequestContextMiddleware),
});

const expectedStatement =
  'select "d0"."icon" as "icon", "d0"."id" as "id", "d0"."title" as "title" from "event_template_categories" as "d0" where "d0"."tenantId" = $1';

const databaseFixture = () => {
  let readCount = 0;
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        expect(statement).toBe(expectedStatement);
        expect(parameters).toEqual(['tenant-1']);
        readCount += 1;
        return [
          [{ iconColor: 3, iconName: 'party-horn' }, 'category-1', 'Parties'],
        ];
      }),
    transactionControl: () =>
      Effect.die(new Error('Category listing must not open a transaction')),
  });
  return { databaseLayer, readCount: () => readCount };
};

const findMany = (
  context: RpcRequestContextShape,
  fixture: ReturnType<typeof databaseFixture>,
) =>
  templateCategoryHandlers['templateCategories.findMany'](
    undefined,
    options(),
  ).pipe(
    Effect.provideService(RpcRequestContext, context),
    Effect.provide(fixture.databaseLayer),
  );

layer(
  Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, createRequestContext([])),
  ),
)('templateCategoryHandlers findMany permissions', (it) => {
  it.effect('rejects anonymous callers before reading categories', () =>
    Effect.gen(function* () {
      const fixture = databaseFixture();
      const error = yield* findMany(
        createRequestContext([], { authenticated: false }),
        fixture,
      ).pipe(Effect.flip);
      expect(error._tag).toBe('RpcUnauthorizedError');
      expect(fixture.readCount()).toBe(0);
    }),
  );

  it.effect(
    'rejects signed-in non-members without any permission before reading categories',
    () =>
      Effect.gen(function* () {
        const fixture = databaseFixture();
        const error = yield* findMany(
          createRequestContext([], { userAssigned: false }),
          fixture,
        ).pipe(Effect.flip);
        expect(error._tag).toBe('RpcForbiddenError');
        expect(fixture.readCount()).toBe(0);
      }),
  );

  it.effect(
    'rejects members whose permissions do not relate to templates',
    () =>
      Effect.gen(function* () {
        const fixture = databaseFixture();
        const error = yield* findMany(
          createRequestContext(['users:viewAll'], { userAssigned: true }),
          fixture,
        ).pipe(Effect.flip);
        expect(error._tag).toBe('RpcForbiddenError');
        expect(fixture.readCount()).toBe(0);
      }),
  );

  it.effect.each([
    'templates:view',
    'templates:create',
    'templates:editAll',
    'templates:manageCategories',
    'templates:*',
  ] as const satisfies readonly Permission[])(
    'returns the tenant categories for %s alone',
    (permission) =>
      Effect.gen(function* () {
        const fixture = databaseFixture();
        const result = yield* findMany(
          createRequestContext([permission], { userAssigned: true }),
          fixture,
        );
        expect(result).toEqual([
          {
            icon: { iconColor: 3, iconName: 'party-horn' },
            id: 'category-1',
            title: 'Parties',
          },
        ]);
        expect(fixture.readCount()).toBe(1);
      }),
  );

  it.effect('allows events:create through its templates:view dependency', () =>
    Effect.gen(function* () {
      const fixture = databaseFixture();
      const result = yield* findMany(
        createRequestContext(['events:create'], { userAssigned: true }),
        fixture,
      );
      expect(result).toHaveLength(1);
      expect(fixture.readCount()).toBe(1);
    }),
  );
});
