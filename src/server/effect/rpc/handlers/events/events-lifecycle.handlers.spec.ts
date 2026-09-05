import { describe, expect, it } from '@effect/vitest';
import { createDatabaseTestLayer } from '@server/testing/database-test-layer';
import { createRegistrationDatabaseTestLayer } from '@server/testing/registration-database';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { MAX_EVENT_ADDON_TYPES } from '@shared/registration-quantity-limits';
import { MAX_REGISTRATION_QUESTIONS } from '@shared/registration-question-limits';
import {
  EventsCreateRpcError,
  EventsUpdateRpcError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  EventsCreate,
  EventsUpdate,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';
import { TransactionRollbackError } from 'drizzle-orm';
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
  roles,
} from '../../../../../db/schema';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
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
      if (
        selection['simpleModeEnabled'] !== undefined &&
        selection['unlisted'] !== undefined
      ) {
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
                      unlisted: false,
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
    for (const operation of ['create', 'sharedCreate', 'update'] as const) {
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
            const effect: Effect.Effect<
              { id: string },
              EventsCreateRpcError | EventsUpdateRpcError,
              Database | RpcAccess
            > =
              operation === 'update'
                ? eventLifecycleHandlers['events.update'](
                    Schema.decodeUnknownSync(EventsUpdate.payloadSchema)({
                      ...updateInput,
                      registrationOptions: [{ ...option, id: 'option-1' }],
                    }),
                    {
                      ...options,
                      rpc: EventsUpdate.middleware(RpcRequestContextMiddleware),
                    },
                  )
                : operation === 'sharedCreate'
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
            expect(
              Schema.is(
                operation === 'update'
                  ? EventsUpdateRpcError
                  : EventsCreateRpcError,
              )(error),
            ).toBe(true);
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
    'events.update rejects an event end before its start before loading the event',
    () =>
      Effect.gen(function* () {
        const error = yield* eventLifecycleHandlers['events.update'](
          {
            ...updateInput,
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
    'events.update rejects a registration window that closes before it opens before loading the event',
    () =>
      Effect.gen(function* () {
        const error = yield* eventLifecycleHandlers['events.update'](
          {
            ...updateInput,
            registrationOptions: [
              {
                ...updateInput.registrationOptions[0],
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
    'events.update preserves the persisted simple event option shape',
    () =>
      Effect.gen(function* () {
        const findFirst = vi.fn(() =>
          Effect.succeed({
            creatorId: user.id,
            simpleModeEnabled: true,
            status: 'DRAFT' as const,
          }),
        );
        const layer = Layer.mergeAll(
          requestContextLayer,
          Layer.succeed(Database, {
            query: { eventInstances: { findFirst } },
          } as never),
        );

        const error = yield* eventLifecycleHandlers['events.update'](
          {
            ...updateInput,
            registrationOptions: [
              {
                ...updateInput.registrationOptions[0],
                organizingRegistration: true,
              },
              {
                ...updateInput.registrationOptions[0],
                id: 'option-2',
                organizingRegistration: true,
              },
            ],
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(layer));

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'invalidSimpleEventConfiguration',
        });
      }),
  );

  it.effect(
    'events.update rejects a tax rate that belongs to the account replaced before the write lock',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const update = vi.fn(() =>
          Effect.die(
            new Error('Event write must not run after tax-rate drift'),
          ),
        );
        const transactionDatabase = {
          query: {
            tenants: {
              findFirst: vi.fn(() => {
                operationOrder.push('locked-tenant');
                return Effect.succeed({
                  stripeAccountId: 'acct_replacement',
                });
              }),
            },
            tenantStripeTaxRates: {
              findFirst: vi.fn(() => {
                operationOrder.push('locked-tax-rate');
                return Effect.succeed(undefined);
              }),
            },
          },
          rollback: vi.fn(() => {
            operationOrder.push('rollback');
            return Effect.die(new TransactionRollbackError());
          }),
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                for: vi.fn(() => {
                  operationOrder.push('lock-account');
                  return Effect.succeed([
                    { stripeAccountId: 'acct_replacement' },
                  ]);
                }),
              })),
            })),
          })),
          update,
        };
        const database = {
          $client: {},
          query: {
            eventInstances: {
              findFirst: vi.fn(() =>
                Effect.succeed({
                  creatorId: user.id,
                  simpleModeEnabled: false,
                  status: 'DRAFT' as const,
                }),
              ),
            },
            tenants: {
              findFirst: vi.fn(() =>
                Effect.succeed({ stripeAccountId: 'acct_original' }),
              ),
            },
            tenantStripeTaxRates: {
              findFirst: vi.fn(() => {
                operationOrder.push('preflight-tax-rate');
                return Effect.succeed({ active: true, inclusive: true });
              }),
            },
          },
          transaction: vi.fn(
            (
              run: (
                transaction: typeof transactionDatabase,
              ) => Effect.Effect<unknown>,
            ) => run(transactionDatabase),
          ),
        };
        const layer = Layer.mergeAll(
          requestContextLayer,
          Layer.succeed(Database, database as never),
        );

        const error = yield* eventLifecycleHandlers['events.update'](
          {
            ...updateInput,
            registrationOptions: [
              {
                ...updateInput.registrationOptions[0],
                isPaid: true,
                price: 1000,
                stripeTaxRateId: 'txr_original',
              },
            ],
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(layer));

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'invalidRegistrationOptionTaxRate',
        });
        expect(operationOrder).toEqual([
          'preflight-tax-rate',
          'lock-account',
          'locked-tenant',
          'locked-tax-rate',
          'rollback',
        ]);
        expect(update).not.toHaveBeenCalled();
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
          const insertedEventValues = vi.fn(() => ({
            returning: vi.fn(() =>
              Effect.succeed([
                {
                  id: 'event-1',
                },
              ]),
            ),
          }));
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
              eventTemplates: {
                findFirst: vi.fn(() =>
                  Effect.succeed({
                    unlisted: false,
                  }),
                ),
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
              eventTemplates: {
                findFirst: vi.fn(() =>
                  Effect.succeed({
                    unlisted: false,
                  }),
                ),
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
            eventTemplates: {
              findFirst: vi.fn(() =>
                Effect.succeed({
                  unlisted: false,
                }),
              ),
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

  it.effect(
    'events.create rejects a persisted random source option even when the payload changes it to fcfs',
    () =>
      Effect.gen(function* () {
        const insert = vi.fn();
        const findTemplateAddons = vi.fn(() => Effect.succeed([]));
        const database = {
          insert,
          query: {
            templateEventAddons: {
              findMany: findTemplateAddons,
            },
            templateRegistrationOptions: {
              findMany: vi.fn(() =>
                Effect.succeed([
                  {
                    id: 'template-option-1',
                    registrationMode: 'random' as const,
                  },
                ]),
              ),
            },
          },
        };
        const layer = Layer.mergeAll(
          requestContextLayer,
          Layer.succeed(Database, withTransaction(database) as never),
        );

        const error = yield* eventLifecycleHandlers['events.create'](
          {
            ...createInput,
            registrationOptions: [
              {
                ...createInput.registrationOptions[0],
                registrationMode: 'fcfs',
                sourceTemplateRegistrationOptionId: 'template-option-1',
              },
            ],
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(layer));

        expect(error).toBeInstanceOf(RpcBadRequestError);
        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          message:
            'Random allocation is unavailable. An authorized template editor must choose First come, first served or Manual approval before anyone can create an event from this template.',
          reason: 'unsupportedTemplateRegistrationMode',
        });
        expect(findTemplateAddons).not.toHaveBeenCalled();
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
            eventTemplates: {
              findFirst: vi.fn(() =>
                Effect.succeed({
                  unlisted: false,
                }),
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
            eventTemplates: {
              findFirst: vi.fn(() =>
                Effect.succeed({
                  unlisted: false,
                }),
              ),
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
