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
import { RpcRequestContext } from '@shared/rpc-contracts/app-rpcs';
import { eq } from 'drizzle-orm';
import { ConfigProvider, Effect, Layer, Schema } from 'effect';

import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { Tenant } from '../../../../../types/custom/tenant';
import { RpcAccess } from '../shared/rpc-access.service';
import { platformEventHandlers } from './platform-events.handlers';

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
        `creates a paid event while the target provider is ${providerStatus}`,
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

                  const created = yield* platformEventHandlers[
                    'platform.events.create'
                  ](
                    {
                      creatorUserId: creatorId,
                      description:
                        '<p>An event created from a saved template</p>',
                      end: '2099-07-10T14:00:00.000Z',
                      reason: 'Create an event from the existing template',
                      start: '2099-07-10T12:00:00.000Z',
                      targetTenantId: tenantId,
                      templateId,
                      title: 'Created activity',
                    },
                    undefined,
                  ).pipe(
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
                      tenant: originalTenant,
                      user: null,
                      userAssigned: false,
                    }),
                  );
                  expect(created.registrationOptions).toHaveLength(1);
                  expect(created.registrationOptions[0]).toMatchObject({
                    esnCardDiscountedPrice:
                      providerStatus === 'enabled' ? 750 : null,
                    isPaid: true,
                    price: 1000,
                    stripeTaxRateId,
                  });
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
                    eventDiscounts.map((discount) => discount.discountedPrice),
                  ).toEqual(providerStatus === 'enabled' ? [750] : []);
                  const audit =
                    yield* transaction.query.platformAuditEntries.findMany({
                      where: {
                        action: 'event.create',
                        targetTenantId: tenantId,
                      },
                    });
                  expect(audit).toHaveLength(1);
                  expect(audit[0]?.after?.resourceId).toBe(created.id);
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
