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
import { SimpleTemplateService } from './templates/simple-template.service';

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

const createSimpleHandlerLayer = (
  permissions: readonly Permission[],
  database: unknown,
) =>
  Layer.mergeAll(
    createContextLayer(permissions, database),
    SimpleTemplateService.Default,
  );

const templateInput = {
  categoryId: 'category-1',
  description: '<p>Useful event template description</p>',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  location: null,
  organizerRegistration: {
    cancellationDeadlineHoursBeforeStart: null,
    closeRegistrationOffset: 24,
    isPaid: false,
    openRegistrationOffset: 168,
    price: 0,
    refundFeesOnCancellation: null,
    registrationMode: 'fcfs' as const,
    roleIds: ['role-1'],
    spots: 10,
    stripeTaxRateId: null,
    title: 'Organizer registration',
    transferDeadlineHoursBeforeStart: null,
  },
  participantRegistration: {
    cancellationDeadlineHoursBeforeStart: null,
    closeRegistrationOffset: 24,
    isPaid: false,
    openRegistrationOffset: 168,
    price: 0,
    refundFeesOnCancellation: null,
    registrationMode: 'fcfs' as const,
    roleIds: ['role-1'],
    spots: 10,
    stripeTaxRateId: null,
    title: 'Participant registration',
    transferDeadlineHoursBeforeStart: null,
  },
  title: 'Template',
};

const paidZeroPriceTemplateAddonInput = {
  allowMultiple: true,
  allowPurchaseBeforeEvent: true,
  allowPurchaseDuringEvent: false,
  allowPurchaseDuringRegistration: true,
  description: null,
  includedQuantity: 0,
  isPaid: true,
  maxQuantityPerUser: 2,
  optionalPurchaseQuantity: 1,
  price: 0,
  registrationOptionKind: 'participant' as const,
  stripeTaxRateId: 'txr_vat_19',
  title: 'Dinner',
  totalAvailableQuantity: 10,
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
  unlisted: false,
};

const createSimpleWriteValidationDatabase = (
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
      source.indexOf('yield* SimpleTemplateService.createSimpleTemplate'),
    );
    expect(source).toContain("'templates.create'");
    expect(source).toContain("'templates.update'");
    expect(source).toContain('TemplateGraphService.createTemplate');
    expect(source).toContain('TemplateGraphService.updateTemplate');
    expect(source).toContain('loadTemplateGraphDetail');
    expect(source).toContain('tenantId: tenant.id');
  });

  it.effect('create requires templates:create', () =>
    Effect.gen(function* () {
      const error = yield* templateHandlers['templates.createSimpleTemplate'](
        templateInput,
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(createContextLayer(['templates:view'])),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('templates:create');
    }),
  );

  it.effect('update requires templates:editAll', () =>
    Effect.gen(function* () {
      const error = yield* templateHandlers['templates.updateSimpleTemplate'](
        {
          id: 'template-1',
          ...templateInput,
        },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(createContextLayer(['templates:create'])),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('templates:editAll');
    }),
  );

  it.effect(
    'simple create surfaces a zero-price paid add-on as a typed bad request',
    () =>
      Effect.gen(function* () {
        const error = yield* templateHandlers['templates.createSimpleTemplate'](
          {
            ...templateInput,
            addOns: [paidZeroPriceTemplateAddonInput],
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSimpleHandlerLayer(
              ['templates:create'],
              createSimpleWriteValidationDatabase(),
            ),
          ),
        );

        expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
        expect(error.message).toBe(
          'Paid template add-ons require a positive price',
        );
      }),
  );

  it.effect(
    'simple create rejects paid configuration when Stripe is not connected',
    () =>
      Effect.gen(function* () {
        const error = yield* templateHandlers['templates.createSimpleTemplate'](
          {
            ...templateInput,
            participantRegistration: {
              ...templateInput.participantRegistration,
              isPaid: true,
              price: 2500,
            },
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSimpleHandlerLayer(
              ['templates:create'],
              createSimpleWriteValidationDatabase(null),
            ),
          ),
        );

        expect(error).toMatchObject({
          _tag: 'TemplateSimpleBadRequestError',
          message:
            'Connect Stripe before configuring paid registration options or add-ons',
        });
      }),
  );

  it.effect(
    'simple update surfaces a zero-price paid add-on as a typed bad request',
    () =>
      Effect.gen(function* () {
        const error = yield* templateHandlers['templates.updateSimpleTemplate'](
          {
            id: 'template-1',
            ...templateInput,
            addOns: [paidZeroPriceTemplateAddonInput],
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSimpleHandlerLayer(
              ['templates:editAll'],
              createSimpleWriteValidationDatabase(),
            ),
          ),
        );

        expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
        expect(error.message).toBe(
          'Paid template add-ons require a positive price',
        );
      }),
  );

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
              createSimpleWriteValidationDatabase(null),
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
