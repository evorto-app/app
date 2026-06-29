import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../db';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from './shared/rpc-access.service';
import {
  normalizeTemplateFindOneRecord,
  templateHandlers,
} from './templates.handlers';

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

const templateInput = {
  categoryId: 'category-1',
  description: '<p>Useful event template description</p>',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  location: null,
  organizerRegistration: {
    closeRegistrationOffset: 24,
    isPaid: false,
    openRegistrationOffset: 168,
    price: 0,
    registrationMode: 'fcfs' as const,
    roleIds: ['role-1'],
    spots: 10,
    stripeTaxRateId: null,
  },
  participantRegistration: {
    closeRegistrationOffset: 24,
    isPaid: false,
    openRegistrationOffset: 168,
    price: 0,
    registrationMode: 'fcfs' as const,
    roleIds: ['role-1'],
    spots: 10,
    stripeTaxRateId: null,
  },
  title: 'Template',
};

describe('templateHandlers permissions', () => {
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
          query: {
            eventTemplates: {
              findFirst: () => Effect.succeed(),
            },
          },
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

describe('normalizeTemplateFindOneRecord', () => {
  it('returns reusable template add-ons with registration option attachments', () => {
    const record = normalizeTemplateFindOneRecord(
      {
        addOns: [
          {
            allowMultiple: true,
            allowPurchaseBeforeEvent: true,
            allowPurchaseDuringEvent: false,
            allowPurchaseDuringRegistration: true,
            description: 'Optional dinner ticket',
            id: 'addon-1',
            isPaid: true,
            maxQuantityPerUser: 2,
            price: 1200,
            stripeTaxRateId: 'txr-1',
            title: 'Dinner',
            totalAvailableQuantity: 40,
          },
        ],
        categoryId: 'category-1',
        description: '<p>Useful event template description</p>',
        icon: {
          iconColor: 0,
          iconName: 'calendar:fas',
        },
        id: 'template-1',
        location: null,
        planningTips: null,
        registrationOptions: [
          {
            closeRegistrationOffset: 24,
            description: null,
            id: 'template-option-1',
            isPaid: true,
            openRegistrationOffset: 168,
            organizingRegistration: false,
            price: 1200,
            registeredDescription: null,
            registrationMode: 'fcfs',
            roleIds: [],
            spots: 20,
            stripeTaxRateId: 'txr-1',
            title: 'Participant registration',
          },
        ],
        title: 'Template',
      },
      new Map(),
      new Map(),
      new Map([
        [
          'addon-1',
          [
            {
              quantity: 1,
              registrationOptionId: 'template-option-1',
            },
          ],
        ],
      ]),
    );

    expect(record.addOns).toEqual([
      {
        allowMultiple: true,
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: true,
        description: 'Optional dinner ticket',
        id: 'addon-1',
        isPaid: true,
        maxQuantityPerUser: 2,
        price: 1200,
        registrationOptions: [
          {
            quantity: 1,
            registrationOptionId: 'template-option-1',
          },
        ],
        stripeTaxRateId: 'txr-1',
        title: 'Dinner',
        totalAvailableQuantity: 40,
      },
    ]);
  });
});
