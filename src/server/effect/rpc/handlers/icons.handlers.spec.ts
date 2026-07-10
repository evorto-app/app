import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database, type DatabaseClient } from '../../../../db';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  CategoryManagementIconUsage,
  EventCreateIconUsage,
  EventEditIconUsage,
} from '../../../../shared/rpc-contracts/app-rpcs/icons.rpcs';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import {
  buildIconSearchPattern,
  ensureIconCatalogReader,
  ensureIconUsageAuthorized,
  ICON_SEARCH_LIMIT,
  iconHandlers,
} from './icons.handlers';
import { RpcAccess } from './shared/rpc-access.service';

const tenant = {
  canonicalRootUrl: 'https://tenant.example.com',
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
  locale: 'en-GB' as const,
  name: 'Tenant',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Berlin' as const,
} satisfies RpcRequestContextShape['tenant'];

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

const createContextLayer = ({
  database = {},
  permissions = [],
  user = null,
}: {
  database?: unknown;
  permissions?: readonly Permission[];
  user?: null | ReturnType<typeof createUser>;
}) => {
  const requestContext = {
    authData: { sub: 'auth0|actor' },
    authenticated: true,
    permissions,
    tenant,
    user,
    userAssigned: user !== null,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, requestContext),
    Layer.succeed(Database, database as DatabaseClient),
  );
};

describe('icon authoring authorization', () => {
  it.effect(
    'rejects an authenticated actor without a tenant user before touching the catalog',
    () =>
      Effect.gen(function* () {
        let databaseTouched = false;
        const database = Object.defineProperty({}, 'query', {
          get: () => {
            databaseTouched = true;
            throw new Error('Catalog access must not happen');
          },
        });
        const error = yield* iconHandlers['icons.add'](
          {
            icon: 'calendar',
            usage: EventCreateIconUsage.make({}),
          },
          { headers: {} },
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error._tag).toBe('RpcUnauthorizedError');
        expect(databaseTouched).toBe(false);
      }),
  );

  it.effect('requires the same event-create capability as the event form', () =>
    Effect.gen(function* () {
      const error = yield* ensureIconUsageAuthorized(
        EventCreateIconUsage.make({}),
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer({ permissions: [], user: createUser([]) }),
        ),
      );

      expect(error._tag).toBe('RpcForbiddenError');
      expect(error.permission).toBe('events:create');
    }),
  );

  it.effect(
    'allows category authors with the category-management capability',
    () =>
      ensureIconUsageAuthorized(CategoryManagementIconUsage.make({})).pipe(
        Effect.provide(
          createContextLayer({
            permissions: ['templates:manageCategories'],
            user: createUser(['templates:manageCategories']),
          }),
        ),
      ),
  );

  it.effect('allows an event owner to add an icon for that event', () => {
    const database = {
      query: {
        eventInstances: {
          findFirst: () => Effect.succeed({ creatorId: 'user-1' }),
        },
      },
    };

    return ensureIconUsageAuthorized(
      EventEditIconUsage.make({ eventId: 'event-1' }),
    ).pipe(
      Effect.provide(createContextLayer({ database, user: createUser([]) })),
    );
  });

  it.effect(
    'allows an explicitly audited global administrator without a tenant user',
    () =>
      ensureIconUsageAuthorized(EventCreateIconUsage.make({})).pipe(
        Effect.provide(
          createContextLayer({ permissions: ['globalAdmin:manageTenants'] }),
        ),
      ),
  );
});

describe('icon search bounds', () => {
  it.effect(
    'rejects a principal without a tenant user before querying icons',
    () =>
      Effect.gen(function* () {
        let databaseTouched = false;
        const database = Object.defineProperty({}, 'select', {
          get: () => {
            databaseTouched = true;
            throw new Error('Catalog access must not happen');
          },
        });

        const error = yield* iconHandlers['icons.search'](
          { search: 'calendar' },
          { headers: {} },
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error._tag).toBe('RpcUnauthorizedError');
        expect(databaseTouched).toBe(false);
      }),
  );

  it.effect(
    'allows an explicit platform administrator without a tenant user',
    () =>
      ensureIconCatalogReader().pipe(
        Effect.provide(
          createContextLayer({ permissions: ['globalAdmin:manageTenants'] }),
        ),
      ),
  );

  it('trims search text and escapes wildcard characters literally', () => {
    expect(buildIconSearchPattern(String.raw`  50%_\off  `)).toBe(
      String.raw`%50\%\_\\off%`,
    );
  });

  it.effect('caps tenant search results at 50 records', () =>
    Effect.gen(function* () {
      let appliedLimit = 0;
      const rows = Array.from({ length: 60 }, (_, index) => ({
        commonName: `icon-${index}`,
        friendlyName: `Icon ${index}`,
        id: `icon-${index}`,
        sourceColor: null,
      }));
      const database = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: (limit: number) => {
                  appliedLimit = limit;
                  return Effect.succeed(rows.slice(0, limit));
                },
              }),
            }),
          }),
        }),
      };

      const result = yield* iconHandlers['icons.search'](
        { search: ' Icon ' },
        { headers: {} },
      ).pipe(
        Effect.provide(createContextLayer({ database, user: createUser([]) })),
      );

      expect(appliedLimit).toBe(ICON_SEARCH_LIMIT);
      expect(result).toHaveLength(50);
    }),
  );
});
