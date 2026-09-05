import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { describe, expect, it } from '@effect/vitest';
import { createDatabaseTestLayer } from '@server/testing/database-test-layer';
import { createRegistrationDatabaseTestLayer } from '@server/testing/registration-database';
import { MAX_EVENT_ADDON_TYPES } from '@shared/registration-quantity-limits';
import { MAX_REGISTRATION_QUESTIONS } from '@shared/registration-question-limits';
import { EventsCreateRpcError } from '@shared/rpc-contracts/app-rpcs/events.errors';
import { Effect, Layer, Schema } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { vi } from 'vitest';

import { Database } from '../../../../../db';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestions,
  eventTemplates,
  roles,
} from '../../../../../db/schema';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import {
  EventsCreate,
  EventsUpdateAnnouncementDiscovery,
  EventsUpdateGraph,
} from '../../../../../shared/rpc-contracts/app-rpcs/events.rpcs';
import { RpcAccess } from '../shared/rpc-access.service';
import {
  buildEventAddonInsert,
  buildEventQuestionInsert,
  createEventGraph,
  eventLifecycleHandlers,
  requireCreatedEventOption,
  requireTemplateAddonMappingTarget,
  simpleEventOptionShapeIsValid,
  templateOptionSnapshotIsComplete,
} from './events-lifecycle.handlers';

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

const user = {
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
  permissions: ['events:create'] as const,
  roleIds: [],
};

const requestContext = {
  authData: {},
  authenticated: true,
  permissions: ['events:create'],
  tenant,
  user,
  userAssigned: true,
} satisfies RpcRequestContextShape;

const requestContextLayer = Layer.mergeAll(
  RpcAccess.Default,
  Layer.succeed(RpcRequestContext, requestContext),
);

const esnEnabledRequestContextLayer = Layer.mergeAll(
  RpcAccess.Default,
  Layer.succeed(RpcRequestContext, {
    ...requestContext,
    tenant: {
      ...tenant,
      discountProviders: {
        esnCard: {
          config: {},
          status: 'enabled' as const,
        },
      },
    },
  }),
);

const createInput = {
  description: '<p>Useful event description</p>',
  end: '2026-09-20T12:00:00.000Z',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationTime: '2026-09-19T12:00:00.000Z',
      description: null,
      esnCardDiscountedPrice: null,
      isPaid: false,
      openRegistrationTime: '2026-09-01T12:00:00.000Z',
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs' as const,
      roleIds: ['role-1'],
      spots: 10,
      stripeTaxRateId: null,
      title: 'Participant',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  start: '2026-09-20T10:00:00.000Z',
  templateId: 'template-1',
  title: 'Event',
};

const updateInput = {
  ...createInput,
  eventId: 'event-1',
  location: null,
  registrationOptions: createInput.registrationOptions.map((option) => ({
    ...option,
    id: 'option-1',
  })),
};

type GraphSqlCall = (
  ...args: Parameters<SqlConnection.Connection['executeValues']>
) => void;
type GraphUpdateInput = Parameters<
  (typeof eventLifecycleHandlers)['events.updateGraph']
>[0];

const graphUpdateInput = {
  addOns: [],
  description: updateInput.description,
  end: updateInput.end,
  eventId: updateInput.eventId,
  icon: updateInput.icon,
  location: updateInput.location,
  questions: [],
  registrationOptions: updateInput.registrationOptions.flatMap((option) => [
    {
      ...option,
      esnCardDiscountedPrice: null,
      key: option.id,
    },
    {
      ...option,
      esnCardDiscountedPrice: null,
      id: 'organizer-1',
      key: 'organizer-1',
      organizingRegistration: true,
      title: 'Organizer',
    },
  ]),
  simpleModeEnabled: false,
  start: updateInput.start,
  title: updateInput.title,
} satisfies GraphUpdateInput;

const graphUpdateRpcOptions = () => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: EventsUpdateGraph.middleware(RpcRequestContextMiddleware),
});

const graphDatabaseTimestamp = (value: Date) =>
  value.toISOString().replace('T', ' ').replace('Z', '');

const createGraphUpdateDatabase = ({
  simpleModeEnabled = false,
}: {
  simpleModeEnabled?: boolean;
} = {}) => {
  const event = {
    creatorId: user.id,
    description: graphUpdateInput.description,
    end: new Date(graphUpdateInput.end),
    icon: graphUpdateInput.icon,
    id: graphUpdateInput.eventId,
    location: graphUpdateInput.location,
    simpleModeEnabled,
    start: new Date(graphUpdateInput.start),
    status: 'DRAFT',
    title: graphUpdateInput.title,
  } satisfies Pick<
    typeof eventInstances.$inferSelect,
    | 'creatorId'
    | 'description'
    | 'end'
    | 'icon'
    | 'id'
    | 'location'
    | 'simpleModeEnabled'
    | 'start'
    | 'status'
    | 'title'
  >;
  const options = graphUpdateInput.registrationOptions.map(
    (option) =>
      ({
        cancellationDeadlineHoursBeforeStart:
          option.cancellationDeadlineHoursBeforeStart,
        closeRegistrationTime: new Date(option.closeRegistrationTime),
        description: option.description,
        id: option.id,
        isPaid: option.isPaid,
        openRegistrationTime: new Date(option.openRegistrationTime),
        organizingRegistration: option.organizingRegistration,
        price: option.price,
        refundFeesOnCancellation: option.refundFeesOnCancellation,
        registeredDescription: option.registeredDescription,
        registrationMode: option.registrationMode,
        roleIds: option.roleIds,
        spots: option.spots,
        stripeTaxRateId: option.stripeTaxRateId,
        title: option.title,
        transferDeadlineHoursBeforeStart:
          option.transferDeadlineHoursBeforeStart,
      }) satisfies Pick<
        typeof eventRegistrationOptions.$inferSelect,
        | 'cancellationDeadlineHoursBeforeStart'
        | 'closeRegistrationTime'
        | 'description'
        | 'id'
        | 'isPaid'
        | 'openRegistrationTime'
        | 'organizingRegistration'
        | 'price'
        | 'refundFeesOnCancellation'
        | 'registeredDescription'
        | 'registrationMode'
        | 'roleIds'
        | 'spots'
        | 'stripeTaxRateId'
        | 'title'
        | 'transferDeadlineHoursBeforeStart'
      >,
  );
  const sqlCalls = vi.fn<GraphSqlCall>();
  const eventWrites = vi.fn<GraphSqlCall>();
  const optionWrites = vi.fn<GraphSqlCall>();
  const operationOrder: string[] = [];
  const transactionCommands: string[] = [];
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        sqlCalls(statement, parameters);
        if (
          statement.startsWith(
            'select "d0"."creatorId" as "creatorId", "d0"."status" as "status"',
          )
        ) {
          expect(statement).toContain('from "event_instances" as "d0"');
          expect(statement).toContain('"d0"."id" = $1');
          expect(statement).toContain('"d0"."tenantId" = $2');
          expect(parameters).toEqual([event.id, tenant.id, 1]);
          return [[event.creatorId, event.status]];
        }
        if (
          statement ===
          'select "stripeAccountId" from "tenants" where "tenants"."id" = $1 for update'
        ) {
          expect(parameters).toEqual([tenant.id]);
          operationOrder.push('lock-account');
          return [['acct_replacement']];
        }
        if (
          statement.startsWith('select "id" from "event_instances"') &&
          statement.endsWith(' for update')
        ) {
          expect(statement).toContain('"event_instances"."id" = $1');
          expect(statement).toContain('"event_instances"."tenantId" = $2');
          expect(statement).toContain('"event_instances"."status" = $3');
          expect(parameters).toEqual([event.id, tenant.id, 'DRAFT']);
          operationOrder.push('lock-event');
          return [[event.id]];
        }
        if (
          statement.startsWith(
            'select "description", "end"::text, "icon", "id", "location", "simpleModeEnabled", "start"::text, "title" from "event_instances"',
          )
        ) {
          expect(statement).toContain('"event_instances"."id" = $1');
          expect(statement).toContain('"event_instances"."tenantId" = $2');
          expect(parameters).toEqual([event.id, tenant.id, 1]);
          return [
            [
              event.description,
              graphDatabaseTimestamp(event.end),
              event.icon,
              event.id,
              event.location,
              event.simpleModeEnabled,
              graphDatabaseTimestamp(event.start),
              event.title,
            ],
          ];
        }
        if (
          statement.includes(
            'from "event_registration_options" inner join "event_instances"',
          )
        ) {
          expect(statement).toContain(
            '"event_registration_options"."eventId" = $1',
          );
          expect(statement).toContain('"event_instances"."tenantId" = $2');
          expect(parameters).toEqual([event.id, tenant.id]);
          return options.map((option) => [
            option.cancellationDeadlineHoursBeforeStart,
            graphDatabaseTimestamp(option.closeRegistrationTime),
            option.description,
            option.id,
            option.isPaid,
            graphDatabaseTimestamp(option.openRegistrationTime),
            option.organizingRegistration,
            option.price,
            option.refundFeesOnCancellation,
            option.registeredDescription,
            option.registrationMode,
            option.roleIds,
            option.spots,
            option.stripeTaxRateId,
            option.title,
            option.transferDeadlineHoursBeforeStart,
          ]);
        }
        if (
          statement.startsWith('select ') &&
          statement.includes('from "event_registration_option_discounts"')
        ) {
          expect(parameters).toEqual([
            'esnCard',
            ...options.map((option) => option.id),
          ]);
          return [];
        }
        if (
          statement.startsWith('select ') &&
          (statement.includes(
            'from "event_addons" inner join "event_instances"',
          ) ||
            statement.includes(
              'from "event_registration_questions" inner join "event_instances"',
            ))
        ) {
          expect(statement).toContain('"event_instances"."tenantId" = $2');
          expect(parameters).toEqual([event.id, tenant.id]);
          return [];
        }
        if (statement.startsWith('update "event_instances" set ')) {
          expect(statement).toContain('"event_instances"."id" = $');
          expect(statement).toContain('"event_instances"."tenantId" = $');
          expect(statement).toContain('"event_instances"."status" = $');
          expect(parameters.slice(-3)).toEqual([event.id, tenant.id, 'DRAFT']);
          operationOrder.push('write-event');
          eventWrites(statement, parameters);
          return [[event.id]];
        }
        if (statement.startsWith('select pg_advisory_xact_lock(')) {
          expect(parameters).toEqual(['evorto:tenant-role-graph:tenant-1']);
          operationOrder.push('lock-role-graph');
          return [];
        }
        if (statement.startsWith('select "id" from "roles"')) {
          expect(statement).toContain('"roles"."tenantId" = $1');
          expect(parameters).toEqual([tenant.id, 'role-1']);
          return [['role-1']];
        }
        if (
          statement.startsWith(
            'select "d0"."stripeAccountId" as "stripeAccountId"',
          )
        ) {
          expect(statement).toContain('from "tenants" as "d0"');
          expect(parameters).toEqual([tenant.id, 1]);
          operationOrder.push('locked-tenant');
          return [['acct_replacement']];
        }
        if (statement.includes('from "tenant_stripe_tax_rates" as "d0"')) {
          expect(statement).toContain('"d0"."stripeAccountId" = $1');
          expect(statement).toContain('"d0"."stripeTaxRateId" = $2');
          expect(statement).toContain('"d0"."tenantId" = $3');
          expect(parameters).toEqual([
            'acct_replacement',
            'txr_original',
            tenant.id,
            1,
          ]);
          operationOrder.push('locked-tax-rate');
          return [];
        }
        if (
          /^(?:insert into|update|delete from) "event_registration/.test(
            statement,
          )
        ) {
          optionWrites(statement, parameters);
        }
        throw new Error(`Unexpected graph update SQL: ${statement}`);
      }),
    transactionControl: (command) =>
      Effect.sync(() => {
        transactionCommands.push(command);
        operationOrder.push(command);
      }),
  });
  return {
    databaseLayer,
    eventWrites,
    operationOrder,
    optionWrites,
    sqlCalls,
    transactionCommands,
  };
};

const withTransaction = <DatabaseMock extends object>(
  database: DatabaseMock,
) => {
  const originalSelect = Reflect.get(database, 'select') as
    ((selection: Record<string, unknown>) => unknown) | undefined;
  const originalQuery = Reflect.get(database, 'query');
  const transactionalDatabase = {
    ...database,
    execute: vi.fn(() => Effect.void),
    query: Object.assign(
      {},
      typeof originalQuery === 'object' && originalQuery !== null
        ? originalQuery
        : {},
      {
        tenants: {
          findFirst: vi.fn(() =>
            Effect.succeed({
              stripeAccountId: Reflect.has(database, 'stripeAccountId')
                ? Reflect.get(database, 'stripeAccountId')
                : 'acct_connected',
            }),
          ),
        },
      },
    ),
    select: vi.fn((selection: Record<string, unknown>) => {
      if (Reflect.has(selection, 'stripeAccountId')) {
        const stripeAccountId = Reflect.has(database, 'stripeAccountId')
          ? Reflect.get(database, 'stripeAccountId')
          : 'acct_connected';
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              for: vi.fn(() => Effect.succeed([{ stripeAccountId }])),
            })),
          })),
        };
      }
      if (selection['simpleModeEnabled'] === eventTemplates.simpleModeEnabled) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                for: vi.fn(() =>
                  Effect.succeed([
                    {
                      simpleModeEnabled:
                        Reflect.get(database, 'templateSimpleModeEnabled') ===
                        true,
                    },
                  ]),
                ),
              })),
            })),
          })),
        };
      }
      if (selection['id'] === roles.id) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => Effect.succeed([{ id: 'role-1' }])),
          })),
        };
      }
      if (!originalSelect) {
        throw new Error('Unexpected select');
      }
      return originalSelect(selection);
    }),
  };

  return {
    ...transactionalDatabase,
    $client: {},
    transaction: vi.fn(
      (
        run: (
          transaction: typeof transactionalDatabase,
        ) => Effect.Effect<unknown>,
      ) => run(transactionalDatabase),
    ),
  };
};

describe('eventLifecycleHandlers', () => {
  it('requires a complete one-to-one template option snapshot', () => {
    expect(
      templateOptionSnapshotIsComplete(
        ['template-option-2', 'template-option-1'],
        ['template-option-1', 'template-option-2'],
      ),
    ).toBe(true);
    expect(
      templateOptionSnapshotIsComplete(
        ['template-option-1'],
        ['template-option-1', 'template-option-2'],
      ),
    ).toBe(false);
    expect(
      templateOptionSnapshotIsComplete(
        ['template-option-1', 'template-option-1'],
        ['template-option-1', 'template-option-2'],
      ),
    ).toBe(false);
    expect(
      templateOptionSnapshotIsComplete(
        ['template-option-1', undefined],
        ['template-option-1', 'template-option-2'],
      ),
    ).toBe(false);
  });

  it.each(['add-on', 'discount', 'question'] as const)(
    'requires every declared template %s mapping to resolve exactly',
    (mappingKind) => {
      const createdOption = { createdOptionId: 'event-option-1' };
      const optionMap = new Map([['template-option-1', createdOption]]);

      expect(
        requireCreatedEventOption(optionMap, 'template-option-1', mappingKind),
      ).toBe(createdOption);
      expect(() =>
        requireCreatedEventOption(
          optionMap,
          'template-option-missing',
          mappingKind,
        ),
      ).toThrow(
        `Template ${mappingKind} mapping references missing registration option template-option-missing`,
      );
    },
  );

  it('requires every declared add-on mapping to reference a copied add-on', () => {
    const templateAddonIds = new Set(['template-addon-1']);

    expect(() =>
      requireTemplateAddonMappingTarget(templateAddonIds, 'template-addon-1'),
    ).not.toThrow();
    expect(() =>
      requireTemplateAddonMappingTarget(
        templateAddonIds,
        'template-addon-missing',
      ),
    ).toThrow(
      'Template add-on mapping references missing add-on template-addon-missing',
    );
  });

  it('keeps the simple event snapshot to one option of each kind', () => {
    expect(
      simpleEventOptionShapeIsValid([
        { organizingRegistration: true },
        { organizingRegistration: false },
      ]),
    ).toBe(true);
    expect(
      simpleEventOptionShapeIsValid([
        { organizingRegistration: false },
        { organizingRegistration: false },
      ]),
    ).toBe(false);
    expect(
      simpleEventOptionShapeIsValid([
        { organizingRegistration: true },
        { organizingRegistration: false },
        { organizingRegistration: false },
      ]),
    ).toBe(false);
  });

  for (const pair of [
    {
      isPaid: true,
      price: 0,
      reason: 'paidEventRegistrationOptionRequiresPositivePrice',
    },
    {
      isPaid: false,
      price: 100,
      reason: 'freeEventRegistrationOptionRequiresZeroPrice',
    },
  ]) {
    for (const operation of ['create', 'sharedCreate'] as const) {
      it.effect(
        `${operation} returns a contract-valid pricing error before database access for isPaid=${pair.isPaid}, price=${pair.price}`,
        () =>
          Effect.gen(function* () {
            const option = {
              ...createInput.registrationOptions[0],
              isPaid: pair.isPaid,
              price: pair.price,
              stripeTaxRateId: pair.isPaid ? 'txr_valid' : null,
            };
            const options = {
              client: new Rpc.ServerClient(1),
              headers: Headers.empty,
              requestId: RpcMessage.RequestId(1),
              rpc: EventsCreate.middleware(RpcRequestContextMiddleware),
            };
            const input = Schema.decodeUnknownSync(EventsCreate.payloadSchema)({
              ...createInput,
              registrationOptions: [option],
            });
            const effect =
              operation === 'sharedCreate'
                ? createEventGraph(input)
                : eventLifecycleHandlers['events.create'](input, options);
            const error = yield* effect.pipe(
              Effect.flip,
              Effect.provide(
                Layer.mergeAll(
                  RpcAccess.Default,
                  Layer.succeed(RpcRequestContext, {
                    ...requestContext,
                    tenant: { ...tenant, stripeAccountId: 'acct_connected' },
                  }),
                  createDatabaseTestLayer(),
                ),
              ),
            );
            expect(error).toMatchObject({
              _tag: 'RpcBadRequestError',
              reason: pair.reason,
            });
            expect(Schema.is(EventsCreateRpcError)(error)).toBe(true);
          }),
      );
    }
  }

  it.effect('events.create rejects an event end before its start', () =>
    Effect.gen(function* () {
      const error = yield* eventLifecycleHandlers['events.create'](
        {
          ...createInput,
          end: '2026-09-20T09:00:00.000Z',
        },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(
          Layer.mergeAll(requestContextLayer, createDatabaseTestLayer()),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error).toMatchObject({ reason: 'invalidDates' });
    }),
  );

  it.effect(
    'events.create rejects a registration window that closes before it opens',
    () =>
      Effect.gen(function* () {
        const error = yield* eventLifecycleHandlers['events.create'](
          {
            ...createInput,
            registrationOptions: [
              {
                ...createInput.registrationOptions[0],
                closeRegistrationTime: '2026-09-01T12:00:00.000Z',
                openRegistrationTime: '2026-09-19T12:00:00.000Z',
              },
            ],
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(requestContextLayer, createDatabaseTestLayer()),
          ),
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error).toMatchObject({
          reason: 'invalidRegistrationOptionTimes',
        });
      }),
  );

  it.effect(
    'events.create rejects paid registration options when Stripe is not connected',
    () =>
      Effect.gen(function* () {
        const database = withTransaction({ stripeAccountId: null });
        const layer = Layer.mergeAll(
          requestContextLayer,
          Layer.succeed(Database, database as never),
        );

        const error = yield* eventLifecycleHandlers['events.create'](
          {
            ...createInput,
            registrationOptions: [
              {
                ...createInput.registrationOptions[0],
                isPaid: true,
                price: 1000,
              },
            ],
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(layer));

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'paymentSetupRequired',
        });
      }),
  );

  it.effect(
    'events.updateGraph rejects an event end before its start before loading the event',
    () =>
      Effect.gen(function* () {
        const fixture = createGraphUpdateDatabase();
        const error = yield* eventLifecycleHandlers['events.updateGraph'](
          { ...graphUpdateInput, end: '2026-09-20T09:00:00.000Z' },
          graphUpdateRpcOptions(),
        ).pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(requestContextLayer, fixture.databaseLayer),
          ),
        );

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'invalidDates',
        });
        expect(fixture.sqlCalls).not.toHaveBeenCalled();
        expect(fixture.transactionCommands).toEqual([]);
      }),
  );

  it.effect(
    'events.updateGraph rolls back a registration window that closes before it opens',
    () =>
      Effect.gen(function* () {
        const fixture = createGraphUpdateDatabase();
        const error = yield* eventLifecycleHandlers['events.updateGraph'](
          {
            ...graphUpdateInput,
            registrationOptions: graphUpdateInput.registrationOptions.map(
              (option) => ({
                ...option,
                closeRegistrationTime: '2026-09-01T12:00:00.000Z',
                openRegistrationTime: '2026-09-19T12:00:00.000Z',
              }),
            ),
          },
          graphUpdateRpcOptions(),
        ).pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(requestContextLayer, fixture.databaseLayer),
          ),
        );

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'invalidEventRegistrationOption',
        });
        expect(fixture.eventWrites).toHaveBeenCalledOnce();
        expect(fixture.optionWrites).not.toHaveBeenCalled();
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );

  it.effect(
    'events.updateGraph preserves the persisted simple event option shape by rolling back an invalid graph',
    () =>
      Effect.gen(function* () {
        const fixture = createGraphUpdateDatabase({ simpleModeEnabled: true });
        const error = yield* eventLifecycleHandlers['events.updateGraph'](
          {
            ...graphUpdateInput,
            registrationOptions: graphUpdateInput.registrationOptions.map(
              (option) => ({
                ...option,
                organizingRegistration: true,
              }),
            ),
            simpleModeEnabled: true,
          },
          graphUpdateRpcOptions(),
        ).pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(requestContextLayer, fixture.databaseLayer),
          ),
        );

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'simpleEventGraphRequiresTwoOptions',
        });
        expect(fixture.eventWrites).toHaveBeenCalledOnce();
        expect(fixture.optionWrites).not.toHaveBeenCalled();
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );

  it.effect(
    'events.updateGraph rejects a tax rate that belongs to the account replaced before the write lock',
    () =>
      Effect.gen(function* () {
        const fixture = createGraphUpdateDatabase();
        const error = yield* eventLifecycleHandlers['events.updateGraph'](
          {
            ...graphUpdateInput,
            registrationOptions: graphUpdateInput.registrationOptions.map(
              (option) => ({
                ...option,
                isPaid: true,
                price: 1000,
                stripeTaxRateId: 'txr_original',
              }),
            ),
          },
          graphUpdateRpcOptions(),
        ).pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(
              RpcAccess.Default,
              Layer.succeed(RpcRequestContext, {
                ...requestContext,
                tenant: { ...tenant, stripeAccountId: 'acct_original' },
              }),
              fixture.databaseLayer,
            ),
          ),
        );

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'invalidEventRegistrationOptionTaxRate',
        });
        expect(fixture.operationOrder).toEqual([
          'BEGIN',
          'lock-account',
          'lock-event',
          'write-event',
          'lock-role-graph',
          'locked-tenant',
          'locked-tax-rate',
          'ROLLBACK',
        ]);
        expect(fixture.eventWrites).toHaveBeenCalledOnce();
        expect(fixture.optionWrites).not.toHaveBeenCalled();
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );

  it.effect(
    'events.updateGraph derives the tenant boundary from context and rejects a non-owner',
    () =>
      Effect.gen(function* () {
        const findFirst = vi.fn(() =>
          Effect.succeed({ creatorId: 'user-2', status: 'DRAFT' as const }),
        );
        const layer = Layer.mergeAll(
          requestContextLayer,
          Layer.succeed(Database, {
            query: {
              eventInstances: { findFirst },
            },
          } as never),
        );

        const error = yield* eventLifecycleHandlers['events.updateGraph'](
          {
            addOns: [],
            description: updateInput.description,
            end: updateInput.end,
            eventId: updateInput.eventId,
            icon: updateInput.icon,
            location: null,
            questions: [],
            registrationOptions: updateInput.registrationOptions.map(
              (option) => ({
                ...option,
                esnCardDiscountedPrice: null,
                key: option.id,
              }),
            ),
            simpleModeEnabled: true,
            start: updateInput.start,
            title: updateInput.title,
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(layer));

        expect(error['_tag']).toBe('RpcForbiddenError');
        expect(findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'event-1', tenantId: 'tenant-1' },
          }),
        );
      }),
  );

  it.effect(
    'events.create saves edited and zero discounts by event option and preserves explicit removal despite template defaults',
    () =>
      Effect.gen(function* () {
        for (const submittedDiscountedPrice of [300, 0]) {
          const insertedEventValues = vi.fn(
            (values: typeof eventInstances.$inferInsert) => {
              expect(values).not.toHaveProperty('unlisted');
              return {
                returning: vi.fn(() =>
                  Effect.succeed([
                    {
                      id: 'event-1',
                    },
                  ]),
                ),
              };
            },
          );
          const insertedDiscountValues = vi.fn(() => Effect.succeed(undefined));
          const insertedRegistrationOptionValues = vi.fn(
            (
              values: readonly (typeof eventRegistrationOptions.$inferInsert & {
                id: string;
              })[],
            ) => Effect.succeed(values.length),
          );
          const database = {
            insert: vi.fn((table) => {
              if (table === eventInstances) {
                return {
                  values: insertedEventValues,
                };
              }

              if (table === eventRegistrationOptions) {
                return {
                  values: insertedRegistrationOptionValues,
                };
              }

              if (table === eventRegistrationOptionDiscounts) {
                return {
                  values: insertedDiscountValues,
                };
              }

              throw new Error('Unexpected insert table');
            }),
            query: {
              addonToTemplateRegistrationOptions: {
                findMany: vi.fn(() => Effect.succeed([])),
              },
              templateEventAddons: {
                findMany: vi.fn(() => Effect.succeed([])),
              },
              templateRegistrationOptions: {
                findMany: vi.fn(() =>
                  Effect.succeed([
                    {
                      id: 'template-option-1',
                    },
                    {
                      id: 'template-option-2',
                    },
                  ]),
                ),
              },
              templateRegistrationQuestions: {
                findMany: vi.fn(() => Effect.succeed([])),
              },
              tenantStripeTaxRates: {
                findFirst: vi.fn(() =>
                  Effect.succeed({
                    active: true,
                    inclusive: true,
                  }),
                ),
              },
            },
            select: vi.fn(() => ({
              from: vi.fn(() => ({
                where: vi.fn(() =>
                  Effect.succeed([
                    {
                      discountedPrice: 2000,
                      discountType: 'esnCard' as const,
                      registrationOptionId: 'template-option-1',
                    },
                    {
                      discountedPrice: 500,
                      discountType: 'esnCard' as const,
                      registrationOptionId: 'template-option-2',
                    },
                  ]),
                ),
              })),
            })),
            templateSimpleModeEnabled: true,
          };
          const layer = Layer.mergeAll(
            esnEnabledRequestContextLayer,
            Layer.succeed(Database, withTransaction(database) as never),
          );

          const result = yield* eventLifecycleHandlers['events.create'](
            {
              ...createInput,
              registrationOptions: [
                {
                  ...createInput.registrationOptions[0],
                  cancellationDeadlineHoursBeforeStart: 96,
                  isPaid: true,
                  organizingRegistration: true,
                  price: 1000,
                  refundFeesOnCancellation: false,
                  sourceTemplateRegistrationOptionId: 'template-option-1',
                  stripeTaxRateId: 'txr_vat_19',
                  title: 'Duplicate',
                  transferDeadlineHoursBeforeStart: 12,
                },
                {
                  ...createInput.registrationOptions[0],
                  esnCardDiscountedPrice: submittedDiscountedPrice,
                  isPaid: true,
                  price: 1000,
                  sourceTemplateRegistrationOptionId: 'template-option-2',
                  stripeTaxRateId: 'txr_vat_19',
                  title: 'Duplicate',
                },
              ],
            },
            { headers: {} } as never,
          ).pipe(Effect.provide(layer));

          expect(result).toEqual({ id: 'event-1' });
          expect(insertedEventValues).toHaveBeenCalledWith(
            expect.objectContaining({ simpleModeEnabled: true }),
          );
          expect(eventInstances.announcementRoleIds.default).toEqual([]);
          expect(insertedRegistrationOptionValues).toHaveBeenCalledWith(
            expect.arrayContaining([
              expect.objectContaining({
                cancellationDeadlineHoursBeforeStart: 96,
                refundFeesOnCancellation: false,
                transferDeadlineHoursBeforeStart: 12,
              }),
            ]),
          );
          const insertedOptions =
            insertedRegistrationOptionValues.mock.calls[0]?.[0];
          const discountedOption = insertedOptions?.[1];
          if (!discountedOption)
            throw new Error('Expected the second event registration option');
          expect(database.select).not.toHaveBeenCalled();
          expect(insertedDiscountValues).toHaveBeenCalledWith([
            {
              discountedPrice: submittedDiscountedPrice,
              discountType: 'esnCard',
              eventId: 'event-1',
              registrationOptionId: discountedOption.id,
            },
          ]);
        }
      }),
  );

  it.effect(
    'events.create honors explicit discount removal and rejects submitted discounts when disabled or free',
    () =>
      Effect.gen(function* () {
        for (const scenario of [
          { esnCardDiscountedPrice: null, isPaid: true, reason: null },
          {
            esnCardDiscountedPrice: 500,
            isPaid: true,
            reason: 'esnDiscountUnavailable',
          },
          {
            esnCardDiscountedPrice: 0,
            isPaid: false,
            reason: 'esnDiscountRequiresPaidOption',
          },
        ]) {
          const insertedDiscountValues = vi.fn(() => Effect.succeed(undefined));
          const database = {
            insert: vi.fn((table) => {
              if (table === eventInstances) {
                return {
                  values: vi.fn(() => ({
                    returning: vi.fn(() =>
                      Effect.succeed([
                        {
                          id: 'event-1',
                        },
                      ]),
                    ),
                  })),
                };
              }

              if (table === eventRegistrationOptions) {
                return {
                  values: vi.fn(() => Effect.succeed(1)),
                };
              }

              if (table === eventRegistrationOptionDiscounts) {
                return {
                  values: insertedDiscountValues,
                };
              }

              throw new Error('Unexpected insert table');
            }),
            query: {
              addonToTemplateRegistrationOptions: {
                findMany: vi.fn(() => Effect.succeed([])),
              },
              templateEventAddons: {
                findMany: vi.fn(() => Effect.succeed([])),
              },
              templateRegistrationOptions: {
                findMany: vi.fn(() =>
                  Effect.succeed([
                    {
                      id: 'template-option-1',
                    },
                  ]),
                ),
              },
              templateRegistrationQuestions: {
                findMany: vi.fn(() => Effect.succeed([])),
              },
              tenantStripeTaxRates: {
                findFirst: vi.fn(() =>
                  Effect.succeed({
                    active: true,
                    inclusive: true,
                  }),
                ),
              },
            },
            select: vi.fn(() => ({
              from: vi.fn(() => ({
                where: vi.fn(() =>
                  Effect.succeed([
                    {
                      discountedPrice: 500,
                      discountType: 'esnCard' as const,
                      registrationOptionId: 'template-option-1',
                    },
                  ]),
                ),
              })),
            })),
          };
          const layer = Layer.mergeAll(
            requestContextLayer,
            Layer.succeed(Database, withTransaction(database) as never),
          );

          const creation = eventLifecycleHandlers['events.create'](
            {
              ...createInput,
              registrationOptions: [
                {
                  ...createInput.registrationOptions[0],
                  esnCardDiscountedPrice: scenario.esnCardDiscountedPrice,
                  isPaid: scenario.isPaid,
                  price: scenario.isPaid ? 1000 : 0,
                  sourceTemplateRegistrationOptionId: 'template-option-1',
                  stripeTaxRateId: scenario.isPaid ? 'txr_vat_19' : null,
                },
              ],
            },
            { headers: {} } as never,
          );

          if (scenario.reason === null) {
            const result = yield* creation.pipe(Effect.provide(layer));
            expect(result).toEqual({ id: 'event-1' });
            expect(insertedDiscountValues).not.toHaveBeenCalled();
          } else {
            const error = yield* creation.pipe(
              Effect.flip,
              Effect.provide(layer),
            );
            expect(error).toMatchObject({
              _tag: 'RpcBadRequestError',
              reason: scenario.reason,
            });
            expect(database.insert).not.toHaveBeenCalled();
          }
          expect(database.select).not.toHaveBeenCalled();
        }
      }),
  );

  it.effect(
    'events.create rejects submitted discounts that exceed the event option price',
    () =>
      Effect.gen(function* () {
        const insert = vi.fn();
        const database = {
          insert,
          query: {
            addonToTemplateRegistrationOptions: {
              findMany: vi.fn(() => Effect.succeed([])),
            },
            templateEventAddons: {
              findMany: vi.fn(() => Effect.succeed([])),
            },
            templateRegistrationOptions: {
              findMany: vi.fn(() =>
                Effect.succeed([
                  {
                    id: 'template-option-1',
                  },
                ]),
              ),
            },
            templateRegistrationQuestions: {
              findMany: vi.fn(() => Effect.succeed([])),
            },
            tenantStripeTaxRates: {
              findFirst: vi.fn(() =>
                Effect.succeed({
                  active: true,
                  inclusive: true,
                }),
              ),
            },
          },
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() =>
                Effect.succeed([
                  {
                    discountedPrice: 1500,
                    discountType: 'esnCard' as const,
                    registrationOptionId: 'template-option-1',
                  },
                ]),
              ),
            })),
          })),
        };
        const layer = Layer.mergeAll(
          esnEnabledRequestContextLayer,
          Layer.succeed(Database, withTransaction(database) as never),
        );

        const error = yield* eventLifecycleHandlers['events.create'](
          {
            ...createInput,
            registrationOptions: [
              {
                ...createInput.registrationOptions[0],
                esnCardDiscountedPrice: 1500,
                isPaid: true,
                price: 1000,
                sourceTemplateRegistrationOptionId: 'template-option-1',
                stripeTaxRateId: 'txr_vat_19',
              },
            ],
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(layer));

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error).toMatchObject({ reason: 'esnDiscountExceedsPrice' });
        expect(insert).not.toHaveBeenCalled();
      }),
  );

  it('builds event add-on inserts from copied template add-ons', () => {
    expect(
      buildEventAddonInsert({
        addOn: {
          allowMultiple: true,
          allowPurchaseBeforeEvent: true,
          allowPurchaseDuringEvent: false,
          allowPurchaseDuringRegistration: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          description: 'Includes equipment rental.',
          id: 'template-addon-1',
          isPaid: true,
          maxQuantityPerUser: 2,
          price: 1500,
          registrationOptions: [
            {
              includedQuantity: 1,
              optionalPurchaseQuantity: 0,
              registrationOptionId: 'template-option-1',
            },
          ],
          stripeTaxRateId: 'txr_vat_19',
          templateId: 'template-1',
          title: 'Equipment rental',
          totalAvailableQuantity: 20,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        eventId: 'event-1',
      }),
    ).toEqual({
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      description: 'Includes equipment rental.',
      eventId: 'event-1',
      isPaid: true,
      maxQuantityPerUser: 2,
      price: 1500,
      stripeTaxRateId: 'txr_vat_19',
      title: 'Equipment rental',
      totalAvailableQuantity: 20,
    });
  });

  it('builds event registration-question inserts from copied template questions', () => {
    expect(
      buildEventQuestionInsert({
        eventId: 'event-1',
        question: {
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          description: 'Tell us about your experience.',
          id: 'template-question-1',
          registrationOptionId: 'template-option-1',
          required: true,
          sortOrder: 2,
          templateId: 'template-1',
          title: 'Experience',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        registrationOptionId: 'event-option-1',
      }),
    ).toEqual({
      description: 'Tell us about your experience.',
      eventId: 'event-1',
      registrationOptionId: 'event-option-1',
      required: true,
      sortOrder: 2,
      sourceTemplateQuestionId: 'template-question-1',
      title: 'Experience',
    });
  });

  for (const scenario of [
    {
      addOnCount: MAX_EVENT_ADDON_TYPES,
      questionCount: MAX_REGISTRATION_QUESTIONS,
      reason: null,
    },
    {
      addOnCount: MAX_EVENT_ADDON_TYPES + 1,
      questionCount: MAX_REGISTRATION_QUESTIONS,
      reason: 'eventAddonTypeLimitExceeded',
    },
    {
      addOnCount: MAX_EVENT_ADDON_TYPES,
      questionCount: MAX_REGISTRATION_QUESTIONS + 1,
      reason: 'eventQuestionLimitExceeded',
    },
  ]) {
    it.effect(
      `events.create bounds the persisted template before writes (${scenario.addOnCount} add-ons, ${scenario.questionCount} questions)`,
      () =>
        Effect.gen(function* () {
          const writes: string[] = [];
          const commands: string[] = [];
          const databaseLayer = createRegistrationDatabaseTestLayer({
            executeValues: (statement, parameters) =>
              Effect.sync(() => {
                if (statement.startsWith('insert ')) {
                  writes.push(statement);
                  if (statement.startsWith('insert into "event_instances"'))
                    return [['event-1']];
                  if (
                    statement.startsWith(
                      'insert into "event_registration_options"',
                    )
                  )
                    return [['event-option-1']];
                  if (statement.startsWith('insert into "event_addons"'))
                    return [[`event-addon-${writes.length}`]];
                  if (
                    statement.startsWith(
                      'insert into "event_registration_questions"',
                    )
                  ) {
                    expect(
                      parameters.filter(
                        (value) =>
                          typeof value === 'string' &&
                          value.startsWith('question-'),
                      ),
                    ).toHaveLength(scenario.questionCount);
                    return [];
                  }
                }
                if (statement.includes('pg_advisory_xact_lock')) return [];
                if (statement.includes('from "tenants"')) {
                  expect(parameters).toEqual([tenant.id]);
                  return [[null]];
                }
                if (statement.includes('from "roles"')) return [['role-1']];
                if (statement.includes('from "event_templates"')) {
                  expect(statement).toContain('for share');
                  expect(parameters).toEqual(['template-1', tenant.id, 1]);
                  return [[false, false]];
                }
                if (statement.includes('from "template_registration_options"'))
                  return [['template-option-1', 'fcfs']];
                if (
                  statement.includes(
                    'from "template_registration_option_discounts"',
                  )
                )
                  return [];
                if (statement.includes('from "template_event_addons"')) {
                  expect(parameters).toEqual(['template-1']);
                  return Array.from(
                    { length: scenario.addOnCount },
                    (_, index) => [
                      false,
                      true,
                      false,
                      true,
                      '2026-01-01',
                      null,
                      `template-addon-${index}`,
                      false,
                      1,
                      0,
                      null,
                      'template-1',
                      'Free add-on',
                      20,
                      '2026-01-01',
                    ],
                  );
                }
                if (
                  statement.includes('from "template_registration_questions"')
                ) {
                  expect(parameters).toEqual([
                    'template-option-1',
                    'template-1',
                  ]);
                  return Array.from(
                    { length: scenario.questionCount },
                    (_, index) => [
                      '2026-01-01',
                      null,
                      `question-${index}`,
                      'template-option-1',
                      true,
                      index,
                      'template-1',
                      'Question',
                      '2026-01-01',
                    ],
                  );
                }
                if (
                  statement.includes(
                    'from "addon_to_template_registration_options"',
                  )
                )
                  return [];
                throw new Error(
                  `Unexpected template-copy fixture statement: ${statement}`,
                );
              }),
            transactionControl: (command) =>
              Effect.sync(() => {
                commands.push(command);
              }),
          });
          const result = yield* eventLifecycleHandlers['events.create'](
            Schema.decodeUnknownSync(EventsCreate.payloadSchema)({
              ...createInput,
              registrationOptions: [
                {
                  ...createInput.registrationOptions[0],
                  sourceTemplateRegistrationOptionId: 'template-option-1',
                },
              ],
            }),
            {
              client: new Rpc.ServerClient(1),
              headers: Headers.empty,
              requestId: RpcMessage.RequestId(1),
              rpc: EventsCreate.middleware(RpcRequestContextMiddleware),
            },
          ).pipe(
            Effect.result,
            Effect.provide(Layer.mergeAll(requestContextLayer, databaseLayer)),
          );
          if (scenario.reason === null) {
            expect(result).toMatchObject({
              _tag: 'Success',
              success: { id: 'event-1' },
            });
            expect(
              writes.filter((statement) =>
                statement.startsWith('insert into "event_addons"'),
              ),
            ).toHaveLength(MAX_EVENT_ADDON_TYPES);
            expect(
              writes.filter((statement) =>
                statement.startsWith(
                  'insert into "event_registration_questions"',
                ),
              ),
            ).toHaveLength(1);
            expect(commands).toEqual(['BEGIN', 'COMMIT']);
          } else {
            expect(result._tag).toBe('Failure');
            if (result._tag !== 'Failure')
              throw new Error('Expected a template limit failure');
            expect(result.failure).toMatchObject({
              _tag: 'RpcBadRequestError',
              reason: scenario.reason,
            });
            expect(Schema.is(EventsCreateRpcError)(result.failure)).toBe(true);
            expect(writes).toEqual([]);
            expect(commands).toEqual(['BEGIN', 'ROLLBACK']);
          }
        }),
    );
  }

  it.effect(
    'events.create copies template add-ons to matching event registration options',
    () =>
      Effect.gen(function* () {
        const insertedEventAddonValues = vi.fn(() => ({
          returning: vi.fn(() => Effect.succeed([{ id: 'event-addon-1' }])),
        }));
        const insertedEventAddonOptionValues = vi.fn(() =>
          Effect.succeed(undefined),
        );
        const insertedRegistrationOptionValues = vi.fn(
          (
            values: readonly (typeof eventRegistrationOptions.$inferInsert & {
              id: string;
            })[],
          ) => Effect.succeed(values.length),
        );
        const database = {
          insert: vi.fn((table) => {
            if (table === eventInstances) {
              return {
                values: vi.fn(() => ({
                  returning: vi.fn(() =>
                    Effect.succeed([
                      {
                        id: 'event-1',
                      },
                    ]),
                  ),
                })),
              };
            }

            if (table === eventRegistrationOptions) {
              return {
                values: insertedRegistrationOptionValues,
              };
            }

            if (table === eventAddons) {
              return {
                values: insertedEventAddonValues,
              };
            }

            if (table === addonToEventRegistrationOptions) {
              return {
                values: insertedEventAddonOptionValues,
              };
            }

            throw new Error('Unexpected insert table');
          }),
          query: {
            addonToTemplateRegistrationOptions: {
              findMany: vi.fn(() =>
                Effect.succeed([
                  {
                    addonId: 'template-addon-1',
                    includedQuantity: 1,
                    optionalPurchaseQuantity: 1,
                    registrationOptionId: 'template-option-1',
                    templateId: 'template-1',
                  },
                ]),
              ),
            },
            templateEventAddons: {
              findMany: vi.fn(() =>
                Effect.succeed([
                  {
                    allowMultiple: true,
                    allowPurchaseBeforeEvent: true,
                    allowPurchaseDuringEvent: false,
                    allowPurchaseDuringRegistration: true,
                    createdAt: new Date('2026-01-01T00:00:00.000Z'),
                    description: 'Includes equipment rental.',
                    id: 'template-addon-1',
                    isPaid: true,
                    maxQuantityPerUser: 2,
                    price: 1500,
                    stripeTaxRateId: 'txr_vat_19',
                    templateId: 'template-1',
                    title: 'Equipment rental',
                    totalAvailableQuantity: 20,
                    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
                  },
                ]),
              ),
            },
            templateRegistrationOptions: {
              findMany: vi.fn(() =>
                Effect.succeed([
                  {
                    id: 'template-option-1',
                  },
                ]),
              ),
            },
            templateRegistrationQuestions: {
              findMany: vi.fn(() => Effect.succeed([])),
            },
            tenantStripeTaxRates: {
              findFirst: vi.fn(() =>
                Effect.succeed({
                  active: true,
                  inclusive: true,
                }),
              ),
            },
          },
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => Effect.succeed([])),
            })),
          })),
        };
        const layer = Layer.mergeAll(
          requestContextLayer,
          Layer.succeed(Database, withTransaction(database) as never),
        );

        const result = yield* eventLifecycleHandlers['events.create'](
          {
            ...createInput,
            registrationOptions: [
              {
                ...createInput.registrationOptions[0],
                isPaid: true,
                price: 1000,
                sourceTemplateRegistrationOptionId: 'template-option-1',
                stripeTaxRateId: 'txr_vat_19',
              },
            ],
          },
          { headers: {} } as never,
        ).pipe(Effect.provide(layer));

        expect(result).toEqual({ id: 'event-1' });
        expect(insertedEventAddonValues).toHaveBeenCalledWith({
          allowMultiple: true,
          allowPurchaseBeforeEvent: true,
          allowPurchaseDuringEvent: false,
          allowPurchaseDuringRegistration: true,
          description: 'Includes equipment rental.',
          eventId: 'event-1',
          isPaid: true,
          maxQuantityPerUser: 2,
          price: 1500,
          stripeTaxRateId: 'txr_vat_19',
          title: 'Equipment rental',
          totalAvailableQuantity: 20,
        });
        const insertedOption =
          insertedRegistrationOptionValues.mock.calls[0]?.[0]?.[0];
        if (!insertedOption)
          throw new Error('Expected the copied event registration option');
        expect(insertedEventAddonOptionValues).toHaveBeenCalledWith([
          {
            addonId: 'event-addon-1',
            eventId: 'event-1',
            includedQuantity: 1,
            optionalPurchaseQuantity: 1,
            registrationOptionId: insertedOption.id,
          },
        ]);
      }),
  );

  it.effect(
    'events.create snapshots an unmapped add-on from an advanced template with no options',
    () =>
      Effect.gen(function* () {
        const findTemplateAddonMappings = vi.fn(() => Effect.succeed([]));
        const findTemplateAddons = vi.fn(() =>
          Effect.succeed([
            {
              allowMultiple: false,
              allowPurchaseBeforeEvent: true,
              allowPurchaseDuringEvent: false,
              allowPurchaseDuringRegistration: false,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              description: 'Available after the event is created.',
              id: 'template-addon-unmapped',
              isPaid: false,
              maxQuantityPerUser: 1,
              price: 0,
              stripeTaxRateId: null,
              templateId: 'template-1',
              title: 'Unmapped equipment',
              totalAvailableQuantity: 12,
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
          ]),
        );
        const insertedEventAddonValues = vi.fn(() => ({
          returning: vi.fn(() =>
            Effect.succeed([{ id: 'event-addon-unmapped' }]),
          ),
        }));
        const insertedEventAddonOptionValues = vi.fn(() =>
          Effect.succeed(undefined),
        );
        const insertedRegistrationOptionValues = vi.fn(() => ({
          returning: vi.fn(() => Effect.succeed([])),
        }));
        const database = {
          insert: vi.fn((table) => {
            if (table === eventInstances) {
              return {
                values: vi.fn(() => ({
                  returning: vi.fn(() =>
                    Effect.succeed([
                      {
                        id: 'event-1',
                      },
                    ]),
                  ),
                })),
              };
            }

            if (table === eventRegistrationOptions) {
              return {
                values: insertedRegistrationOptionValues,
              };
            }

            if (table === eventAddons) {
              return {
                values: insertedEventAddonValues,
              };
            }

            if (table === addonToEventRegistrationOptions) {
              return {
                values: insertedEventAddonOptionValues,
              };
            }

            throw new Error('Unexpected insert table');
          }),
          query: {
            addonToTemplateRegistrationOptions: {
              findMany: findTemplateAddonMappings,
            },
            templateEventAddons: {
              findMany: findTemplateAddons,
            },
            templateRegistrationOptions: {
              findMany: vi.fn(() => Effect.succeed([])),
            },
            templateRegistrationQuestions: {
              findMany: vi.fn(() => Effect.succeed([])),
            },
          },
        };
        const layer = Layer.mergeAll(
          requestContextLayer,
          Layer.succeed(Database, withTransaction(database) as never),
        );

        const result = yield* eventLifecycleHandlers['events.create'](
          {
            ...createInput,
            registrationOptions: [],
          },
          { headers: {} } as never,
        ).pipe(Effect.provide(layer));

        expect(result).toEqual({ id: 'event-1' });
        expect(findTemplateAddons).toHaveBeenCalledWith({
          where: { templateId: 'template-1' },
        });
        expect(findTemplateAddonMappings).not.toHaveBeenCalled();
        expect(insertedRegistrationOptionValues).not.toHaveBeenCalled();
        expect(insertedEventAddonValues).toHaveBeenCalledWith({
          allowMultiple: false,
          allowPurchaseBeforeEvent: true,
          allowPurchaseDuringEvent: false,
          allowPurchaseDuringRegistration: false,
          description: 'Available after the event is created.',
          eventId: 'event-1',
          isPaid: false,
          maxQuantityPerUser: 1,
          price: 0,
          stripeTaxRateId: null,
          title: 'Unmapped equipment',
          totalAvailableQuantity: 12,
        });
        expect(insertedEventAddonOptionValues).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'events.create copies template questions to matching event registration options',
    () =>
      Effect.gen(function* () {
        const insertedEventQuestionValues = vi.fn(() =>
          Effect.succeed(undefined),
        );
        const insertedRegistrationOptionValues = vi.fn(
          (
            values: readonly (typeof eventRegistrationOptions.$inferInsert & {
              id: string;
            })[],
          ) => Effect.succeed(values.length),
        );
        const database = {
          insert: vi.fn((table) => {
            if (table === eventInstances) {
              return {
                values: vi.fn(() => ({
                  returning: vi.fn(() =>
                    Effect.succeed([
                      {
                        id: 'event-1',
                      },
                    ]),
                  ),
                })),
              };
            }

            if (table === eventRegistrationOptions) {
              return {
                values: insertedRegistrationOptionValues,
              };
            }

            if (table === eventRegistrationQuestions) {
              return {
                values: insertedEventQuestionValues,
              };
            }

            throw new Error('Unexpected insert table');
          }),
          query: {
            addonToTemplateRegistrationOptions: {
              findMany: vi.fn(() => Effect.succeed([])),
            },
            templateEventAddons: {
              findMany: vi.fn(() => Effect.succeed([])),
            },
            templateRegistrationOptions: {
              findMany: vi.fn(() =>
                Effect.succeed([
                  {
                    id: 'template-option-1',
                  },
                ]),
              ),
            },
            templateRegistrationQuestions: {
              findMany: vi.fn(() =>
                Effect.succeed([
                  {
                    createdAt: new Date('2026-01-01T00:00:00.000Z'),
                    description: 'Tell us about your experience.',
                    id: 'template-question-1',
                    registrationOptionId: 'template-option-1',
                    required: true,
                    sortOrder: 0,
                    templateId: 'template-1',
                    title: 'Experience',
                    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
                  },
                ]),
              ),
            },
            tenantStripeTaxRates: {
              findFirst: vi.fn(() =>
                Effect.succeed({
                  active: true,
                  inclusive: true,
                }),
              ),
            },
          },
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => Effect.succeed([])),
            })),
          })),
        };
        const layer = Layer.mergeAll(
          requestContextLayer,
          Layer.succeed(Database, withTransaction(database) as never),
        );

        const result = yield* eventLifecycleHandlers['events.create'](
          {
            ...createInput,
            registrationOptions: [
              {
                ...createInput.registrationOptions[0],
                sourceTemplateRegistrationOptionId: 'template-option-1',
              },
            ],
          },
          { headers: {} } as never,
        ).pipe(Effect.provide(layer));

        expect(result).toEqual({ id: 'event-1' });
        const insertedOption =
          insertedRegistrationOptionValues.mock.calls[0]?.[0]?.[0];
        if (!insertedOption)
          throw new Error('Expected the copied event registration option');
        expect(insertedEventQuestionValues).toHaveBeenCalledWith([
          {
            description: 'Tell us about your experience.',
            eventId: 'event-1',
            registrationOptionId: insertedOption.id,
            required: true,
            sortOrder: 0,
            sourceTemplateQuestionId: 'template-question-1',
            title: 'Experience',
          },
        ]);
      }),
  );
});

const announcementDiscoveryRequestContextLayer = Layer.mergeAll(
  RpcAccess.Default,
  Layer.succeed(RpcRequestContext, {
    ...requestContext,
    permissions: ['events:changeAnnouncementDiscovery'],
    user: {
      ...user,
      permissions: ['events:changeAnnouncementDiscovery'],
    },
  }),
);

const announcementDiscoveryRpcOptions = () => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: EventsUpdateAnnouncementDiscovery.middleware(
    RpcRequestContextMiddleware,
  ),
});

const createAnnouncementDiscoveryDatabase = ({
  eventExists = true,
  registrationOptionExists = false,
  roleIds = [],
}: {
  eventExists?: boolean;
  registrationOptionExists?: boolean;
  roleIds?: readonly string[];
} = {}) => {
  const lockOrder: string[] = [];
  const writes =
    vi.fn<(statement: string, parameters: readonly unknown[]) => void>();
  const transactionCommands: string[] = [];
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        if (
          statement.startsWith('select ') &&
          statement.includes('from "event_instances"')
        ) {
          expect(statement).toContain('"event_instances"."tenantId" = $1');
          expect(statement).toContain('"event_instances"."id" = $2');
          expect(statement.endsWith(' for update')).toBe(true);
          expect(parameters).toEqual([
            'tenant-1',
            eventExists ? 'event-1' : 'missing-event',
          ]);
          lockOrder.push('event');
          return eventExists ? [['event-1']] : [];
        }
        if (statement.startsWith('select pg_advisory_xact_lock(')) {
          expect(parameters).toEqual(['evorto:tenant-role-graph:tenant-1']);
          lockOrder.push('role-graph');
          return [];
        }
        if (statement.includes('from "roles"')) {
          expect(statement).toContain('"roles"."tenantId" = $1');
          expect(statement).toContain('"roles"."id" in (');
          expect(parameters[0]).toBe('tenant-1');
          lockOrder.push('roles');
          return roleIds
            .filter((id) => parameters.slice(1).includes(id))
            .map((id) => [id]);
        }
        if (statement.includes('from "event_registration_options"')) {
          expect(statement).toContain(
            '"event_registration_options"."eventId" = $1',
          );
          expect(parameters).toEqual(['event-1', 1]);
          lockOrder.push('choices');
          return registrationOptionExists ? [['option-1']] : [];
        }
        if (statement.startsWith('update "event_instances" set ')) {
          expect(statement).toContain('"announcementRoleIds" = $');
          expect(statement).toContain('"event_instances"."tenantId" = $');
          expect(statement).toContain('"event_instances"."id" = $');
          expect(parameters.slice(-2)).toEqual(['tenant-1', 'event-1']);
          lockOrder.push('write');
          writes(statement, parameters);
          return [['event-1']];
        }
        throw new Error(`Unexpected announcement discovery SQL: ${statement}`);
      }),
    transactionControl: (command) =>
      Effect.sync(() => {
        transactionCommands.push(command);
      }),
  });
  return { databaseLayer, lockOrder, transactionCommands, writes };
};

describe('announcement discovery lifecycle', () => {
  it.effect('reports a missing event before changing who can find it', () =>
    Effect.gen(function* () {
      const fixture = createAnnouncementDiscoveryDatabase({
        eventExists: false,
      });
      const error = yield* eventLifecycleHandlers[
        'events.updateAnnouncementDiscovery'
      ](
        { announcementRoleIds: [], eventId: 'missing-event' },
        announcementDiscoveryRpcOptions(),
      ).pipe(
        Effect.flip,
        Effect.provide(
          Layer.mergeAll(
            announcementDiscoveryRequestContextLayer,
            fixture.databaseLayer,
          ),
        ),
      );
      expect(error).toMatchObject({
        _tag: 'EventNotFoundError',
        id: 'missing-event',
      });
      expect(fixture.writes).not.toHaveBeenCalled();
      expect(fixture.lockOrder).toEqual(['event']);
      expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
    }),
  );

  it.effect(
    'rejects an unauthorized visibility change before database work',
    () =>
      Effect.gen(function* () {
        const error = yield* eventLifecycleHandlers[
          'events.updateAnnouncementDiscovery'
        ](
          { announcementRoleIds: [], eventId: 'event-1' },
          announcementDiscoveryRpcOptions(),
        ).pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(requestContextLayer, createDatabaseTestLayer()),
          ),
        );
        expect(error).toMatchObject({
          _tag: 'RpcForbiddenError',
          permission: 'events:changeAnnouncementDiscovery',
        });
      }),
  );

  it.effect(
    'canonicalizes selected roles after locking the information-only event',
    () =>
      Effect.gen(function* () {
        const fixture = createAnnouncementDiscoveryDatabase({
          roleIds: ['role-a', 'role-b'],
        });
        yield* eventLifecycleHandlers['events.updateAnnouncementDiscovery'](
          {
            announcementRoleIds: ['role-b', 'role-a', 'role-b'],
            eventId: 'event-1',
          },
          announcementDiscoveryRpcOptions(),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              announcementDiscoveryRequestContextLayer,
              fixture.databaseLayer,
            ),
          ),
        );
        expect(fixture.lockOrder).toEqual([
          'event',
          'role-graph',
          'roles',
          'choices',
          'write',
        ]);
        expect(fixture.writes).toHaveBeenCalledTimes(1);
        expect(fixture.writes.mock.calls[0]?.[1]).toContain(
          '{"role-a","role-b"}',
        );
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect(
    'rejects unavailable roles and every visibility change on sign-up events',
    () =>
      Effect.gen(function* () {
        const invalidRole = createAnnouncementDiscoveryDatabase({
          roleIds: [],
        });
        const invalidRoleError = yield* eventLifecycleHandlers[
          'events.updateAnnouncementDiscovery'
        ](
          { announcementRoleIds: ['foreign-role'], eventId: 'event-1' },
          announcementDiscoveryRpcOptions(),
        ).pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(
              announcementDiscoveryRequestContextLayer,
              invalidRole.databaseLayer,
            ),
          ),
        );
        expect(invalidRoleError).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'invalidAnnouncementRole',
        });
        expect(invalidRole.writes).not.toHaveBeenCalled();
        expect(invalidRole.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
        const optionful = createAnnouncementDiscoveryDatabase({
          registrationOptionExists: true,
        });
        const optionfulError = yield* eventLifecycleHandlers[
          'events.updateAnnouncementDiscovery'
        ](
          { announcementRoleIds: [], eventId: 'event-1' },
          announcementDiscoveryRpcOptions(),
        ).pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(
              announcementDiscoveryRequestContextLayer,
              optionful.databaseLayer,
            ),
          ),
        );
        expect(optionfulError).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'announcementRolesRequireOptionlessEvent',
        });
        expect(optionful.writes).not.toHaveBeenCalled();
        expect(optionful.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );
});
