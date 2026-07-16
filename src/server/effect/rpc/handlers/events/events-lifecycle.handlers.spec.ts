import { describe, expect, it } from '@effect/vitest';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { TransactionRollbackError } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
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
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from '../shared/rpc-access.service';
import {
  buildEventAddonInsert,
  buildEventQuestionInsert,
  eventLifecycleHandlers,
  simpleEventOptionShapeIsValid,
  templateOptionSnapshotIsComplete,
} from './events-lifecycle.handlers';

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

const user = {
  attributes: [],
  auth0Id: 'auth0|user-1',
  email: 'alice@example.com',
  firstName: 'Alice',
  iban: null,
  id: 'user-1',
  lastName: 'Doe',
  paypalEmail: null,
  permissions: ['events:create'],
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
        selection.simpleModeEnabled !== undefined &&
        selection.unlisted !== undefined
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
      if (selection.id === roles.id) {
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

  it.effect('events.create rejects an event end before its start', () =>
    Effect.gen(function* () {
      const error = yield* eventLifecycleHandlers['events.create'](
        {
          ...createInput,
          end: '2026-09-20T09:00:00.000Z',
        },
        { headers: {} } as never,
      ).pipe(Effect.flip, Effect.provide(requestContextLayer));

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('invalidDates');
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
        ).pipe(Effect.flip, Effect.provide(requestContextLayer));

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('invalidRegistrationOptionTimes');
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
          reason: 'stripeRequiredForPaidEventConfiguration',
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
        ).pipe(Effect.flip, Effect.provide(requestContextLayer));

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('invalidDates');
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
        ).pipe(Effect.flip, Effect.provide(requestContextLayer));

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('invalidRegistrationOptionTimes');
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
    'events.create copies template discounts by source option id when option titles match',
    () =>
      Effect.gen(function* () {
        const insertedEventValues = vi.fn(() => ({
          returning: vi.fn(() =>
            Effect.succeed([
              {
                id: 'event-1',
              },
            ]),
          ),
        }));
        const insertedDiscountValues = vi.fn(() => Effect.succeed());
        const insertedRegistrationOptionValues = vi.fn(() => ({
          returning: vi.fn(() =>
            Effect.succeed([
              {
                id: 'event-option-1',
              },
              {
                id: 'event-option-2',
              },
            ]),
          ),
        }));
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
        expect(insertedDiscountValues).toHaveBeenCalledWith([
          {
            discountedPrice: 500,
            discountType: 'esnCard',
            registrationOptionId: 'event-option-2',
          },
        ]);
      }),
  );

  it.effect(
    'events.create skips copied ESNcard discounts when the tenant provider is disabled',
    () =>
      Effect.gen(function* () {
        const insertedDiscountValues = vi.fn(() => Effect.succeed());
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
                values: vi.fn(() => ({
                  returning: vi.fn(() =>
                    Effect.succeed([
                      {
                        id: 'event-option-1',
                      },
                    ]),
                  ),
                })),
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
        expect(insertedDiscountValues).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'events.create rejects copied template discounts that exceed the event option price',
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
        expect(error.reason).toBe('esnDiscountExceedsPrice');
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

  it.effect(
    'events.create copies template add-ons to matching event registration options',
    () =>
      Effect.gen(function* () {
        const insertedEventAddonValues = vi.fn(() => ({
          returning: vi.fn(() => Effect.succeed([{ id: 'event-addon-1' }])),
        }));
        const insertedEventAddonOptionValues = vi.fn(() => Effect.succeed());
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
                values: vi.fn(() => ({
                  returning: vi.fn(() =>
                    Effect.succeed([
                      {
                        id: 'event-option-1',
                      },
                    ]),
                  ),
                })),
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
        expect(insertedEventAddonOptionValues).toHaveBeenCalledWith([
          {
            addonId: 'event-addon-1',
            eventId: 'event-1',
            includedQuantity: 1,
            optionalPurchaseQuantity: 1,
            registrationOptionId: 'event-option-1',
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
        const insertedEventAddonOptionValues = vi.fn(() => Effect.succeed());
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
        const insertedEventQuestionValues = vi.fn(() => Effect.succeed());
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
                values: vi.fn(() => ({
                  returning: vi.fn(() =>
                    Effect.succeed([
                      {
                        id: 'event-option-1',
                      },
                    ]),
                  ),
                })),
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
        expect(insertedEventQuestionValues).toHaveBeenCalledWith([
          {
            description: 'Tell us about your experience.',
            eventId: 'event-1',
            registrationOptionId: 'event-option-1',
            required: true,
            sortOrder: 0,
            sourceTemplateQuestionId: 'template-question-1',
            title: 'Experience',
          },
        ]);
      }),
  );
});
