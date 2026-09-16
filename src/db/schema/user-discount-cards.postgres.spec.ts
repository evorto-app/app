import { describe, expect, it } from '@effect/vitest';
import { eq, inArray, or } from 'drizzle-orm';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import {
  Cause,
  ConfigProvider,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Result,
  Schema,
} from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { isSqlError } from 'effect/unstable/sql/SqlError';

import { Database, type DatabaseClient, databaseLayer } from '../../db';
import {
  Adapters,
  type ProviderAdapter,
  type ValidationResult,
} from '../../server/discounts/providers';
import { discountHandlers } from '../../server/effect/rpc/handlers/discounts.handlers';
import { RpcAccess } from '../../server/effect/rpc/handlers/shared/rpc-access.service';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
} from '../../shared/rpc-contracts/app-rpcs';
import { DiscountsUpsertMyCard } from '../../shared/rpc-contracts/app-rpcs/discounts.rpcs';
import { Tenant } from '../../types/custom/tenant';
import { User } from '../../types/custom/user';
import { createId } from '../create-id';
import {
  eventDiscountOptionOwnerForeignKeyName,
  eventDiscountOptionTypeUniqueConstraintName,
  eventDiscountPriceNonnegativeCheckName,
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  templateDiscountOptionOwnerForeignKeyName,
  templateDiscountOptionTypeUniqueConstraintName,
  templateDiscountPriceNonnegativeCheckName,
  templateRegistrationOptionDiscounts,
  templateRegistrationOptions,
  tenants,
  userDiscountCards,
  userDiscountCardValidityWindowCheckName,
  users,
} from './index';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const testDatabaseLayer = databaseLayer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: {
          DATABASE_TLS_REQUIRED: 'false',
          DATABASE_URL: databaseUrl,
        },
      }),
    ),
  ),
);

type Card = typeof userDiscountCards.$inferInsert;
const withCardFixture = <E, R>(
  run: (fixture: {
    card: Pick<Card, 'identifier' | 'tenantId' | 'type' | 'userId'>;
    database: DatabaseClient;
    otherUserId: string;
  }) => Effect.Effect<void, E, R>,
) =>
  Effect.gen(function* () {
    const database = yield* Database;
    yield* Effect.acquireUseRelease(
      Effect.sync(() => ({
        otherUserId: createId(),
        tenantId: createId(),
        userId: createId(),
      })),
      ({ otherUserId, tenantId, userId }) =>
        Effect.gen(function* () {
          yield* database.insert(tenants).values({
            domain: `${tenantId}.card-window.example`,
            id: tenantId,
            name: 'Card validity window',
          });
          yield* database.insert(users).values(
            [userId, otherUserId].map((id) => ({
              auth0Id: `card-window|${id}`,
              communicationEmail: `${id}@example.com`,
              email: `${id}@example.com`,
              firstName: 'Card',
              id,
              lastName: 'Window',
            })),
          );
          yield* run({
            card: {
              identifier: `card-${userId}`,
              tenantId,
              type: 'esnCard',
              userId,
            },
            database,
            otherUserId,
          });
        }),
      ({ otherUserId, tenantId, userId }) =>
        database
          .delete(userDiscountCards)
          .where(eq(userDiscountCards.tenantId, tenantId))
          .pipe(
            Effect.ensuring(
              database
                .delete(users)
                .where(inArray(users.id, [userId, otherUserId]))
                .pipe(Effect.orDie),
            ),
            Effect.ensuring(
              database
                .delete(tenants)
                .where(eq(tenants.id, tenantId))
                .pipe(Effect.orDie),
            ),
            Effect.orDie,
          ),
    );
  });

const validFrom = new Date('2026-01-01T00:00:00.000Z');
const validTo = new Date('2026-12-31T00:00:00.000Z');
const invalidWindows = [
  { name: 'missing start', validFrom: null, validTo },
  { name: 'missing end', validFrom, validTo: null },
  { name: 'reversed dates', validFrom: validTo, validTo: validFrom },
] satisfies readonly (Pick<Card, 'validFrom' | 'validTo'> & { name: string })[];

describe('persisted discount card validity windows', () => {
  for (const status of ['verified', 'expired'] as const) {
    it.effect(`accepts a complete ordered ${status} card window`, () =>
      withCardFixture(({ card, database }) =>
        Effect.gen(function* () {
          const saved = yield* database
            .insert(userDiscountCards)
            .values({
              ...card,
              status,
              validFrom,
              validTo,
            })
            .returning({
              status: userDiscountCards.status,
              validFrom: userDiscountCards.validFrom,
              validTo: userDiscountCards.validTo,
            });
          expect(saved).toEqual([{ status, validFrom, validTo }]);
        }),
      ).pipe(Effect.provide(testDatabaseLayer)),
    );
    for (const window of invalidWindows) {
      it.effect(`rejects ${window.name} for a ${status} card`, () =>
        withCardFixture(({ card, database }) =>
          Effect.gen(function* () {
            const error = yield* database
              .insert(userDiscountCards)
              .values({
                ...card,
                status,
                validFrom: window.validFrom,
                validTo: window.validTo,
              })
              .pipe(Effect.flip);
            expect(error).toBeInstanceOf(EffectDrizzleQueryError);
            if (!Cause.isCause(error.cause)) {
              throw new Error('Expected the Drizzle Effect cause');
            }
            const sqlErrors = error.cause.reasons.flatMap((reason) =>
              Cause.isFailReason(reason) && isSqlError(reason.error)
                ? [reason.error]
                : [],
            );
            expect(sqlErrors).toHaveLength(1);
            expect(sqlErrors[0]?.reason).toMatchObject({
              _tag: 'ConstraintError',
              cause: {
                code: '23514',
                constraint: userDiscountCardValidityWindowCheckName,
              },
            });
          }),
        ).pipe(Effect.provide(testDatabaseLayer)),
      );
    }
  }
  for (const status of ['invalid', 'unverified'] as const) {
    it.effect(`allows an unvalidated window for a ${status} card`, () =>
      withCardFixture(({ card, database }) =>
        Effect.gen(function* () {
          const saved = yield* database
            .insert(userDiscountCards)
            .values({ ...card, status })
            .returning({
              status: userDiscountCards.status,
              validFrom: userDiscountCards.validFrom,
              validTo: userDiscountCards.validTo,
            });
          expect(saved).toEqual([{ status, validFrom: null, validTo: null }]);
        }),
      ).pipe(Effect.provide(testDatabaseLayer)),
    );
  }
});

const withEsnCardAdapter = <A, E, R>(
  validate: ProviderAdapter['validate'],
  run: Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const original = Adapters.esnCard;
      Adapters.esnCard = { validate };
      return original;
    }),
    () => run,
    (original) =>
      Effect.sync(() => {
        Adapters.esnCard = original;
      }),
  );

const saveCard = (tenant: Tenant, userId: string, identifier: string) =>
  discountHandlers['discounts.upsertMyCard'](
    { identifier, type: 'esnCard' },
    {
      client: new Rpc.ServerClient(1),
      headers: Headers.empty,
      requestId: RpcMessage.RequestId(1),
      rpc: DiscountsUpsertMyCard.middleware(RpcRequestContextMiddleware),
    },
  ).pipe(
    Effect.provide(RpcAccess.Default),
    Effect.provideService(RpcRequestContext, {
      authData: {},
      authenticated: true,
      permissions: [],
      platformAuthority: null,
      tenant,
      user: Schema.decodeUnknownSync(User)({
        attributes: [],
        auth0Id: `card-window|${userId}`,
        communicationEmail: `${userId}@example.com`,
        email: `${userId}@example.com`,
        firstName: 'Card',
        id: userId,
        lastName: 'Window',
        permissions: [],
        roleIds: [],
      }),
      userAssigned: true,
    }),
  );

describe('concurrent discount card saves', () => {
  for (const scenario of [
    'existing identifier',
    'new identifier',
    'new user slot',
    'same identifier and user',
  ] as const) {
    it.live(
      `keeps the winning card and returns a typed conflict for a ${scenario} race`,
      () =>
        withCardFixture(({ card, database, otherUserId }) =>
          Effect.gen(function* () {
            yield* database
              .update(tenants)
              .set({
                discountProviders: {
                  esnCard: { config: {}, status: 'enabled' },
                },
              })
              .where(eq(tenants.id, card.tenantId));
            const tenant = Schema.decodeUnknownSync(Tenant)(
              yield* database.query.tenants.findFirst({
                where: { id: card.tenantId },
              }),
            );
            if (scenario === 'existing identifier') {
              yield* database.insert(userDiscountCards).values({
                ...card,
                identifier: 'ORIGINAL',
                status: 'unverified',
              });
            }
            const before = yield* database.query.userDiscountCards.findMany({
              where: { tenantId: card.tenantId },
            });
            const started = yield* Deferred.make<undefined>();
            const release = yield* Deferred.make<undefined>();
            let validationCalls = 0;
            const result: ValidationResult = {
              metadata: { provider: 'synthetic' },
              status: 'verified',
              validFrom,
              validTo,
            };
            const validate: ProviderAdapter['validate'] = () => {
              validationCalls += 1;
              if (validationCalls === 1) {
                return Effect.runPromise(
                  Deferred.succeed(started, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                    Effect.as(result),
                  ),
                );
              }
              return Promise.resolve(result);
            };
            yield* withEsnCardAdapter(
              validate,
              Effect.gen(function* () {
                const waitingSave = yield* saveCard(
                  tenant,
                  card.userId,
                  'TARGET',
                ).pipe(Effect.result, Effect.forkScoped);
                yield* Effect.gen(function* () {
                  // The first request has finished both reads and is paused in provider validation.
                  yield* Deferred.await(started);
                  const sameUser =
                    scenario === 'new user slot' ||
                    scenario === 'same identifier and user';
                  const winningUser = sameUser ? card.userId : otherUserId;
                  const winningIdentifier =
                    scenario === 'new user slot' ? 'WINNER' : 'TARGET';
                  const winner = yield* saveCard(
                    tenant,
                    winningUser,
                    winningIdentifier,
                  );
                  yield* Deferred.succeed(release, undefined);
                  const loser = yield* Fiber.join(waitingSave);
                  expect(Result.isFailure(loser)).toBe(true);
                  if (!Result.isFailure(loser)) return;
                  expect(loser.failure).toMatchObject({
                    _tag: sameUser
                      ? 'DiscountCardChangedError'
                      : 'DiscountCardConflictError',
                  });
                  const after =
                    yield* database.query.userDiscountCards.findMany({
                      where: { tenantId: card.tenantId },
                    });
                  expect(after).toHaveLength(before.length + 1);
                  expect(
                    after.find((row) => row.id === winner.id),
                  ).toMatchObject({
                    identifier: winningIdentifier,
                    metadata: { provider: 'synthetic' },
                    status: 'verified',
                    userId: winningUser,
                  });
                  if (scenario === 'existing identifier') {
                    expect(
                      after.find((row) => row.userId === card.userId),
                    ).toEqual(before[0]);
                  }
                  expect(validationCalls).toBe(2);
                }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
              }).pipe(Effect.scoped),
            );
          }),
        ).pipe(Effect.provide(testDatabaseLayer)),
    );
  }
});

interface DiscountOwnerIds {
  categoryId: string;
  eventId: string;
  eventOptionId: string;
  templateId: string;
  templateOptionId: string;
  tenantId: string;
  userId: string;
}

const makeDiscountOwnerIds = (tenantId: string): DiscountOwnerIds => ({
  categoryId: createId(),
  eventId: createId(),
  eventOptionId: createId(),
  templateId: createId(),
  templateOptionId: createId(),
  tenantId,
  userId: createId(),
});

const makeDiscountOwnershipFixture = () => {
  const tenantId = createId();
  const otherTenantId = createId();
  return {
    first: makeDiscountOwnerIds(tenantId),
    otherTenant: makeDiscountOwnerIds(otherTenantId),
    sameTenant: makeDiscountOwnerIds(tenantId),
    tenantIds: [tenantId, otherTenantId],
  };
};

type DiscountOwnershipFixture = ReturnType<typeof makeDiscountOwnershipFixture>;

const seedDiscountOwnershipFixture = Effect.fn('seedDiscountOwnershipFixture')(
  function* (database: DatabaseClient, fixture: DiscountOwnershipFixture) {
    const owners = [fixture.first, fixture.sameTenant, fixture.otherTenant];
    yield* database.insert(tenants).values(
      fixture.tenantIds.map(
        (id) =>
          ({
            domain: `${id}.discount-owner.example`,
            id,
            name: 'Discount ownership tenant',
          }) satisfies typeof tenants.$inferInsert,
      ),
    );
    yield* database.insert(users).values(
      owners.map(
        (owner) =>
          ({
            auth0Id: `discount-owner|${owner.userId}`,
            communicationEmail: `${owner.userId}@example.com`,
            email: `${owner.userId}@example.com`,
            firstName: 'Discount',
            id: owner.userId,
            lastName: 'Owner',
          }) satisfies typeof users.$inferInsert,
      ),
    );
    yield* database.insert(eventTemplateCategories).values(
      owners.map(
        (owner) =>
          ({
            icon: { iconColor: 0, iconName: 'circle' },
            id: owner.categoryId,
            tenantId: owner.tenantId,
            title: 'Discount ownership category',
          }) satisfies typeof eventTemplateCategories.$inferInsert,
      ),
    );
    yield* database.insert(eventTemplates).values(
      owners.map(
        (owner) =>
          ({
            categoryId: owner.categoryId,
            description: 'Discount ownership fixture',
            icon: { iconColor: 0, iconName: 'circle' },
            id: owner.templateId,
            tenantId: owner.tenantId,
            title: 'Discount ownership template',
          }) satisfies typeof eventTemplates.$inferInsert,
      ),
    );
    yield* database.insert(templateRegistrationOptions).values(
      owners.map(
        (owner) =>
          ({
            closeRegistrationOffset: 0,
            id: owner.templateOptionId,
            isPaid: true,
            openRegistrationOffset: 24,
            organizingRegistration: false,
            price: 1000,
            registrationMode: 'fcfs',
            spots: 10,
            templateId: owner.templateId,
            title: 'Discount ownership template option',
          }) satisfies typeof templateRegistrationOptions.$inferInsert,
      ),
    );
    yield* database.insert(eventInstances).values(
      owners.map(
        (owner) =>
          ({
            creatorId: owner.userId,
            description: 'Discount ownership fixture',
            end: new Date('2030-06-02T14:00:00.000Z'),
            icon: { iconColor: 0, iconName: 'circle' },
            id: owner.eventId,
            start: new Date('2030-06-02T12:00:00.000Z'),
            status: 'DRAFT',
            templateId: owner.templateId,
            tenantId: owner.tenantId,
            title: 'Discount ownership event',
          }) satisfies typeof eventInstances.$inferInsert,
      ),
    );
    yield* database.insert(eventRegistrationOptions).values(
      owners.map(
        (owner) =>
          ({
            closeRegistrationTime: new Date('2030-06-02T11:00:00.000Z'),
            eventId: owner.eventId,
            id: owner.eventOptionId,
            isPaid: true,
            openRegistrationTime: new Date('2030-06-01T12:00:00.000Z'),
            organizingRegistration: false,
            price: 1000,
            registrationMode: 'fcfs',
            spots: 10,
            title: 'Discount ownership event option',
          }) satisfies typeof eventRegistrationOptions.$inferInsert,
      ),
    );
  },
);

const cleanDiscountOwnershipFixture = (
  database: DatabaseClient,
  fixture: DiscountOwnershipFixture,
) => {
  const owners = [fixture.first, fixture.sameTenant, fixture.otherTenant];
  const eventIds = owners.map((owner) => owner.eventId);
  const eventOptionIds = owners.map((owner) => owner.eventOptionId);
  const templateIds = owners.map((owner) => owner.templateId);
  const templateOptionIds = owners.map((owner) => owner.templateOptionId);
  return Effect.void.pipe(
    Effect.ensuring(
      database
        .delete(eventRegistrations)
        .where(inArray(eventRegistrations.eventId, eventIds))
        .pipe(Effect.orDie),
    ),
    Effect.ensuring(
      database
        .delete(eventRegistrationOptionDiscounts)
        .where(
          or(
            inArray(eventRegistrationOptionDiscounts.eventId, eventIds),
            inArray(
              eventRegistrationOptionDiscounts.registrationOptionId,
              eventOptionIds,
            ),
          ),
        )
        .pipe(Effect.orDie),
    ),
    Effect.ensuring(
      database
        .delete(templateRegistrationOptionDiscounts)
        .where(
          or(
            inArray(
              templateRegistrationOptionDiscounts.templateId,
              templateIds,
            ),
            inArray(
              templateRegistrationOptionDiscounts.registrationOptionId,
              templateOptionIds,
            ),
          ),
        )
        .pipe(Effect.orDie),
    ),
    Effect.ensuring(
      database
        .delete(eventRegistrationOptions)
        .where(inArray(eventRegistrationOptions.id, eventOptionIds))
        .pipe(Effect.orDie),
    ),
    Effect.ensuring(
      database
        .delete(eventInstances)
        .where(inArray(eventInstances.id, eventIds))
        .pipe(Effect.orDie),
    ),
    Effect.ensuring(
      database
        .delete(templateRegistrationOptions)
        .where(inArray(templateRegistrationOptions.id, templateOptionIds))
        .pipe(Effect.orDie),
    ),
    Effect.ensuring(
      database
        .delete(eventTemplates)
        .where(inArray(eventTemplates.id, templateIds))
        .pipe(Effect.orDie),
    ),
    Effect.ensuring(
      database
        .delete(eventTemplateCategories)
        .where(
          inArray(
            eventTemplateCategories.id,
            owners.map((owner) => owner.categoryId),
          ),
        )
        .pipe(Effect.orDie),
    ),
    Effect.ensuring(
      database
        .delete(users)
        .where(
          inArray(
            users.id,
            owners.map((owner) => owner.userId),
          ),
        )
        .pipe(Effect.orDie),
    ),
    Effect.ensuring(
      database
        .delete(tenants)
        .where(inArray(tenants.id, fixture.tenantIds))
        .pipe(Effect.orDie),
    ),
  );
};

const withDiscountOwnershipFixture = <E, R>(
  run: (
    fixture: DiscountOwnershipFixture & {
      database: DatabaseClient;
    },
  ) => Effect.Effect<void, E, R>,
) =>
  Effect.gen(function* () {
    const database = yield* Database;
    yield* Effect.acquireUseRelease(
      Effect.sync(makeDiscountOwnershipFixture),
      (fixture) =>
        Effect.gen(function* () {
          yield* seedDiscountOwnershipFixture(database, fixture);
          yield* run({ ...fixture, database });
        }),
      (fixture) => cleanDiscountOwnershipFixture(database, fixture),
    );
  });

const expectDiscountConstraintViolation = Effect.fn(
  'expectDiscountConstraintViolation',
)(function* <A, E, R>(
  operation: Effect.Effect<A, E, R>,
  code: '23503' | '23505' | '23514',
  constraint: string,
) {
  const error = yield* operation.pipe(Effect.flip);
  expect(error).toBeInstanceOf(EffectDrizzleQueryError);
  if (
    !(error instanceof EffectDrizzleQueryError) ||
    !Cause.isCause(error.cause)
  ) {
    return yield* Effect.die(
      new Error('Expected a Drizzle query failure with an Effect cause'),
    );
  }
  const sqlErrors = error.cause.reasons.flatMap((reason) =>
    Cause.isFailReason(reason) && isSqlError(reason.error)
      ? [reason.error]
      : [],
  );
  expect(sqlErrors).toHaveLength(1);
  expect(sqlErrors[0]?.reason).toMatchObject({
    _tag: code === '23505' ? 'UniqueViolation' : 'ConstraintError',
    cause: { code, constraint },
  });
});

interface DiscountWrite {
  discountedPrice: number;
  ownerId: string;
  registrationOptionId: string;
}

const discountTables = [
  {
    label: 'event',
    optionId: (owner: DiscountOwnerIds) => owner.eventOptionId,
    ownerForeignKey: eventDiscountOptionOwnerForeignKeyName,
    ownerId: (owner: DiscountOwnerIds) => owner.eventId,
    priceCheck: eventDiscountPriceNonnegativeCheckName,
    typeUnique: eventDiscountOptionTypeUniqueConstraintName,
    write: (database: DatabaseClient, discount: DiscountWrite) =>
      database
        .insert(eventRegistrationOptionDiscounts)
        .values({
          discountedPrice: discount.discountedPrice,
          discountType: 'esnCard',
          eventId: discount.ownerId,
          registrationOptionId: discount.registrationOptionId,
        })
        .returning({
          discountedPrice: eventRegistrationOptionDiscounts.discountedPrice,
          discountType: eventRegistrationOptionDiscounts.discountType,
          ownerId: eventRegistrationOptionDiscounts.eventId,
          registrationOptionId:
            eventRegistrationOptionDiscounts.registrationOptionId,
        }),
  },
  {
    label: 'template',
    optionId: (owner: DiscountOwnerIds) => owner.templateOptionId,
    ownerForeignKey: templateDiscountOptionOwnerForeignKeyName,
    ownerId: (owner: DiscountOwnerIds) => owner.templateId,
    priceCheck: templateDiscountPriceNonnegativeCheckName,
    typeUnique: templateDiscountOptionTypeUniqueConstraintName,
    write: (database: DatabaseClient, discount: DiscountWrite) =>
      database
        .insert(templateRegistrationOptionDiscounts)
        .values({
          discountedPrice: discount.discountedPrice,
          discountType: 'esnCard',
          registrationOptionId: discount.registrationOptionId,
          templateId: discount.ownerId,
        })
        .returning({
          discountedPrice: templateRegistrationOptionDiscounts.discountedPrice,
          discountType: templateRegistrationOptionDiscounts.discountType,
          ownerId: templateRegistrationOptionDiscounts.templateId,
          registrationOptionId:
            templateRegistrationOptionDiscounts.registrationOptionId,
        }),
  },
];

for (const table of discountTables) {
  describe(`${table.label} registration option discount integrity`, () => {
    for (const discountedPrice of [0, 500]) {
      it.effect(
        `accepts price ${discountedPrice} for valid option-owner pairs in both tenants`,
        () =>
          withDiscountOwnershipFixture((fixture) =>
            Effect.gen(function* () {
              for (const owner of [
                fixture.first,
                fixture.sameTenant,
                fixture.otherTenant,
              ]) {
                const discount = {
                  discountedPrice,
                  ownerId: table.ownerId(owner),
                  registrationOptionId: table.optionId(owner),
                };
                const saved = yield* table.write(fixture.database, discount);
                expect(saved).toEqual([
                  { ...discount, discountType: 'esnCard' },
                ]);
              }
            }),
          ).pipe(Effect.provide(testDatabaseLayer)),
      );
    }
    for (const mismatch of [
      {
        label: 'same-tenant',
        owner: (fixture: DiscountOwnershipFixture) => fixture.sameTenant,
      },
      {
        label: 'cross-tenant',
        owner: (fixture: DiscountOwnershipFixture) => fixture.otherTenant,
      },
    ]) {
      it.effect(
        `rejects a ${mismatch.label} owner mismatch using the composite foreign key`,
        () =>
          withDiscountOwnershipFixture((fixture) =>
            expectDiscountConstraintViolation(
              table.write(fixture.database, {
                discountedPrice: 500,
                ownerId: table.ownerId(mismatch.owner(fixture)),
                registrationOptionId: table.optionId(fixture.first),
              }),
              '23503',
              table.ownerForeignKey,
            ),
          ).pipe(Effect.provide(testDatabaseLayer)),
      );
    }
    it.effect('rejects a duplicate discount type for the same option', () =>
      withDiscountOwnershipFixture((fixture) =>
        Effect.gen(function* () {
          const discount = {
            discountedPrice: 500,
            ownerId: table.ownerId(fixture.first),
            registrationOptionId: table.optionId(fixture.first),
          };
          yield* table.write(fixture.database, discount);
          yield* expectDiscountConstraintViolation(
            table.write(fixture.database, {
              ...discount,
              discountedPrice: 600,
            }),
            '23505',
            table.typeUnique,
          );
        }),
      ).pipe(Effect.provide(testDatabaseLayer)),
    );
    it.effect('rejects a negative discounted price', () =>
      withDiscountOwnershipFixture((fixture) =>
        expectDiscountConstraintViolation(
          table.write(fixture.database, {
            discountedPrice: -1,
            ownerId: table.ownerId(fixture.first),
            registrationOptionId: table.optionId(fixture.first),
          }),
          '23514',
          table.priceCheck,
        ),
      ).pipe(Effect.provide(testDatabaseLayer)),
    );
  });
}

type RegistrationPriceSnapshot = Pick<
  typeof eventRegistrations.$inferInsert,
  | 'appliedDiscountedPrice'
  | 'appliedDiscountType'
  | 'basePriceAtRegistration'
  | 'discountAmount'
>;

const validPriceSnapshots = [
  {
    label: 'free',
    snapshot: {
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: 0,
      discountAmount: 0,
    },
  },
  {
    label: 'undiscounted paid',
    snapshot: {
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: 1000,
      discountAmount: 0,
    },
  },
  {
    label: 'fully discounted',
    snapshot: {
      appliedDiscountedPrice: 0,
      appliedDiscountType: 'esnCard',
      basePriceAtRegistration: 1000,
      discountAmount: 1000,
    },
  },
  {
    label: 'partially discounted',
    snapshot: {
      appliedDiscountedPrice: 800,
      appliedDiscountType: 'esnCard',
      basePriceAtRegistration: 1000,
      discountAmount: 200,
    },
  },
] satisfies readonly { label: string; snapshot: RegistrationPriceSnapshot }[];

const invalidPriceSnapshots = [
  {
    constraint: 'event_registrations_price_snapshot_complete',
    label: 'a base without a discount amount',
    snapshot: { basePriceAtRegistration: 1000 },
    status: 'PENDING',
  },
  {
    constraint: 'event_registrations_price_snapshot_complete',
    label: 'a discount amount without a base',
    snapshot: { discountAmount: 0 },
    status: 'PENDING',
  },
  {
    constraint: 'event_registrations_confirmed_price_snapshot',
    label: 'an unpriced confirmed registration',
    snapshot: {},
    status: 'CONFIRMED',
  },
  {
    constraint: 'event_registrations_price_snapshot_consistent',
    label: 'a negative base price',
    snapshot: { basePriceAtRegistration: -1, discountAmount: 0 },
    status: 'PENDING',
  },
  {
    constraint: 'event_registrations_price_snapshot_consistent',
    label: 'a negative discount amount',
    snapshot: { basePriceAtRegistration: 1000, discountAmount: -1 },
    status: 'PENDING',
  },
  {
    constraint: 'event_registrations_price_snapshot_consistent',
    label: 'a discount amount without an applied discount',
    snapshot: { basePriceAtRegistration: 1000, discountAmount: 100 },
    status: 'PENDING',
  },
  {
    constraint: 'event_registrations_price_snapshot_consistent',
    label: 'a discounted price above the base',
    snapshot: {
      appliedDiscountedPrice: 1100,
      appliedDiscountType: 'esnCard',
      basePriceAtRegistration: 1000,
      discountAmount: 0,
    },
    status: 'PENDING',
  },
  {
    constraint: 'event_registrations_price_snapshot_consistent',
    label: 'a mismatched discount amount',
    snapshot: {
      appliedDiscountedPrice: 800,
      appliedDiscountType: 'esnCard',
      basePriceAtRegistration: 1000,
      discountAmount: 100,
    },
    status: 'PENDING',
  },
  ...(['PENDING', 'CONFIRMED'] as const).map((status) => ({
    constraint: 'event_registrations_price_snapshot_consistent',
    label: `a missing discounted price on a ${status.toLowerCase()} registration`,
    snapshot: {
      appliedDiscountedPrice: null,
      appliedDiscountType: 'esnCard' as const,
      basePriceAtRegistration: 1000,
      discountAmount: 1000,
    },
    status,
  })),
] satisfies readonly {
  constraint: string;
  label: string;
  snapshot: RegistrationPriceSnapshot;
  status: 'CONFIRMED' | 'PENDING';
}[];

describe('persisted registration price snapshots', () => {
  for (const scenario of invalidPriceSnapshots) {
    it.effect(`rejects ${scenario.label}`, () =>
      withDiscountOwnershipFixture(({ database, first }) =>
        expectDiscountConstraintViolation(
          database.insert(eventRegistrations).values({
            ...scenario.snapshot,
            eventId: first.eventId,
            id: createId(),
            registrationOptionId: first.eventOptionId,
            status: scenario.status,
            tenantId: first.tenantId,
            userId: first.userId,
          }),
          '23514',
          scenario.constraint,
        ),
      ).pipe(Effect.provide(testDatabaseLayer)),
    );
  }
  for (const scenario of validPriceSnapshots) {
    it.effect(`preserves a complete ${scenario.label} confirmed snapshot`, () =>
      withDiscountOwnershipFixture(({ database, first }) =>
        Effect.gen(function* () {
          const saved = yield* database
            .insert(eventRegistrations)
            .values({
              ...scenario.snapshot,
              eventId: first.eventId,
              registrationOptionId: first.eventOptionId,
              status: 'CONFIRMED',
              tenantId: first.tenantId,
              userId: first.userId,
            })
            .returning({
              appliedDiscountedPrice: eventRegistrations.appliedDiscountedPrice,
              appliedDiscountType: eventRegistrations.appliedDiscountType,
              basePriceAtRegistration:
                eventRegistrations.basePriceAtRegistration,
              discountAmount: eventRegistrations.discountAmount,
            });
          expect(saved).toEqual([scenario.snapshot]);
        }),
      ).pipe(Effect.provide(testDatabaseLayer)),
    );
  }
  it.effect('allows an unpriced pending application before approval', () =>
    withDiscountOwnershipFixture(({ database, first }) =>
      Effect.gen(function* () {
        const saved = yield* database
          .insert(eventRegistrations)
          .values({
            eventId: first.eventId,
            registrationOptionId: first.eventOptionId,
            status: 'PENDING',
            tenantId: first.tenantId,
            userId: first.userId,
          })
          .returning({
            appliedDiscountedPrice: eventRegistrations.appliedDiscountedPrice,
            appliedDiscountType: eventRegistrations.appliedDiscountType,
            basePriceAtRegistration: eventRegistrations.basePriceAtRegistration,
            discountAmount: eventRegistrations.discountAmount,
          });
        expect(saved).toEqual([
          {
            appliedDiscountedPrice: null,
            appliedDiscountType: null,
            basePriceAtRegistration: null,
            discountAmount: null,
          },
        ]);
      }),
    ).pipe(Effect.provide(testDatabaseLayer)),
  );
});
