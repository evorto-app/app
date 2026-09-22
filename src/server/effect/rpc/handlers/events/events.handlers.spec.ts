import { describe, expect, it, vi } from '@effect/vitest';
import * as EventsRpcs from '@shared/rpc-contracts/app-rpcs/events.rpcs';
import {
  createDefaultTenantDiscountProviders,
  DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
  DEFAULT_TENANT_RECEIPT_COUNTRIES,
} from '@shared/tenant-config';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Effect, Layer, Result } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventAddons,
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestions,
  eventRegistrations,
  tenantStripeTaxRates,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from '../shared/rpc-access.service';
import { eventQueryHandlers } from './events-query.handlers';
import { eventHandlers } from './events.handlers';

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
  discountProviders: createDefaultTenantDiscountProviders(),
  domain: 'tenant.example.com',
  id: 'tenant-1',
  maxActiveRegistrationsPerUser: 0,
  name: 'Tenant',
  receiptSettings: {
    allowOther: DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
    receiptCountries: [...DEFAULT_TENANT_RECEIPT_COUNTRIES],
  },
  refundFeesOnCancellation: true,
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
  transferDeadlineHoursBeforeStart: 0,
};

const createUser = (permissions: readonly Permission[] = []) => ({
  attributes: [],
  auth0Id: 'auth0|user-1',
  communicationEmail: undefined,
  email: 'member@example.com',
  firstName: 'Tenant',
  homeTenantId: undefined,
  homeTenantName: undefined,
  iban: undefined,
  id: 'user-1',
  lastName: 'Member',
  paypalEmail: undefined,
  permissions,
  roleIds: [],
});

const createEventQueryDatabase = ({
  attendeeRows = [],
  organizerRegistration = false,
  registrationOptionAggregates = [],
}: {
  attendeeRows?: readonly object[];
  organizerRegistration?: boolean;
  registrationOptionAggregates?: readonly {
    checkedInSpots: number;
    confirmedSpots: number;
    spots: number;
  }[];
} = {}) => {
  const attendeeQuery = vi.fn(() => Effect.succeed([...attendeeRows]));
  const aggregateQuery = {
    innerJoin: vi.fn(() => aggregateQuery),
    where: vi.fn(() => Effect.succeed([...registrationOptionAggregates])),
  };
  const organizerLookup = vi.fn(() =>
    Effect.succeed(organizerRegistration ? [{ id: 'registration-1' }] : []),
  );
  const organizerQuery = {
    innerJoin: () => organizerQuery,
    limit: organizerLookup,
    where: () => organizerQuery,
  };
  const select = vi.fn(() => ({
    from: (table: unknown) => {
      if (table === eventRegistrations) return organizerQuery;
      if (table === eventRegistrationOptions) return aggregateQuery;
      throw new Error('Unexpected organizer overview select table');
    },
  }));

  return {
    aggregateQuery,
    attendeeQuery,
    database: {
      query: {
        eventRegistrations: {
          findMany: attendeeQuery,
        },
      },
      select,
    },
    organizerLookup,
    select,
  };
};

const createContextLayer = ({
  database,
  tenantOverride = tenant,
  user = createUser(),
}: {
  database: object;
  tenantOverride?: RpcRequestContextShape['tenant'];
  user?: ReturnType<typeof createUser>;
}) => {
  const context = {
    authData: {},
    authenticated: true,
    permissions: user.permissions,
    tenant: tenantOverride,
    user,
    userAssigned: true,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, context),
    Layer.succeed(Database, database as DatabaseClient),
  );
};

describe('event discount tenant isolation', () => {
  for (const {
    addonCount,
    hiddenOptions,
    mappingCount,
    questionCount,
    status,
    taxScenario,
  } of [
    {
      addonCount: 0,
      hiddenOptions: false,
      mappingCount: 0,
      questionCount: 0,
      status: 'APPROVED',
      taxScenario: 'valid',
    },
    {
      addonCount: 0,
      hiddenOptions: false,
      mappingCount: 0,
      questionCount: 25,
      status: 'APPROVED',
      taxScenario: 'valid',
    },
    {
      addonCount: 0,
      hiddenOptions: false,
      mappingCount: 0,
      questionCount: 26,
      status: 'APPROVED',
      taxScenario: 'valid',
    },
    {
      addonCount: 20,
      hiddenOptions: false,
      mappingCount: 40,
      questionCount: 0,
      status: 'APPROVED',
      taxScenario: 'valid',
    },
    {
      addonCount: 21,
      hiddenOptions: false,
      mappingCount: 0,
      questionCount: 0,
      status: 'APPROVED',
      taxScenario: 'valid',
    },
    {
      addonCount: 21,
      hiddenOptions: true,
      mappingCount: 0,
      questionCount: 0,
      status: 'APPROVED',
      taxScenario: 'valid',
    },
    {
      addonCount: 21,
      hiddenOptions: false,
      mappingCount: 0,
      questionCount: 0,
      status: 'DRAFT',
      taxScenario: 'valid',
    },
    ...[
      'missingId',
      'missingRow',
      'nullPercentage',
      'zeroPercentage',
      'nullDisplayName',
      'free',
      'hiddenInvalid',
      'optionalAddonWithoutTax',
    ].map((taxScenario) => ({
      addonCount: taxScenario === 'optionalAddonWithoutTax' ? 1 : 0,
      hiddenOptions: taxScenario === 'hiddenInvalid',
      mappingCount: taxScenario === 'optionalAddonWithoutTax' ? 1 : 0,
      questionCount: 0,
      status: 'APPROVED',
      taxScenario,
    })),
  ]) {
    it.effect(
      `bounds visible events before registration: questions=${questionCount}, add-ons=${addonCount}, mappings=${mappingCount}, hidden=${hiddenOptions}, status=${status}, tax=${taxScenario}`,
      () =>
        Effect.gen(function* () {
          const freeOption =
            taxScenario === 'free' || taxScenario === 'optionalAddonWithoutTax';
          const optionTaxRateId =
            freeOption || taxScenario === 'missingId' ? null : 'txr_option';
          const taxPercentage = taxScenario === 'zeroPercentage' ? '0' : '19';
          const readTaxRates = vi.fn((condition: SQL) => {
            const query = new PgDialect().sqlToQuery(condition);
            expect(query.sql).toContain('"tenant_stripe_tax_rates"."tenantId"');
            expect(query.sql).toContain(
              '"tenant_stripe_tax_rates"."stripeAccountId"',
            );
            expect(query.params).toEqual([
              tenant.id,
              'acct_tenant',
              'txr_option',
            ]);
            return Effect.succeed(
              taxScenario === 'missingRow'
                ? []
                : [
                    {
                      displayName:
                        taxScenario === 'nullDisplayName' ? null : 'VAT',
                      percentage:
                        taxScenario === 'nullPercentage' ? null : taxPercentage,
                      stripeTaxRateId: 'txr_option',
                    },
                  ],
            );
          });
          const findCards = vi.fn((query: { where: { tenantId?: string } }) =>
            Effect.succeed(
              query.where.tenantId === tenant.id
                ? []
                : [
                    {
                      validFrom: new Date('2000-01-01T00:00:00.000Z'),
                      validTo: new Date('2100-01-01T00:00:00.000Z'),
                    },
                  ],
            ),
          );
          const findAddons = vi.fn(() =>
            Effect.succeed(
              Array.from({ length: addonCount }, (_, index) => ({
                id: `addon-${index}`,
              })),
            ),
          );
          const addonMappings = Array.from(
            { length: mappingCount },
            (_, index) => ({
              allowMultiple: true,
              allowPurchaseBeforeEvent: false,
              allowPurchaseDuringEvent: false,
              allowPurchaseDuringRegistration: true,
              description: null,
              id: `addon-${index % 20}`,
              includedQuantity:
                taxScenario === 'optionalAddonWithoutTax' ? 0 : 1,
              isPaid: taxScenario === 'optionalAddonWithoutTax',
              maxQuantityPerUser: 1,
              optionalPurchaseQuantity:
                taxScenario === 'optionalAddonWithoutTax' ? 1 : 0,
              price: taxScenario === 'optionalAddonWithoutTax' ? 500 : 0,
              registrationOptionId: `option-${1 + Math.floor(index / 20)}`,
              stripeTaxRateId: null,
              title: 'Included item',
              totalAvailableQuantity: 100,
            }),
          );
          const select = vi.fn(() => ({
            from: (table: unknown) => {
              if (table === eventAddons) {
                return {
                  innerJoin: () => ({
                    where: () => Effect.succeed(addonMappings),
                  }),
                };
              }
              if (table === eventRegistrationQuestions) {
                return {
                  where: () => ({
                    orderBy: () =>
                      Effect.succeed(
                        Array.from({ length: questionCount }, (_, index) => ({
                          description: null,
                          id: `question-${index}`,
                          registrationOptionId: 'option-1',
                          required: true,
                          sortOrder: index,
                          title: `Question ${index}`,
                        })),
                      ),
                  }),
                };
              }
              if (table === eventRegistrationOptionDiscounts) {
                return {
                  where: () =>
                    Effect.succeed([
                      {
                        discountedPrice: 1000,
                        discountType: 'esnCard' as const,
                        registrationOptionId: 'option-1',
                      },
                    ]),
                };
              }
              if (table === tenantStripeTaxRates) {
                return { where: readTaxRates };
              }
              throw new Error('Unexpected event detail table');
            },
          }));
          const database = {
            query: {
              eventAddons: { findMany: findAddons },
              eventInstances: {
                findFirst: () =>
                  Effect.succeed({
                    creatorId: 'organizer-1',
                    description: 'Tenant-scoped event',
                    end: new Date('2099-01-02T00:00:00.000Z'),
                    icon: 'calendar',
                    id: 'event-1',
                    location: null,
                    registrationOptions: hiddenOptions
                      ? []
                      : [
                          {
                            checkedInSpots: 0,
                            closeRegistrationTime: new Date(
                              '2099-01-01T00:00:00.000Z',
                            ),
                            confirmedSpots: 0,
                            description: null,
                            eventId: 'event-1',
                            id: 'option-1',
                            isPaid: !freeOption,
                            openRegistrationTime: new Date(
                              '2098-01-01T00:00:00.000Z',
                            ),
                            organizingRegistration: false,
                            price: freeOption ? 0 : 2000,
                            registeredDescription: null,
                            registrationMode: 'fcfs' as const,
                            reservedSpots: 0,
                            roleIds: [],
                            spots: 20,
                            stripeTaxRateId: optionTaxRateId,
                            title: 'Participant',
                          },
                        ],
                    reviewer: null,
                    start: new Date('2099-01-01T12:00:00.000Z'),
                    status,
                    statusComment: null,
                    title: 'Tenant-scoped event',
                    unlisted: false,
                  }),
              },
              eventRegistrationOptions: {
                findFirst: () => Effect.succeed({ id: 'hidden-option' }),
              },
              userDiscountCards: {
                findMany: findCards,
              },
            },
            select,
          };

          const result = yield* eventQueryHandlers['events.findOne'](
            { id: 'event-1' },
            createRpcOptions(
              EventsRpcs.EventsFindOne.middleware(RpcRequestContextMiddleware),
            ),
          ).pipe(
            Effect.result,
            Effect.provide(
              createContextLayer({
                database,
                tenantOverride: {
                  ...tenant,
                  discountProviders: {
                    esnCard: { config: {}, status: 'enabled' },
                  },
                  stripeAccountId: 'acct_tenant',
                },
              }),
            ),
          );

          if (status === 'DRAFT') {
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result))
              expect(result.failure).toMatchObject({
                _tag: 'EventNotFoundError',
              });
            expect(findAddons).not.toHaveBeenCalled();
            return;
          }
          expect(findAddons).toHaveBeenCalledExactlyOnceWith({
            columns: { id: true },
            limit: 21,
            where: { event: { tenantId: tenant.id }, eventId: 'event-1' },
          });
          if (addonCount > 20) {
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result))
              expect(result.failure).toMatchObject({
                _tag: 'EventConflictError',
                message:
                  'Registration is unavailable because its add-on settings need to be corrected. Contact the organizer.',
              });
            expect(select).not.toHaveBeenCalled();
            expect(findCards).not.toHaveBeenCalled();
            return;
          }
          if (questionCount > 25) {
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result))
              expect(result.failure).toMatchObject({
                _tag: 'EventConflictError',
              });
            expect(findCards).not.toHaveBeenCalled();
            return;
          }
          if (!hiddenOptions && optionTaxRateId) {
            expect(readTaxRates).toHaveBeenCalledTimes(1);
          } else {
            expect(readTaxRates).not.toHaveBeenCalled();
          }
          if (
            ['missingId', 'missingRow', 'nullPercentage'].includes(taxScenario)
          ) {
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result)) {
              expect(result.failure).toMatchObject({
                _tag: 'EventConflictError',
                message:
                  'Registration is unavailable because its tax settings need to be corrected. Contact the organizer.',
              });
            }
            expect(findCards).not.toHaveBeenCalled();
            return;
          }
          expect(Result.isSuccess(result)).toBe(true);
          if (!Result.isSuccess(result)) return;
          const event = result.success;
          if (hiddenOptions) {
            expect(event.registrationOptions).toEqual([]);
            expect(event.registrationOptionsHiddenByEligibility).toBe(true);
            return;
          }
          expect(event.addOns).toHaveLength(Math.min(mappingCount, 20));
          expect(event.registrationOptions[0]?.questions).toHaveLength(
            questionCount,
          );
          expect(event.registrationOptions[0]).toMatchObject({
            appliedDiscountType: null,
            discountApplied: false,
            effectivePrice: freeOption ? 0 : 2000,
            esnCardDiscountedPrice: null,
            taxRateDisplayName:
              freeOption || taxScenario === 'nullDisplayName' ? null : 'VAT',
            taxRatePercentage: freeOption ? null : taxPercentage,
          });
          if (taxScenario === 'optionalAddonWithoutTax') {
            expect(event.addOns[0]).toMatchObject({
              isPaid: true,
              price: 500,
              stripeTaxRateId: null,
              taxRatePercentage: null,
            });
          }
          expect(findCards).toHaveBeenCalledWith(
            expect.objectContaining({
              where: {
                status: 'verified',
                tenantId: tenant.id,
                type: 'esnCard',
                userId: 'user-1',
              },
            }),
          );
        }),
    );
  }
});

describe('eventHandlers composition', () => {
  it('contains the full events rpc handler set', () => {
    expect(Object.keys(eventHandlers).toSorted()).toEqual([
      'events.approveRegistration',
      'events.canOrganize',
      'events.cancelEventRegistration',
      'events.cancelPendingRegistration',
      'events.cancelRegistration',
      'events.cancelRegistrationAddon',
      'events.checkInRegistration',
      'events.create',
      'events.eventList',
      'events.findGraphForEdit',
      'events.findOne',
      'events.findOneForEdit',
      'events.findTransferTargets',
      'events.getOrganizeOverview',
      'events.getPendingReviews',
      'events.getRegistrationAddonFulfillment',
      'events.getRegistrationStatus',
      'events.joinWaitlist',
      'events.previewEventRegistrationTransfer',
      'events.purchaseRegistrationAddon',
      'events.redeemRegistrationAddon',
      'events.registerForEvent',
      'events.registrationScanned',
      'events.reviewEvent',
      'events.submitForReview',
      'events.transferEventRegistration',
      'events.transferMyRegistration',
      'events.undoRegistrationAddonRedemption',
      'events.update',
      'events.updateGraph',
      'events.updateListing',
    ]);
  });
});

describe('organizer overview authorization', () => {
  it.effect('denies a non-organizer before querying attendee data', () =>
    Effect.gen(function* () {
      const { attendeeQuery, database } = createEventQueryDatabase();

      const error = yield* eventQueryHandlers['events.getOrganizeOverview'](
        { eventId: 'event-1' },
        createRpcOptions(
          EventsRpcs.EventsGetOrganizeOverview.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

      expect(error._tag).toBe('RpcForbiddenError');
      expect(error).toMatchObject({ permission: 'events:organizeAll' });
      expect(attendeeQuery).not.toHaveBeenCalled();
    }),
  );

  it.effect('uses confirmed organizer registration access in both RPCs', () =>
    Effect.gen(function* () {
      const { attendeeQuery, database } = createEventQueryDatabase({
        organizerRegistration: true,
      });
      const layer = createContextLayer({ database });

      const canOrganize = yield* eventQueryHandlers['events.canOrganize'](
        { eventId: 'event-1' },
        createRpcOptions(
          EventsRpcs.EventsCanOrganize.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(Effect.provide(layer));
      const overview = yield* eventQueryHandlers['events.getOrganizeOverview'](
        { eventId: 'event-1' },
        createRpcOptions(
          EventsRpcs.EventsGetOrganizeOverview.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      ).pipe(Effect.provide(layer));

      expect(canOrganize).toBe(true);
      expect(overview).toEqual({
        registrationOptions: [],
        stats: { capacity: 0, checkedIn: 0, registered: 0 },
      });
      expect(attendeeQuery).toHaveBeenCalledOnce();
    }),
  );

  it.effect.each([
    'events:organizeAll' as const,
    'finance:manageReceipts' as const,
  ])('allows tenant-wide organizer authority through %s', (permission) =>
    Effect.gen(function* () {
      const { attendeeQuery, database, organizerLookup } =
        createEventQueryDatabase();

      const overview = yield* eventQueryHandlers['events.getOrganizeOverview'](
        { eventId: 'event-1' },
        createRpcOptions(
          EventsRpcs.EventsGetOrganizeOverview.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      ).pipe(
        Effect.provide(
          createContextLayer({
            database,
            user: createUser([permission]),
          }),
        ),
      );

      expect(overview).toEqual({
        registrationOptions: [],
        stats: { capacity: 0, checkedIn: 0, registered: 0 },
      });
      expect(organizerLookup).not.toHaveBeenCalled();
      expect(attendeeQuery).toHaveBeenCalledOnce();
    }),
  );

  it.effect(
    'derives stats from every tenant-scoped option, including role-hidden options without registrations',
    () =>
      Effect.gen(function* () {
        const { aggregateQuery, database } = createEventQueryDatabase({
          registrationOptionAggregates: [
            { checkedInSpots: 1, confirmedSpots: 2, spots: 4 },
            { checkedInSpots: 0, confirmedSpots: 1, spots: 2 },
          ],
        });

        const overview = yield* eventQueryHandlers[
          'events.getOrganizeOverview'
        ](
          { eventId: 'event-1' },
          createRpcOptions(
            EventsRpcs.EventsGetOrganizeOverview.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
              user: createUser(['events:organizeAll']),
            }),
          ),
        );

        expect(overview).toEqual({
          registrationOptions: [],
          stats: { capacity: 6, checkedIn: 1, registered: 3 },
        });
        expect(aggregateQuery.innerJoin).toHaveBeenCalledWith(
          eventInstances,
          expect.anything(),
        );
        expect(aggregateQuery.where).toHaveBeenCalledOnce();
      }),
  );
});
