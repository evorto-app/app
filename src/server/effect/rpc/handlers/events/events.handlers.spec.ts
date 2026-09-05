import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { describe, expect, it, vi } from '@effect/vitest';
import * as EventsRpcs from '@shared/rpc-contracts/app-rpcs/events.rpcs';
import {
  createDefaultTenantDiscountProviders,
  DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
  DEFAULT_TENANT_RECEIPT_COUNTRIES,
} from '@shared/tenant-config';
import { Effect, Layer, Result } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';

import {
  eventInstances,
  eventRegistrationOptions,
  userDiscountCards,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { createRegistrationDatabaseTestLayer } from '../../../../testing/registration-database';
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

interface EventSqlQuery {
  readonly parameters: Parameters<SqlConnection.Connection['executeValues']>[1];
  readonly statement: string;
}

type RegistrationOptionAggregate = Pick<
  typeof eventRegistrationOptions.$inferSelect,
  'checkedInSpots' | 'confirmedSpots' | 'spots'
>;

const organizerAccessSql =
  'select "event_registrations"."id" from "event_registrations" inner join "event_registration_options" on "event_registrations"."registrationOptionId" = "event_registration_options"."id" where (("event_registrations"."tenantId" = $1) and ("event_registrations"."eventId" = $2) and ("event_registrations"."userId" = $3) and ("event_registrations"."status" = $4) and ("event_registration_options"."organizingRegistration" = $5)) limit $6';
const optionAggregateSql =
  'select "event_registration_options"."checkedInSpots", "event_registration_options"."confirmedSpots", "event_registration_options"."spots" from "event_registration_options" inner join "event_instances" on (("event_instances"."id" = "event_registration_options"."eventId") and ("event_instances"."tenantId" = $1)) where "event_registration_options"."eventId" = $2';
const attendeeProjectionSql =
  'select "d0"."applied_discounted_price" as "appliedDiscountedPrice", "d0"."applied_discount_type" as "appliedDiscountType", "d0"."base_price_at_registration" as "basePriceAtRegistration", "d0"."checkInTime"::text as "checkInTime", "d0"."discount_amount" as "discountAmount", "d0"."id" as "id", "d0"."registrationOptionId" as "registrationOptionId", "d0"."status" as "status", "addonPurchases"."r" as "addonPurchases", "registrationOption"."r" as "registrationOption", "transactions"."r" as "transactions", "user"."r" as "user" from "event_registrations" as "d0" ';

const createEventQueryDatabase = ({
  organizerRegistration = false,
  registrationOptionAggregates = [],
}: {
  organizerRegistration?: boolean;
  registrationOptionAggregates?: readonly RegistrationOptionAggregate[];
} = {}) => {
  const attendeeQuery = vi.fn<(query: EventSqlQuery) => void>();
  const aggregateQuery = vi.fn<(query: EventSqlQuery) => void>();
  const organizerLookup = vi.fn<(query: EventSqlQuery) => void>();
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        if (statement === organizerAccessSql) {
          expect(parameters).toEqual([
            tenant.id,
            'event-1',
            'user-1',
            'CONFIRMED',
            true,
            1,
          ]);
          organizerLookup({ parameters, statement });
          return organizerRegistration ? [['registration-1']] : [];
        }
        if (statement === optionAggregateSql) {
          expect(parameters).toEqual([tenant.id, 'event-1']);
          aggregateQuery({ parameters, statement });
          return registrationOptionAggregates.map((option) => [
            option.checkedInSpots,
            option.confirmedSpots,
            option.spots,
          ]);
        }
        if (statement.startsWith(attendeeProjectionSql)) {
          expect(statement).toContain(
            'select "d1"."amount" as "amount", "d1"."status" as "status", "d1"."stripeCheckoutSessionId" as "stripeCheckoutSessionId", "d1"."type" as "type" from "transactions" as "d1" where (("d1"."type" = $3) and ("d0"."id" = "d1"."eventRegistrationId"))',
          );
          expect(
            statement.endsWith(
              ' where (("d0"."eventId" = $5) and (not ("d0"."status" = $6)) and ("d0"."tenantId" = $7))',
            ),
          ).toBe(true);
          expect(parameters).toEqual([
            1,
            1,
            'registration',
            1,
            'event-1',
            'CANCELLED',
            tenant.id,
          ]);
          attendeeQuery({ parameters, statement });
          return [];
        }
        throw new Error(`Unexpected organizer overview SQL: ${statement}`);
      }),
  });

  return { aggregateQuery, attendeeQuery, databaseLayer, organizerLookup };
};

const eventDetailSql = [
  'select "d0"."announcementRoleIds" as "announcementRoleIds", "d0"."creatorId" as "creatorId", "d0"."description" as "description", "d0"."end"::text as "end", "d0"."icon" as "icon", "d0"."id" as "id", "d0"."location" as "location", "d0"."start"::text as "start", "d0"."status" as "status", "d0"."statusComment" as "statusComment", "d0"."title" as "title", "registrationOptions"."r" as "registrationOptions", "reviewer"."r" as "reviewer" from "event_instances" as "d0"',
  `left join lateral(select coalesce(json_agg(row_to_json("t".*)), '[]') as "r" from (select "d1"."checkedInSpots" as "checkedInSpots", "d1"."closeRegistrationTime"::text as "closeRegistrationTime", "d1"."confirmedSpots" as "confirmedSpots", "d1"."description" as "description", "d1"."eventId" as "eventId", "d1"."id" as "id", "d1"."isPaid" as "isPaid", "d1"."openRegistrationTime"::text as "openRegistrationTime", "d1"."organizingRegistration" as "organizingRegistration", "d1"."price" as "price", "d1"."registeredDescription" as "registeredDescription", "d1"."registrationMode" as "registrationMode", "d1"."reservedSpots" as "reservedSpots", "d1"."roleIds" as "roleIds", "d1"."spots" as "spots", "d1"."stripeTaxRateId" as "stripeTaxRateId", "d1"."title" as "title" from "event_registration_options" as "d1" where "d0"."id" = "d1"."eventId") as "t") as "registrationOptions" on true`,
  'left join lateral(select row_to_json("t".*) "r" from (select "d1"."firstName" as "firstName", "d1"."lastName" as "lastName" from "users" as "d1" where "d0"."reviewedBy" = "d1"."id" limit $1) as "t") as "reviewer" on true',
  'where (("d0"."id" = $2) and ("d0"."tenantId" = $3)) limit $4',
].join(' ');
const eventAddonsSql =
  'select "event_addons"."allowMultiple", "event_addons"."allowPurchaseBeforeEvent", "event_addons"."allowPurchaseDuringEvent", "event_addons"."allowPurchaseDuringRegistration", "event_addons"."description", "event_addons"."id", "addon_to_event_registration_options"."included_quantity", "event_addons"."isPaid", "event_addons"."maxQuantityPerUser", "addon_to_event_registration_options"."optional_purchase_quantity", "event_addons"."price", "addon_to_event_registration_options"."registrationOptionId", "event_addons"."stripeTaxRateId", "event_addons"."title", "event_addons"."totalAvailableQuantity" from "event_addons" inner join "addon_to_event_registration_options" on "addon_to_event_registration_options"."addonId" = "event_addons"."id" where (("event_addons"."eventId" = $1) and ("addon_to_event_registration_options"."registrationOptionId" in ($2)))';
const eventQuestionsSql =
  'select "description", "id", "registrationOptionId", "required", "sortOrder", "title" from "event_registration_questions" where (("event_registration_questions"."eventId" = $1) and ("event_registration_questions"."registrationOptionId" in ($2))) order by "event_registration_questions"."sortOrder" asc, "event_registration_questions"."id" asc';
const optionDiscountsSql =
  'select "discountedPrice", "discountType", "registrationOptionId" from "event_registration_option_discounts" where (("event_registration_option_discounts"."discountType" = $1) and ("event_registration_option_discounts"."registrationOptionId" in ($2)))';
const discountCardsSql =
  'select "d0"."validFrom"::text as "validFrom", "d0"."validTo"::text as "validTo" from "user_discount_cards" as "d0" where (("d0"."status" = $1) and ("d0"."tenantId" = $2) and ("d0"."type" = $3) and ("d0"."userId" = $4))';

const databaseTimestamp = (value: Date) =>
  value.toISOString().replace('T', ' ').replace('Z', '');

const createEventDiscountDatabase = (questionCount = 0) => {
  const findCards = vi.fn<(query: EventSqlQuery) => void>();
  const option = {
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
    registrationMode: 'fcfs',
    reservedSpots: 0,
    roleIds: [],
    spots: 20,
    stripeTaxRateId: null,
    title: 'Participant',
  } satisfies Pick<
    typeof eventRegistrationOptions.$inferSelect,
    | 'checkedInSpots'
    | 'closeRegistrationTime'
    | 'confirmedSpots'
    | 'description'
    | 'eventId'
    | 'id'
    | 'isPaid'
    | 'openRegistrationTime'
    | 'organizingRegistration'
    | 'price'
    | 'registeredDescription'
    | 'registrationMode'
    | 'reservedSpots'
    | 'roleIds'
    | 'spots'
    | 'stripeTaxRateId'
    | 'title'
  >;
  const event = {
    announcementRoleIds: [],
    creatorId: 'organizer-1',
    description: 'Tenant-scoped event',
    end: new Date('2099-01-02T00:00:00.000Z'),
    icon: { iconColor: 0, iconName: 'calendar' },
    id: 'event-1',
    location: null,
    start: new Date('2099-01-01T12:00:00.000Z'),
    status: 'APPROVED',
    statusComment: null,
    title: 'Tenant-scoped event',
  } satisfies Pick<
    typeof eventInstances.$inferSelect,
    | 'announcementRoleIds'
    | 'creatorId'
    | 'description'
    | 'end'
    | 'icon'
    | 'id'
    | 'location'
    | 'start'
    | 'status'
    | 'statusComment'
    | 'title'
  >;
  const foreignTenantCards = [
    {
      status: 'verified',
      tenantId: 'tenant-2',
      type: 'esnCard',
      userId: 'user-1',
      validFrom: new Date('2000-01-01T00:00:00.000Z'),
      validTo: new Date('2100-01-01T00:00:00.000Z'),
    },
  ] satisfies readonly Pick<
    typeof userDiscountCards.$inferSelect,
    'status' | 'tenantId' | 'type' | 'userId' | 'validFrom' | 'validTo'
  >[];
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        if (statement === eventDetailSql) {
          expect(parameters).toEqual([1, event.id, tenant.id, 1]);
          return [
            [
              event.announcementRoleIds,
              event.creatorId,
              event.description,
              databaseTimestamp(event.end),
              event.icon,
              event.id,
              event.location,
              databaseTimestamp(event.start),
              event.status,
              event.statusComment,
              event.title,
              [
                {
                  ...option,
                  closeRegistrationTime: databaseTimestamp(
                    option.closeRegistrationTime,
                  ),
                  openRegistrationTime: databaseTimestamp(
                    option.openRegistrationTime,
                  ),
                },
              ],
              null,
            ],
          ];
        }
        if (statement === eventAddonsSql) {
          expect(parameters).toEqual([event.id, option.id]);
          return [];
        }
        if (statement === eventQuestionsSql) {
          expect(parameters).toEqual([event.id, option.id]);
          return Array.from({ length: questionCount }, (_, index) => [
            null,
            `question-${index}`,
            'option-1',
            true,
            index,
            `Question ${index}`,
          ]);
        }
        if (statement === optionDiscountsSql) {
          expect(parameters).toEqual(['esnCard', option.id]);
          return [[1000, 'esnCard', option.id]];
        }
        if (statement === discountCardsSql) {
          expect(parameters).toEqual([
            'verified',
            tenant.id,
            'esnCard',
            'user-1',
          ]);
          findCards({ parameters, statement });
          return foreignTenantCards
            .filter(
              (card) =>
                card.status === parameters[0] &&
                card.tenantId === parameters[1] &&
                card.type === parameters[2] &&
                card.userId === parameters[3],
            )
            .map((card) => [
              databaseTimestamp(card.validFrom),
              databaseTimestamp(card.validTo),
            ]);
        }
        throw new Error(`Unexpected event discount SQL: ${statement}`);
      }),
  });

  return { databaseLayer, findCards };
};

const createContextLayer = ({
  databaseLayer,
  tenantOverride = tenant,
  user = createUser(),
}: {
  databaseLayer: ReturnType<typeof createRegistrationDatabaseTestLayer>;
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
    databaseLayer,
  );
};

describe('event discount tenant isolation', () => {
  for (const questionCount of [0, 25, 26]) {
    it.effect(
      `validates ${questionCount} stored questions before returning an actionable event`,
      () =>
        Effect.gen(function* () {
          const { databaseLayer, findCards } =
            createEventDiscountDatabase(questionCount);

          const result = yield* eventQueryHandlers['events.findOne'](
            { id: 'event-1' },
            createRpcOptions(
              EventsRpcs.EventsFindOne.middleware(RpcRequestContextMiddleware),
            ),
          ).pipe(
            Effect.result,
            Effect.provide(
              createContextLayer({
                databaseLayer,
                tenantOverride: {
                  ...tenant,
                  discountProviders: {
                    esnCard: { config: {}, status: 'enabled' },
                  },
                },
              }),
            ),
          );

          if (questionCount > 25) {
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result))
              expect(result.failure._tag).toBe('EventConflictError');
            expect(findCards).not.toHaveBeenCalled();
            return;
          }
          expect(Result.isSuccess(result)).toBe(true);
          if (Result.isFailure(result))
            throw new Error('Expected actionable event');
          const event = result.success;
          expect(event.registrationOptions[0].questions).toHaveLength(
            questionCount,
          );
          expect(event.registrationOptions[0]).toMatchObject({
            appliedDiscountType: null,
            discountApplied: false,
            effectivePrice: 2000,
            esnCardDiscountedPrice: null,
          });
          expect(findCards).toHaveBeenCalledWith({
            parameters: ['verified', tenant.id, 'esnCard', 'user-1'],
            statement: discountCardsSql,
          });
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
      'events.getOrganizeOverview',
      'events.getPendingReviews',
      'events.getRegistrationAddonFulfillment',
      'events.getRegistrationStatus',
      'events.joinWaitlist',
      'events.purchaseRegistrationAddon',
      'events.redeemRegistrationAddon',
      'events.registerForEvent',
      'events.registrationScanned',
      'events.retryRegistrationCheckout',
      'events.reviewEvent',
      'events.submitForReview',
      'events.undoRegistrationAddonRedemption',
      'events.update',
      'events.updateAnnouncementDiscovery',
      'events.updateGraph',
    ]);
  });
});

describe('organizer overview authorization', () => {
  it.effect('denies a non-organizer before querying attendee data', () =>
    Effect.gen(function* () {
      const { attendeeQuery, databaseLayer } = createEventQueryDatabase();

      const error = yield* eventQueryHandlers['events.getOrganizeOverview'](
        { eventId: 'event-1' },
        createRpcOptions(
          EventsRpcs.EventsGetOrganizeOverview.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      ).pipe(
        Effect.flip,
        Effect.provide(createContextLayer({ databaseLayer })),
      );

      expect(error._tag).toBe('RpcForbiddenError');
      expect(error).toMatchObject({ permission: 'events:organizeAll' });
      expect(attendeeQuery).not.toHaveBeenCalled();
    }),
  );

  it.effect('uses confirmed organizer registration access in both RPCs', () =>
    Effect.gen(function* () {
      const { attendeeQuery, databaseLayer } = createEventQueryDatabase({
        organizerRegistration: true,
      });
      const layer = createContextLayer({ databaseLayer });

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
      const { attendeeQuery, databaseLayer, organizerLookup } =
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
            databaseLayer,
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
        const { aggregateQuery, databaseLayer } = createEventQueryDatabase({
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
              databaseLayer,
              user: createUser(['events:organizeAll']),
            }),
          ),
        );

        expect(overview).toEqual({
          registrationOptions: [],
          stats: { capacity: 6, checkedIn: 1, registered: 3 },
        });
        expect(aggregateQuery).toHaveBeenCalledWith({
          parameters: [tenant.id, 'event-1'],
          statement: optionAggregateSql,
        });
        expect(aggregateQuery).toHaveBeenCalledOnce();
      }),
  );
});
