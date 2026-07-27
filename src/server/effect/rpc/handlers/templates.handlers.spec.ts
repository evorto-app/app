import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { readFileSync } from 'node:fs';

import { Database } from '../../../../db';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from './shared/rpc-access.service';
import { templateHandlers } from './templates.handlers';

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
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
};

const createUser = (permissions: readonly Permission[]) => ({
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
  database: unknown = {},
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
    Layer.succeed(Database, database as never),
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

const createGraphWriteValidationDatabase = (
  stripeAccountId: null | string = 'acct_connected',
) => {
  const transactionalDatabase = {
    execute: () => Effect.void,
    query: {
      eventTemplateCategories: {
        findFirst: () => Effect.succeed({ id: 'category-1' }),
      },
      roles: {
        findMany: () => Effect.succeed([{ id: 'role-1' }]),
      },
    },
    select: (selection: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          for: () =>
            Effect.succeed(
              Reflect.has(selection, 'stripeAccountId')
                ? [{ stripeAccountId }]
                : [{ currency: 'EUR', id: 'tenant-1' }],
            ),
        }),
      }),
    }),
  };

  return {
    $client: {},
    transaction: (
      operation: (database: typeof transactionalDatabase) => unknown,
    ) => operation(transactionalDatabase),
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
      const error = yield* templateHandlers['templates.create'](graphInput, {
        headers: {},
      } as never).pipe(
        Effect.flip,
        Effect.provide(createContextLayer(['templates:view'])),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('templates:create');
    }),
  );

  it.effect(
    'graph create rejects paid configuration when Stripe is not connected',
    () =>
      Effect.gen(function* () {
        const error = yield* templateHandlers['templates.create'](
          {
            ...graphInput,
            registrationOptions: graphInput.registrationOptions.map(
              (option, index) =>
                index === 0 ? { ...option, isPaid: true, price: 2500 } : option,
            ),
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer(
              ['templates:create'],
              createGraphWriteValidationDatabase(null),
            ),
          ),
        );

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'stripeRequiredForPaidEventConfiguration',
        });
      }),
  );

  it.effect('graph update requires templates:editAll', () =>
    Effect.gen(function* () {
      const error = yield* templateHandlers['templates.update'](
        { id: 'template-1', ...graphInput },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(createContextLayer(['templates:create'])),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('templates:editAll');
    }),
  );

  it.effect('groupedByCategory requires templates:view', () =>
    Effect.gen(function* () {
      const error = yield* templateHandlers['templates.groupedByCategory'](
        undefined,
        { headers: {} } as never,
      ).pipe(Effect.flip, Effect.provide(createContextLayer([])));

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('templates:view');
    }),
  );

  it.effect(
    'findOne accepts events:create through permission dependencies',
    () =>
      Effect.gen(function* () {
        const database = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Effect.succeed([]),
              }),
            }),
          }),
        };

        const error = yield* templateHandlers['templates.findOne'](
          { id: 'template-1' },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(createContextLayer(['events:create'], database)),
        );

        expect(error['_tag']).toBe('TemplateSimpleNotFoundError');
      }),
  );
});
