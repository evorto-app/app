import { createId } from '@db/create-id';
import { Database, databaseLayer } from '@db/index';
import {
  eventTemplateCategories,
  eventTemplates,
  templateRegistrationOptionDiscounts,
  templateRegistrationOptions,
  tenants,
  tenantStripeTaxRates,
  users,
  usersToTenants,
} from '@db/schema';
import { expect, layer } from '@effect/vitest';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '@shared/rpc-contracts/app-rpcs';
import { EventsCreate } from '@shared/rpc-contracts/app-rpcs/events.rpcs';
import { TaxRatesListActive } from '@shared/rpc-contracts/app-rpcs/tax-rates.rpcs';
import { eq, sql } from 'drizzle-orm';
import { Cause, ConfigProvider, Effect, Exit, Layer, Schema } from 'effect';
import { Headers } from 'effect/unstable/http';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';

import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { Tenant } from '../../../../../types/custom/tenant';
import { eventLifecycleHandlers } from '../events/events-lifecycle.handlers';
import { RpcAccess } from '../shared/rpc-access.service';
import { taxRateHandlers } from '../tax-rates.handlers';
import { platformEventHandlers } from './platform-events.handlers';

const requestOptions = () => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
});

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

const testLayer = Layer.mergeAll(
  databaseLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: { DATABASE_TLS_REQUIRED: 'false', DATABASE_URL: databaseUrl },
        }),
      ),
    ),
  ),
  RpcAccess.Default,
);

class FixtureRollback extends Schema.TaggedError<FixtureRollback>()(
  'FixtureRollback',
  {},
) {}

layer(testLayer)(
  'platform event creation with stored ESNcard discounts',
  (it) => {
    it.effect(
      'offers only usable inclusive tax rates from the target account',
      () =>
        Effect.gen(function* () {
          const database = yield* Database;
          const tenantId = createId();
          const otherTenantId = createId();
          const stripeAccountId = `acct_${tenantId}`;
          yield* database
            .transaction((transaction) =>
              Effect.gen(function* () {
                const [tenantRecord] = yield* transaction
                  .insert(tenants)
                  .values([
                    {
                      domain: `${tenantId}.form-options.example`,
                      id: tenantId,
                      name: 'Form options',
                      stripeAccountId,
                    },
                    {
                      domain: `${otherTenantId}.form-options.example`,
                      id: otherTenantId,
                      name: 'Other organization',
                      stripeAccountId,
                    },
                  ])
                  .returning();
                if (!tenantRecord) throw new Error('Missing fixture tenant');
                const tenant =
                  yield* Schema.decodeUnknownEffect(Tenant)(tenantRecord);
                const rates = [
                  {
                    displayName: 'Standard',
                    key: 'standard',
                    percentage: '19',
                  },
                  { displayName: 'Zero', key: 'zero', percentage: '0' },
                  { displayName: 'Missing', key: 'null', percentage: null },
                  { displayName: 'Empty', key: 'empty', percentage: '' },
                  {
                    displayName: 'Whitespace',
                    key: 'whitespace',
                    percentage: ' \t\n ',
                  },
                ];
                yield* transaction.insert(tenantStripeTaxRates).values([
                  ...rates.map((rate) => ({
                    active: true,
                    displayName: rate.displayName,
                    inclusive: true,
                    percentage: rate.percentage,
                    stripeAccountId,
                    stripeTaxRateId: `txr_${rate.key}_${tenantId}`,
                    tenantId,
                  })),
                  {
                    active: false,
                    inclusive: true,
                    percentage: '19',
                    stripeAccountId,
                    stripeTaxRateId: `txr_inactive_${tenantId}`,
                    tenantId,
                  },
                  {
                    active: true,
                    inclusive: false,
                    percentage: '19',
                    stripeAccountId,
                    stripeTaxRateId: `txr_exclusive_${tenantId}`,
                    tenantId,
                  },
                  {
                    active: true,
                    inclusive: true,
                    percentage: '19',
                    stripeAccountId: `acct_other_${tenantId}`,
                    stripeTaxRateId: `txr_account_${tenantId}`,
                    tenantId,
                  },
                  {
                    active: true,
                    inclusive: true,
                    percentage: '19',
                    stripeAccountId,
                    stripeTaxRateId: `txr_tenant_${tenantId}`,
                    tenantId: otherTenantId,
                  },
                ]);
                const options = yield* platformEventHandlers[
                  'platform.events.formOptions'
                ]({ targetTenantId: tenantId }, undefined).pipe(
                  Effect.provideService(
                    Database,
                    Object.assign(transaction, { $client: database.$client }),
                  ),
                  Effect.provideService(RpcRequestContext, {
                    authData: {},
                    authenticated: true,
                    permissions: [],
                    platformAuthority: PlatformAdministratorAuthority.make({
                      actorEmail: 'platform@example.org',
                      actorId: 'auth0|platform-event-creation',
                      kind: 'platformAdministrator',
                    }),
                    tenant,
                    user: null,
                    userAssigned: false,
                  }),
                );
                const catalog = yield* taxRateHandlers['taxRates.listActive'](
                  undefined,
                  {
                    ...requestOptions(),
                    rpc: TaxRatesListActive.middleware(
                      RpcRequestContextMiddleware,
                    ),
                  },
                ).pipe(
                  Effect.provideService(
                    Database,
                    Object.assign(transaction, { $client: database.$client }),
                  ),
                  Effect.provideService(RpcRequestContext, {
                    authData: {},
                    authenticated: false,
                    permissions: [],
                    tenant,
                    user: null,
                    userAssigned: false,
                  }),
                );
                expect(catalog.map((rate) => rate.stripeTaxRateId)).toEqual([
                  `txr_standard_${tenantId}`,
                  `txr_zero_${tenantId}`,
                ]);
                expect(options.taxRates).toEqual([
                  {
                    displayName: 'Standard',
                    percentage: '19',
                    stripeTaxRateId: `txr_standard_${tenantId}`,
                  },
                  {
                    displayName: 'Zero',
                    percentage: '0',
                    stripeTaxRateId: `txr_zero_${tenantId}`,
                  },
                ]);
                return yield* Effect.fail(new FixtureRollback({}));
              }),
            )
            .pipe(Effect.catchTag('FixtureRollback', () => Effect.void));
          expect(
            yield* database.query.tenants.findFirst({
              where: { id: tenantId },
            }),
          ).toBeUndefined();
          expect(
            yield* database.query.tenants.findFirst({
              where: { id: otherTenantId },
            }),
          ).toBeUndefined();
        }),
    );

    for (const providerStatus of ['disabled', 'enabled'] as const) {
      it.effect(
        `creates paid events atomically through tenant and platform handlers while the provider is ${providerStatus}`,
        () =>
          Effect.gen(function* () {
            const database = yield* Database;
            const tenantId = createId();
            const creatorId = createId();
            const categoryId = createId();
            const templateId = createId();
            const optionId = createId();
            const stripeAccountId = `acct_${tenantId}`;
            const stripeTaxRateId = `txr_${tenantId}`;
            yield* database
              .transaction((transaction) =>
                Effect.gen(function* () {
                  const [tenantRecord] = yield* transaction
                    .insert(tenants)
                    .values({
                      discountProviders: {
                        esnCard: { config: {}, status: 'enabled' },
                      },
                      domain: `${tenantId}.platform-create.example`,
                      id: tenantId,
                      name: 'Platform event creation',
                      stripeAccountId,
                    })
                    .returning();
                  if (!tenantRecord) throw new Error('Missing fixture tenant');
                  const originalTenant =
                    yield* Schema.decodeUnknownEffect(Tenant)(tenantRecord);
                  yield* transaction.insert(users).values({
                    auth0Id: `auth0|${creatorId}`,
                    communicationEmail: `${creatorId}@example.org`,
                    email: `${creatorId}@example.org`,
                    firstName: 'Event',
                    id: creatorId,
                    lastName: 'Creator',
                  });
                  yield* transaction.insert(usersToTenants).values({
                    tenantId,
                    userId: creatorId,
                  });
                  yield* transaction.insert(eventTemplateCategories).values({
                    icon: { iconColor: 0, iconName: 'calendar:fas' },
                    id: categoryId,
                    tenantId,
                    title: 'Activities',
                  });
                  yield* transaction.insert(eventTemplates).values({
                    categoryId,
                    description: '<p>Template with an ESNcard discount</p>',
                    icon: { iconColor: 0, iconName: 'calendar:fas' },
                    id: templateId,
                    simpleModeEnabled: false,
                    tenantId,
                    title: 'Discounted activity',
                  });
                  yield* transaction.insert(tenantStripeTaxRates).values({
                    active: true,
                    inclusive: true,
                    percentage: '19',
                    stripeAccountId,
                    stripeTaxRateId,
                    tenantId,
                  });
                  yield* transaction
                    .insert(templateRegistrationOptions)
                    .values({
                      closeRegistrationOffset: 1,
                      id: optionId,
                      isPaid: true,
                      openRegistrationOffset: 168,
                      organizingRegistration: false,
                      price: 1000,
                      spots: 10,
                      stripeTaxRateId,
                      templateId,
                      title: 'Participant',
                    });
                  yield* transaction
                    .insert(templateRegistrationOptionDiscounts)
                    .values({
                      discountedPrice: 750,
                      discountType: 'esnCard',
                      registrationOptionId: optionId,
                      templateId,
                    });
                  yield* transaction
                    .update(tenants)
                    .set({
                      discountProviders: {
                        esnCard: { config: {}, status: providerStatus },
                      },
                    })
                    .where(eq(tenants.id, tenantId));

                  const context = {
                    authData: {},
                    authenticated: true,
                    permissions: [],
                    platformAuthority: PlatformAdministratorAuthority.make({
                      actorEmail: 'platform@example.org',
                      actorId: 'auth0|platform-event-creation',
                      kind: 'platformAdministrator',
                    }),
                    tenant: originalTenant,
                    user: null,
                    userAssigned: false,
                  } satisfies RpcRequestContextShape;
                  const permissions = ['events:create'] as const;
                  const ordinaryContext = {
                    authData: { sub: `auth0|${creatorId}` },
                    authenticated: true,
                    permissions,
                    tenant: {
                      ...originalTenant,
                      discountProviders: {
                        esnCard: { config: {}, status: providerStatus },
                      },
                    },
                    user: {
                      auth0Id: `auth0|${creatorId}`,
                      communicationEmail: `${creatorId}@example.org`,
                      email: `${creatorId}@example.org`,
                      firstName: 'Event',
                      homeTenantId: undefined,
                      homeTenantName: undefined,
                      iban: undefined,
                      id: creatorId,
                      lastName: 'Creator',
                      paypalEmail: undefined,
                      permissions,
                      roleIds: [],
                    },
                    userAssigned: true,
                  } satisfies RpcRequestContextShape;
                  for (const author of ['tenant', 'platform'] as const) {
                    const optionTitle = `Participant ${author} ${tenantId}`;
                    yield* transaction
                      .update(templateRegistrationOptions)
                      .set({ title: optionTitle })
                      .where(eq(templateRegistrationOptions.id, optionId));
                    const create = () =>
                      (author === 'platform'
                        ? platformEventHandlers['platform.events.create'](
                            {
                              creatorUserId: creatorId,
                              description:
                                '<p>An event created from a saved template</p>',
                              end: '2099-07-10T14:00:00.000Z',
                              reason:
                                'Create an event from the existing template',
                              start: '2099-07-10T12:00:00.000Z',
                              targetTenantId: tenantId,
                              templateId,
                              title: 'Created activity',
                            },
                            undefined,
                          ).pipe(
                            Effect.provideService(RpcRequestContext, context),
                            Effect.map(({ id }) => ({ id })),
                          )
                        : eventLifecycleHandlers['events.create'](
                            {
                              description:
                                '<p>An event created from a saved template</p>',
                              end: '2099-07-10T14:00:00.000Z',
                              icon: { iconColor: 0, iconName: 'calendar:fas' },
                              registrationOptions: [
                                {
                                  cancellationDeadlineHoursBeforeStart: null,
                                  closeRegistrationTime:
                                    '2099-07-10T11:00:00.000Z',
                                  description: null,
                                  esnCardDiscountedPrice:
                                    providerStatus === 'enabled' ? 750 : null,
                                  isPaid: true,
                                  openRegistrationTime:
                                    '2099-07-01T12:00:00.000Z',
                                  organizingRegistration: false,
                                  price: 1000,
                                  refundFeesOnCancellation: null,
                                  registeredDescription: null,
                                  registrationMode: 'fcfs',
                                  roleIds: [],
                                  sourceTemplateRegistrationOptionId: optionId,
                                  spots: 10,
                                  stripeTaxRateId,
                                  title: optionTitle,
                                  transferDeadlineHoursBeforeStart: null,
                                },
                              ],
                              start: '2099-07-10T12:00:00.000Z',
                              templateId,
                              title: 'Created activity',
                            },
                            {
                              ...requestOptions(),
                              rpc: EventsCreate.middleware(
                                RpcRequestContextMiddleware,
                              ),
                            },
                          ).pipe(
                            Effect.provideService(
                              RpcRequestContext,
                              ordinaryContext,
                            ),
                          )
                      ).pipe(
                        Effect.provideService(
                          Database,
                          Object.assign(transaction, {
                            $client: database.$client,
                          }),
                        ),
                      );
                    const before =
                      yield* transaction.query.eventInstances.findMany({
                        where: { tenantId },
                      });
                    const constraint = `test_event_child_write_${tenantId}`;
                    yield* transaction.execute(
                      sql.raw(
                        `ALTER TABLE event_registration_options ADD CONSTRAINT "${constraint}" CHECK (title <> '${optionTitle}') NOT VALID`,
                      ),
                    );
                    const failed = yield* create().pipe(Effect.exit);
                    expect(Exit.isFailure(failed)).toBe(true);
                    expect(
                      Exit.isFailure(failed)
                        ? Cause.pretty(failed.cause)
                        : 'success',
                    ).toContain(constraint);
                    expect(
                      yield* transaction.query.eventInstances.findMany({
                        where: { tenantId },
                      }),
                    ).toEqual(before);
                    expect(
                      yield* transaction.query.platformAuditEntries.findMany({
                        where: {
                          action: 'event.create',
                          targetTenantId: tenantId,
                        },
                      }),
                    ).toEqual([]);
                    yield* transaction.execute(
                      sql.raw(
                        `ALTER TABLE event_registration_options DROP CONSTRAINT "${constraint}"`,
                      ),
                    );
                    const created = yield* create();
                    const createdOptions =
                      yield* transaction.query.eventRegistrationOptions.findMany(
                        { where: { eventId: created.id } },
                      );
                    expect(createdOptions).toEqual([
                      expect.objectContaining({
                        isPaid: true,
                        price: 1000,
                        stripeTaxRateId,
                      }),
                    ]);
                    const savedDiscounts =
                      yield* transaction.query.templateRegistrationOptionDiscounts.findMany(
                        {
                          where: { registrationOptionId: optionId, templateId },
                        },
                      );
                    expect(savedDiscounts).toHaveLength(1);
                    expect(savedDiscounts[0]?.discountedPrice).toBe(750);
                    const eventDiscounts =
                      yield* transaction.query.eventRegistrationOptionDiscounts.findMany(
                        {
                          where: { eventId: created.id },
                        },
                      );
                    expect(
                      eventDiscounts.map(
                        (discount) => discount.discountedPrice,
                      ),
                    ).toEqual(providerStatus === 'enabled' ? [750] : []);
                    const audit =
                      yield* transaction.query.platformAuditEntries.findMany({
                        where: {
                          action: 'event.create',
                          targetTenantId: tenantId,
                        },
                      });
                    expect(audit).toHaveLength(author === 'platform' ? 1 : 0);
                    if (author === 'platform')
                      expect(audit[0]?.after?.resourceId).toBe(created.id);
                  }
                  return yield* Effect.fail(new FixtureRollback({}));
                }),
              )
              .pipe(Effect.catchTag('FixtureRollback', () => Effect.void));
            expect(
              yield* database.query.tenants.findFirst({
                where: { id: tenantId },
              }),
            ).toBeUndefined();
          }),
      );
    }
  },
);
