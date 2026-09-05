import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { assert, describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { readFileSync } from 'node:fs';

import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import {
  TemplatesCreate,
  TemplatesFindOne,
  TemplatesGroupedByCategory,
  TemplatesUpdate,
} from '../../../../shared/rpc-contracts/app-rpcs/templates.rpcs';
import { createRegistrationDatabaseTestLayer } from '../../../testing/registration-database';
import { RpcAccess } from './shared/rpc-access.service';
import { templateHandlers } from './templates.handlers';

const createRpcOptions = <R extends Rpc.Any>(rpc: R) => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc,
});

const rejectDatabaseQuery: SqlConnection.Connection['executeValues'] = (
  statement,
) => Effect.die(new Error(`Unexpected template handler SQL: ${statement}`));

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
  attributes: [],
  auth0Id: 'auth0|user-1',
  communicationEmail: undefined,
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
  databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: rejectDatabaseQuery,
  }),
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
    databaseLayer,
  );
};

const graphInput = {
  addOns: [],
  categoryId: 'category-1',
  description: '<p>Useful event template description</p>',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  location: null,
  planningTips: null,
  questions: [],
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 24,
      description: null,
      esnCardDiscountedPrice: null,
      isPaid: false,
      key: 'organizer',
      openRegistrationOffset: 168,
      organizingRegistration: true,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs' as const,
      roleIds: ['role-1'],
      spots: 10,
      stripeTaxRateId: null,
      title: 'Organizer registration',
      transferDeadlineHoursBeforeStart: null,
    },
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 24,
      description: null,
      esnCardDiscountedPrice: null,
      isPaid: false,
      key: 'participant',
      openRegistrationOffset: 168,
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'application' as const,
      roleIds: ['role-1'],
      spots: 20,
      stripeTaxRateId: null,
      title: 'Participant registration',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  simpleModeEnabled: true,
  title: 'Template',
};

const createTemplateReadFixture = (
  mode: 'missingStripe' | 'missingTemplate',
) => {
  let queryCount = 0;
  const transactionCommands: string[] = [];
  const executeValues: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      const sql = statement.replaceAll(/\s+/g, ' ').trim();
      assert.strictEqual(
        queryCount,
        0,
        'Only the expected precondition read may execute',
      );
      queryCount += 1;
      if (mode === 'missingStripe') {
        assert.deepEqual(transactionCommands, ['BEGIN']);
        assert.strictEqual(
          sql,
          'select "stripeAccountId" from "tenants" where "tenants"."id" = $1 for update',
        );
        assert.deepEqual(parameters, ['tenant-1']);
        return [[null]];
      }
      assert.deepEqual(transactionCommands, []);
      assert.strictEqual(
        sql,
        'select "categoryId", "description", "icon", "id", "location", "planningTips", "simpleModeEnabled", "title" from "event_templates" where (("event_templates"."id" = $1) and ("event_templates"."tenantId" = $2)) limit $3',
      );
      assert.deepEqual(parameters, ['template-1', 'tenant-1', 1]);
      return [];
    });
  const layer = createRegistrationDatabaseTestLayer({
    executeValues,
    transactionControl: (command) =>
      Effect.sync(() => {
        assert.strictEqual(mode, 'missingStripe');
        assert.strictEqual(
          command,
          transactionCommands.length === 0 ? 'BEGIN' : 'ROLLBACK',
        );
        assert.isBelow(transactionCommands.length, 2);
        transactionCommands.push(command);
      }),
  });
  return {
    assertComplete: () => {
      assert.strictEqual(queryCount, 1);
      assert.deepEqual(
        transactionCommands,
        mode === 'missingStripe' ? ['BEGIN', 'ROLLBACK'] : [],
      );
    },
    layer,
  };
};

describe('templateHandlers permissions', () => {
  it('serializes first template creation with tenant currency changes', () => {
    const source = readFileSync(
      new URL('templates.handlers.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      'lockTenantCurrencyForFinancialConfiguration(\n                transaction,\n                tenant.id,\n                tenant.currency,\n              )',
    );
    expect(
      source.indexOf('yield* lockTenantCurrencyForFinancialConfiguration'),
    ).toBeLessThan(
      source.indexOf('yield* TemplateGraphService.createTemplate'),
    );
    expect(source).toContain("'templates.create'");
    expect(source).toContain("'templates.update'");
    expect(source).toContain('TemplateGraphService.createTemplate');
    expect(source).toContain('TemplateGraphService.updateTemplate');
    expect(source).toContain('loadTemplateGraphDetail');
    expect(source).toContain('tenantId: tenant.id');
  });

  it.effect('graph create requires templates:create', () =>
    Effect.gen(function* () {
      const error = yield* templateHandlers['templates.create'](
        graphInput,
        createRpcOptions(
          TemplatesCreate.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        Effect.flip,
        Effect.provide(createContextLayer(['templates:view'])),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error).toMatchObject({ permission: 'templates:create' });
    }),
  );

  it.effect(
    'graph create rejects paid configuration when Stripe is not connected',
    () =>
      Effect.gen(function* () {
        const fixture = createTemplateReadFixture('missingStripe');
        const error = yield* templateHandlers['templates.create'](
          {
            ...graphInput,
            registrationOptions: graphInput.registrationOptions.map(
              (option, index) =>
                index === 0 ? { ...option, isPaid: true, price: 2500 } : option,
            ),
          },
          createRpcOptions(
            TemplatesCreate.middleware(RpcRequestContextMiddleware),
          ),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(['templates:create'], fixture.layer),
          ),
        );

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'paymentSetupRequired',
        });
        fixture.assertComplete();
      }),
  );

  it.effect('graph update requires templates:editAll', () =>
    Effect.gen(function* () {
      const error = yield* templateHandlers['templates.update'](
        { id: 'template-1', ...graphInput },
        createRpcOptions(
          TemplatesUpdate.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        Effect.flip,
        Effect.provide(createContextLayer(['templates:create'])),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error).toMatchObject({ permission: 'templates:editAll' });
    }),
  );

  it.effect('groupedByCategory requires templates:view', () =>
    Effect.gen(function* () {
      const error = yield* templateHandlers['templates.groupedByCategory'](
        undefined,
        createRpcOptions(
          TemplatesGroupedByCategory.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(Effect.flip, Effect.provide(createContextLayer([])));

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error).toMatchObject({ permission: 'templates:view' });
    }),
  );

  it.effect(
    'findOne accepts events:create through permission dependencies',
    () =>
      Effect.gen(function* () {
        const fixture = createTemplateReadFixture('missingTemplate');

        const error = yield* templateHandlers['templates.findOne'](
          { id: 'template-1' },
          createRpcOptions(
            TemplatesFindOne.middleware(RpcRequestContextMiddleware),
          ),
        ).pipe(
          Effect.flip,
          Effect.provide(createContextLayer(['events:create'], fixture.layer)),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error).toMatchObject({ reason: 'templateNotFound' });
        fixture.assertComplete();
      }),
  );
});
