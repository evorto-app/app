import type { PlatformTemplatesCreateInput } from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';

import { createId } from '@db/create-id';
import { Database, databaseLayer } from '@db/index';
import {
  eventTemplateCategories,
  eventTemplates,
  platformAuditEntries,
  roles,
  templateRegistrationOptions,
  tenants,
} from '@db/schema';
import { beforeEach, expect, layer } from '@effect/vitest';
import { RpcRequestContext } from '@shared/rpc-contracts/app-rpcs';
import { eq } from 'drizzle-orm';
import { Cause, ConfigProvider, Effect, Exit, Layer, Schema } from 'effect';
import { vi } from 'vitest';

import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { Tenant } from '../../../../../types/custom/tenant';
import { RpcAccess } from '../shared/rpc-access.service';
import { loadTemplateGraphDetail } from '../templates/template-graph.query';
import { platformTemplateHandlers } from './platform-templates.handlers';

const audit = vi.hoisted(() => ({ fail: false }));
vi.mock('../shared/platform-operation.service', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../shared/platform-operation.service')
    >();
  return {
    ...actual,
    writePlatformAudit: (
      ...args: Parameters<typeof actual.writePlatformAudit>
    ) =>
      audit.fail
        ? Effect.die(new Error('Injected platform audit write failure'))
        : actual.writePlatformAudit(...args),
  };
});
beforeEach(() => {
  audit.fail = false;
});

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl)
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
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

const seedFixture = Effect.gen(function* () {
  const database = yield* Database;
  const tenantId = createId();
  const otherTenantId = createId();
  const categoryId = createId();
  const roleId = createId();
  const otherRoleId = createId();
  const [tenantRecord] = yield* database
    .insert(tenants)
    .values([
      {
        domain: `${tenantId}.template.example`,
        id: tenantId,
        name: 'Template target',
      },
      {
        domain: `${otherTenantId}.template.example`,
        id: otherTenantId,
        name: 'Other target',
      },
    ])
    .returning();
  if (!tenantRecord) throw new Error('Missing fixture tenant');
  const tenant = yield* Schema.decodeUnknownEffect(Tenant)(tenantRecord);
  yield* database.insert(eventTemplateCategories).values({
    icon: { iconColor: 0, iconName: 'calendar:fas' },
    id: categoryId,
    tenantId,
    title: 'Fixture category',
  });
  yield* database.insert(roles).values([
    { id: roleId, name: 'Target members', tenantId },
    { id: otherRoleId, name: 'Private other members', tenantId: otherTenantId },
  ]);
  const input = {
    addOns: [
      {
        allowMultiple: true,
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: true,
        allowPurchaseDuringRegistration: true,
        description: null,
        isPaid: false,
        key: 'meal',
        maxQuantityPerUser: 2,
        price: 0,
        registrationOptions: [
          {
            includedQuantity: 1,
            optionalPurchaseQuantity: 1,
            registrationOptionKey: 'participant',
          },
        ],
        stripeTaxRateId: null,
        title: 'Meal',
        totalAvailableQuantity: 20,
      },
    ],
    categoryId,
    description: '<p>Fixture description</p>',
    icon: { iconColor: 0, iconName: 'calendar:fas' },
    location: null,
    planningTips: null,
    questions: [
      {
        description: null,
        key: 'diet',
        registrationOptionKey: 'participant',
        required: true,
        sortOrder: 0,
        title: 'Dietary needs',
      },
    ],
    reason: 'Verify the target template graph',
    registrationOptions: ['organizer', 'participant'].map((key) => ({
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 24,
      description: null,
      esnCardDiscountedPrice: null,
      isPaid: false,
      key,
      openRegistrationOffset: 168,
      organizingRegistration: key === 'organizer',
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs' as const,
      roleIds: [roleId],
      spots: 10,
      stripeTaxRateId: null,
      title: key,
      transferDeadlineHoursBeforeStart: null,
    })),
    simpleModeEnabled: true,
    targetTenantId: tenantId,
    title: 'Owned template',
  } satisfies PlatformTemplatesCreateInput;
  const context = {
    authData: {},
    authenticated: true,
    permissions: [],
    platformAuthority: PlatformAdministratorAuthority.make({
      actorEmail: 'platform@example.org',
      actorId: 'auth0|template-fixture',
      kind: 'platformAdministrator',
    }),
    tenant,
    user: null,
    userAssigned: false,
  } satisfies typeof RpcRequestContext.Service;
  return { context, input, otherRoleId, otherTenantId, roleId, tenantId };
});

layer(testLayer)('persisted platform template graph', (it) => {
  it.effect(
    'loads only the target graph and refuses a persisted role from another organization',
    () =>
      Effect.gen(function* () {
        const database = yield* Database;
        yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const fixture = yield* seedFixture;
              const graph = yield* platformTemplateHandlers[
                'platform.templates.create'
              ](fixture.input, undefined).pipe(
                Effect.provideService(RpcRequestContext, fixture.context),
              );
              expect(graph.registrationOptions).toHaveLength(2);
              expect(
                graph.registrationOptions.every((option) =>
                  option.roleIds.includes(fixture.roleId),
                ),
              ).toBe(true);
              expect(graph.addOns).toHaveLength(1);
              expect(graph.questions).toHaveLength(1);
              const denied = yield* loadTemplateGraphDetail(
                transaction,
                fixture.otherTenantId,
                graph.id,
              ).pipe(Effect.flip);
              expect(denied.reason).toBe('templateNotFound');
              expect(denied.message).not.toContain(graph.id);
              yield* transaction
                .update(templateRegistrationOptions)
                .set({ roleIds: [fixture.otherRoleId] })
                .where(
                  eq(
                    templateRegistrationOptions.id,
                    graph.registrationOptions[0].id,
                  ),
                );
              const corrupt = yield* loadTemplateGraphDetail(
                transaction,
                fixture.tenantId,
                graph.id,
              ).pipe(Effect.exit);
              expect(Exit.isFailure(corrupt)).toBe(true);
              if (!Exit.isFailure(corrupt))
                throw new Error('Expected unresolved tenant role to fail');
              expect(Cause.pretty(corrupt.cause)).toContain(
                'references missing tenant role',
              );
              return yield* Effect.fail(new FixtureRollback());
            }).pipe(
              Effect.provideService(
                Database,
                Object.assign(transaction, { $client: database.$client }),
              ),
            ),
          )
          .pipe(Effect.catchTag('FixtureRollback', () => Effect.void));
      }),
  );

  it.effect(
    'rolls back graph creation and replacement when audit writing fails, then commits one successful retry',
    () =>
      Effect.gen(function* () {
        const database = yield* Database;
        yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const fixture = yield* seedFixture;
              const create = (input: PlatformTemplatesCreateInput) =>
                platformTemplateHandlers['platform.templates.create'](
                  input,
                  undefined,
                ).pipe(
                  Effect.provideService(RpcRequestContext, fixture.context),
                );
              const original = yield* create(fixture.input);
              const replacement = {
                ...fixture.input,
                templateId: original.id,
                title: 'Replacement title',
              };
              const update = () =>
                platformTemplateHandlers['platform.templates.update'](
                  replacement,
                  undefined,
                ).pipe(
                  Effect.provideService(RpcRequestContext, fixture.context),
                );
              audit.fail = true;
              for (const operation of [
                create({ ...fixture.input, title: 'Uncommitted new graph' }),
                update(),
              ]) {
                const failed = yield* operation.pipe(Effect.exit);
                expect(Exit.isFailure(failed)).toBe(true);
                if (!Exit.isFailure(failed))
                  throw new Error('Expected audit failure');
                expect(Cause.pretty(failed.cause)).toContain(
                  'Injected platform audit write failure',
                );
                expect(
                  yield* loadTemplateGraphDetail(
                    transaction,
                    fixture.tenantId,
                    original.id,
                  ),
                ).toEqual(original);
                expect(
                  yield* transaction
                    .select({ id: eventTemplates.id })
                    .from(eventTemplates)
                    .where(eq(eventTemplates.tenantId, fixture.tenantId)),
                ).toEqual([{ id: original.id }]);
                expect(
                  yield* transaction
                    .select({ action: platformAuditEntries.action })
                    .from(platformAuditEntries)
                    .where(
                      eq(platformAuditEntries.targetTenantId, fixture.tenantId),
                    ),
                ).toEqual([{ action: 'template.create' }]);
              }
              audit.fail = false;
              const updated = yield* update();
              expect(updated.title).toBe(replacement.title);
              expect(updated.addOns).toHaveLength(1);
              expect(updated.questions).toHaveLength(1);
              expect(
                yield* transaction
                  .select({ action: platformAuditEntries.action })
                  .from(platformAuditEntries)
                  .where(
                    eq(platformAuditEntries.targetTenantId, fixture.tenantId),
                  )
                  .orderBy(platformAuditEntries.action),
              ).toEqual([
                { action: 'template.create' },
                { action: 'template.update' },
              ]);
              return yield* Effect.fail(new FixtureRollback());
            }).pipe(
              Effect.provideService(
                Database,
                Object.assign(transaction, { $client: database.$client }),
              ),
            ),
          )
          .pipe(Effect.catchTag('FixtureRollback', () => Effect.void));
      }),
  );
});
