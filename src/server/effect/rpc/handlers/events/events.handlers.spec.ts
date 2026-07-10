import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';

import { Database, type DatabaseClient } from '../../../../../db';
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
}: {
  organizerRegistration?: boolean;
} = {}) => {
  const attendeeQuery = vi.fn(() => Effect.succeed([]));
  const organizerQuery = {
    from: () => organizerQuery,
    innerJoin: () => organizerQuery,
    limit: vi.fn(() =>
      Effect.succeed(organizerRegistration ? [{ id: 'registration-1' }] : []),
    ),
    where: () => organizerQuery,
  };
  const select = vi.fn(() => organizerQuery);

  return {
    attendeeQuery,
    database: {
      query: {
        eventRegistrations: {
          findMany: attendeeQuery,
        },
      },
      select,
    },
    select,
  };
};

const createContextLayer = ({
  database,
  user = createUser(),
}: {
  database: object;
  user?: ReturnType<typeof createUser>;
}) => {
  const context = {
    authData: {},
    authenticated: true,
    permissions: user.permissions,
    tenant,
    user,
    userAssigned: true,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, context),
    Layer.succeed(Database, database as DatabaseClient),
  );
};

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
      expect(overview).toEqual([]);
      expect(attendeeQuery).toHaveBeenCalledOnce();
    }),
  );

  it.effect.each([
    'events:organizeAll' as const,
    'finance:manageReceipts' as const,
  ])('allows tenant-wide organizer authority through %s', (permission) =>
    Effect.gen(function* () {
      const { attendeeQuery, database, select } = createEventQueryDatabase();

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

      expect(overview).toEqual([]);
      expect(select).not.toHaveBeenCalled();
      expect(attendeeQuery).toHaveBeenCalledOnce();
    }),
  );
});
