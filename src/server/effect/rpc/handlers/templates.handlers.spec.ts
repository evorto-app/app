import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

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
