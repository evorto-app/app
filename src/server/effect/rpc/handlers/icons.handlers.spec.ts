import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';

import { type Permission } from '../../../../shared/permissions/permissions';
import {
  CategoryManagementIconUsage,
  EventCreateIconUsage,
  EventEditIconUsage,
  IconsAdd,
  IconsSearch,
} from '../../../../shared/rpc-contracts/app-rpcs/icons.rpcs';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import { createRegistrationDatabaseTestLayer } from '../../../testing/registration-database';
import {
  buildIconSearchPattern,
  ensureIconCatalogReader,
  ensureIconUsageAuthorized,
  ICON_SEARCH_LIMIT,
  iconHandlers,
} from './icons.handlers';
import { RpcAccess } from './shared/rpc-access.service';

const createRpcOptions = <R extends Rpc.Any>(rpc: R) => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc,
});

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
  timezone: 'Europe/Berlin' as const,
  transferDeadlineHoursBeforeStart: 0,
} satisfies RpcRequestContextShape['tenant'];

const createUser = (permissions: readonly Permission[]) => ({
  auth0Id: 'auth0|user-1',
  communicationEmail: 'alice@example.com',
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

const createContextLayer = ({
  executeValues = () => Effect.die(new Error('Unexpected icon fixture SQL')),
  permissions = [],
  user = null,
}: {
  executeValues?: Parameters<
    typeof createRegistrationDatabaseTestLayer
  >[0]['executeValues'];
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
    createRegistrationDatabaseTestLayer({ executeValues }),
  );
};

describe('icon authoring authorization', () => {
  it.effect(
    'rejects an authenticated actor without a tenant user before touching the catalog',
    () =>
      Effect.gen(function* () {
        let databaseTouched = false;
        const executeValues = () => {
          databaseTouched = true;
          return Effect.die(new Error('Catalog access must not happen'));
        };
        const error = yield* iconHandlers['icons.add'](
          {
            icon: 'calendar',
            usage: EventCreateIconUsage.make({}),
          },
          createRpcOptions(IconsAdd.middleware(RpcRequestContextMiddleware)),
        ).pipe(
          Effect.flip,
          Effect.provide(createContextLayer({ executeValues })),
        );

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
      expect(error).toMatchObject({ permission: 'events:create' });
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

  it.effect('allows an event owner to add an icon for that event', () =>
    ensureIconUsageAuthorized(
      EventEditIconUsage.make({ eventId: 'event-1' }),
    ).pipe(
      Effect.provide(
        createContextLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              expect(statement).toBe(
                'select "d0"."creatorId" as "creatorId" from "event_instances" as "d0" where (("d0"."id" = $1) and ("d0"."tenantId" = $2)) limit $3',
              );
              expect(parameters).toEqual(['event-1', 'tenant-1', 1]);
              return [['user-1']];
            }),
          user: createUser([]),
        }),
      ),
    ),
  );

  it.effect(
    'does not let platform authority bypass tenant capability checks',
    () =>
      Effect.gen(function* () {
        let databaseTouched = false;
        const error = yield* ensureIconUsageAuthorized(
          EventCreateIconUsage.make({}),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              executeValues: () => {
                databaseTouched = true;
                return Effect.die(new Error('Catalog access must not happen'));
              },
              permissions: ['globalAdmin:manageTenants'],
              user: createUser([]),
            }),
          ),
        );

        expect(error._tag).toBe('RpcForbiddenError');
        expect(error).toMatchObject({ permission: 'events:create' });
        expect(databaseTouched).toBe(false);
      }),
  );
});

describe('icon search bounds', () => {
  it.effect(
    'rejects a principal without a tenant user before querying icons',
    () =>
      Effect.gen(function* () {
        let databaseTouched = false;
        const executeValues = () => {
          databaseTouched = true;
          return Effect.die(new Error('Catalog access must not happen'));
        };

        const error = yield* iconHandlers['icons.search'](
          { search: 'calendar' },
          createRpcOptions(IconsSearch.middleware(RpcRequestContextMiddleware)),
        ).pipe(
          Effect.flip,
          Effect.provide(createContextLayer({ executeValues })),
        );

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

      const result = yield* iconHandlers['icons.search'](
        { search: ' Icon ' },
        createRpcOptions(IconsSearch.middleware(RpcRequestContextMiddleware)),
      ).pipe(
        Effect.provide(
          createContextLayer({
            executeValues: (statement, parameters) =>
              Effect.sync(() => {
                expect(statement).toBe(
                  'select "commonName", "friendlyName", "id", "sourceColor" from "icons" where (("icons"."tenantId" = $1) and ((("icons"."commonName" ilike $2) or ("icons"."friendlyName" ilike $3)))) order by "icons"."commonName" asc limit $4',
                );
                expect(parameters).toEqual([
                  'tenant-1',
                  '%Icon%',
                  '%Icon%',
                  ICON_SEARCH_LIMIT,
                ]);
                const limit = parameters[3];
                if (typeof limit !== 'number') {
                  throw new TypeError('Expected an icon search row limit');
                }
                appliedLimit = limit;
                return rows
                  .slice(0, limit)
                  .map((row) => [
                    row.commonName,
                    row.friendlyName,
                    row.id,
                    row.sourceColor,
                  ]);
              }),
            user: createUser([]),
          }),
        ),
      );

      expect(appliedLimit).toBe(ICON_SEARCH_LIMIT);
      expect(result).toHaveLength(50);
      expect(result).toEqual(rows.slice(0, ICON_SEARCH_LIMIT));
    }),
  );
});
