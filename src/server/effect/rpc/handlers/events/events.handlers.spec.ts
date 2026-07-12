import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventAddons,
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestions,
  eventRegistrations,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from '../shared/rpc-access.service';
import {
  eventQueryHandlers,
  organizerRegistrationTransferAvailable,
} from './events-query.handlers';
import { eventHandlers } from './events.handlers';

const emptyHandlerOptions = { headers: Headers.fromInput({}) };

const tenant = {
  currency: 'EUR' as const,
  defaultLocation: null,
  discountProviders: null,
  domain: 'tenant.example.com',
  id: 'tenant-1',
  locale: 'en',
  name: 'Tenant',
  receiptSettings: null,
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
};

const createUser = (permissions: readonly Permission[] = []) => ({
  attributes: [],
  auth0Id: 'auth0|user-1',
  communicationEmail: undefined,
  email: 'member@example.com',
  firstName: 'Tenant',
  iban: undefined,
  id: 'user-1',
  lastName: 'Member',
  paypalEmail: undefined,
  permissions,
  roleIds: [],
});

const createEventQueryDatabase = ({
  organizerRegistration = false,
  registrationOptionAggregates = [],
}: {
  organizerRegistration?: boolean;
  registrationOptionAggregates?: readonly {
    checkedInSpots: number;
    confirmedSpots: number;
    spots: number;
  }[];
} = {}) => {
  const attendeeQuery = vi.fn(() => Effect.succeed([]));
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
  it.effect('ignores a verified ESN card that belongs to another tenant', () =>
    Effect.gen(function* () {
      const findCards = vi.fn((query: { where: { tenantId?: string } }) =>
        Effect.succeed(
          query.where.tenantId === tenant.id
            ? []
            : [{ validTo: new Date('2100-01-01T00:00:00.000Z') }],
        ),
      );
      const select = vi.fn(() => ({
        from: (table: unknown) => {
          if (table === eventAddons) {
            return {
              innerJoin: () => ({
                where: () => Effect.succeed([]),
              }),
            };
          }
          if (table === eventRegistrationQuestions) {
            return {
              where: () => ({
                orderBy: () => Effect.succeed([]),
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
          throw new Error('Unexpected event detail table');
        },
      }));
      const database = {
        query: {
          eventInstances: {
            findFirst: () =>
              Effect.succeed({
                creatorId: 'organizer-1',
                description: 'Tenant-scoped event',
                end: new Date('2099-01-02T00:00:00.000Z'),
                icon: 'calendar',
                id: 'event-1',
                location: null,
                registrationOptions: [
                  {
                    checkedInSpots: 0,
                    closeRegistrationTime: new Date('2099-01-01T00:00:00.000Z'),
                    confirmedSpots: 0,
                    description: null,
                    eventId: 'event-1',
                    id: 'option-1',
                    isPaid: true,
                    openRegistrationTime: new Date('2098-01-01T00:00:00.000Z'),
                    organizingRegistration: false,
                    price: 2000,
                    registeredDescription: null,
                    registrationMode: 'fcfs' as const,
                    reservedSpots: 0,
                    roleIds: [],
                    spots: 20,
                    stripeTaxRateId: null,
                    title: 'Participant',
                  },
                ],
                reviewer: null,
                start: new Date('2099-01-01T12:00:00.000Z'),
                status: 'APPROVED' as const,
                statusComment: null,
                title: 'Tenant-scoped event',
                unlisted: false,
              }),
          },
          userDiscountCards: {
            findMany: findCards,
          },
        },
        select,
      };

      const event = yield* eventQueryHandlers['events.findOne'](
        { id: 'event-1' },
        emptyHandlerOptions,
      ).pipe(
        Effect.provide(
          createContextLayer({
            database,
            tenantOverride: {
              ...tenant,
              discountProviders: {
                esnCard: { config: {}, status: 'enabled' },
              },
            },
          }),
        ),
      );

      expect(event.registrationOptions[0]).toMatchObject({
        appliedDiscountType: null,
        discountApplied: false,
        effectivePrice: 2000,
        esnCardDiscountedPrice: null,
      });
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

describe('organizerRegistrationTransferAvailable', () => {
  it('keeps organizer-assisted transfer unavailable for paid, checked-in, or past registrations', () => {
    const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

    expect(
      organizerRegistrationTransferAvailable({
        checkInTime: null,
        eventStart: futureStart,
        transactions: [],
      }),
    ).toBe(true);
    expect(
      organizerRegistrationTransferAvailable({
        checkInTime: new Date(),
        eventStart: futureStart,
        transactions: [],
      }),
    ).toBe(false);
    expect(
      organizerRegistrationTransferAvailable({
        checkInTime: null,
        eventStart: pastStart,
        transactions: [],
      }),
    ).toBe(false);
    expect(
      organizerRegistrationTransferAvailable({
        checkInTime: null,
        eventStart: futureStart,
        transactions: [
          {
            amount: 2500,
            status: 'successful',
          },
        ],
      }),
    ).toBe(false);
  });
});

describe('organizer overview authorization', () => {
  it.effect('denies a non-organizer before querying attendee data', () =>
    Effect.gen(function* () {
      const { attendeeQuery, database } = createEventQueryDatabase();

      const error = yield* eventQueryHandlers['events.getOrganizeOverview'](
        { eventId: 'event-1' },
        emptyHandlerOptions,
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

      expect(error._tag).toBe('RpcForbiddenError');
      expect(error.permission).toBe('events:organizeAll');
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
        emptyHandlerOptions,
      ).pipe(Effect.provide(layer));
      const overview = yield* eventQueryHandlers['events.getOrganizeOverview'](
        { eventId: 'event-1' },
        emptyHandlerOptions,
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
        emptyHandlerOptions,
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
        ]({ eventId: 'event-1' }, emptyHandlerOptions).pipe(
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
