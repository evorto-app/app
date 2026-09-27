import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Cause, ConfigProvider, Effect, Exit, Layer, Schema } from 'effect';
import { Headers } from 'effect/unstable/http';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { createId } from '../db/create-id';
import { Database, databaseLayer } from '../db/database.layer';
import { createNodePgPoolConfig } from '../db/pg-connection-config';
import { relations } from '../db/relations';
import {
  eventInstances,
  eventRegistrationOptions,
  eventTemplateCategories,
  eventTemplates,
  platformAuditEntries,
  roles,
  templateRegistrationOptions,
  tenants,
  tenantStripeTaxRates,
  users,
  usersToTenants,
} from '../db/schema';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../shared/rpc-contracts/app-rpcs';
import { AdminRolesDelete } from '../shared/rpc-contracts/app-rpcs/admin.rpcs';
import { EventsCreate } from '../shared/rpc-contracts/app-rpcs/events.rpcs';
import {
  type TemplateGraphInput,
  TemplatesCreate,
  TemplatesUpdate,
} from '../shared/rpc-contracts/app-rpcs/templates.rpcs';
import { PlatformAdministratorAuthority } from '../types/custom/platform-authority';
import { Tenant } from '../types/custom/tenant';
import { adminHandlers } from './effect/rpc/handlers/admin.handlers';
import { eventLifecycleHandlers } from './effect/rpc/handlers/events/events-lifecycle.handlers';
import { platformEventHandlers } from './effect/rpc/handlers/platform/platform-events.handlers';
import { RpcAccess } from './effect/rpc/handlers/shared/rpc-access.service';
import { templateHandlers } from './effect/rpc/handlers/templates.handlers';
import { lockTenantCurrencyForFinancialConfiguration } from './tenant-currency-integrity';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeDatabaseServiceLayer = (url: string) =>
  databaseLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: Object.fromEntries([
            ['DATABASE_TLS_REQUIRED', 'false'],
            ['DATABASE_URL', url],
          ]),
        }),
      ),
    ),
  );

const createAuthorContext = (
  tenant: Tenant,
  permissions: RpcRequestContextShape['permissions'],
) => {
  return {
    authData: { sub: 'auth0|currency-author' },
    authenticated: true,
    permissions,
    tenant,
    user: {
      auth0Id: 'auth0|currency-author',
      communicationEmail: 'author@example.com',
      email: 'author@example.com',
      firstName: 'Template',
      homeTenantId: undefined,
      homeTenantName: undefined,
      iban: undefined,
      id: 'currency-author',
      lastName: 'Author',
      paypalEmail: undefined,
      permissions,
      roleIds: [],
    },
    userAssigned: true,
  } satisfies RpcRequestContextShape;
};

const waitForBlockedTransaction = async (pool: Pool, blockerPid: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND $1::int = ANY(pg_blocking_pids(pid))
    `,
      [blockerPid],
    );
    if (Number(blocked.rows[0]?.count ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for a blocked database transaction');
};

describe('authoring and tenant configuration concurrency', () => {
  let database: TestDatabase;
  let pool: Pool;
  const categoryIds: string[] = [];
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    await database
      .delete(platformAuditEntries)
      .where(inArray(platformAuditEntries.targetTenantId, tenantIds));
    await database
      .delete(eventRegistrationOptions)
      .where(
        inArray(
          eventRegistrationOptions.eventId,
          database
            .select({ id: eventInstances.id })
            .from(eventInstances)
            .where(inArray(eventInstances.tenantId, tenantIds)),
        ),
      );
    await database
      .delete(eventInstances)
      .where(inArray(eventInstances.tenantId, tenantIds));
    await database
      .delete(tenantStripeTaxRates)
      .where(inArray(tenantStripeTaxRates.tenantId, tenantIds));
    await database
      .delete(usersToTenants)
      .where(inArray(usersToTenants.tenantId, tenantIds));
    if (userIds.length > 0)
      await database.delete(users).where(inArray(users.id, userIds));
    await database
      .delete(templateRegistrationOptions)
      .where(
        inArray(
          templateRegistrationOptions.templateId,
          database
            .select({ id: eventTemplates.id })
            .from(eventTemplates)
            .where(inArray(eventTemplates.tenantId, tenantIds)),
        ),
      );
    await database
      .delete(eventTemplates)
      .where(inArray(eventTemplates.tenantId, tenantIds));
    await database
      .delete(eventTemplateCategories)
      .where(inArray(eventTemplateCategories.id, categoryIds));
    await database.delete(roles).where(inArray(roles.tenantId, tenantIds));
    await database.delete(tenants).where(inArray(tenants.id, tenantIds));
    await pool.end();
  });

  const seedTenant = async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = `currency-${suffix}`.slice(0, 20);
    const categoryId = `category-${suffix}`.slice(0, 20);
    const templateId = `template-${suffix}`.slice(0, 20);
    tenantIds.push(tenantId);
    categoryIds.push(categoryId);
    const [tenantRow] = await database
      .insert(tenants)
      .values({
        currency: 'EUR',
        domain: `${suffix}.currency-lock.example`,
        id: tenantId,
        name: `Currency lock ${suffix}`,
      })
      .returning();
    if (!tenantRow) throw new Error('Missing currency fixture tenant');
    await database.insert(eventTemplateCategories).values({
      icon: { iconColor: 0, iconName: 'circle' },
      id: categoryId,
      tenantId,
      title: 'Currency lock category',
    });
    return {
      categoryId,
      templateId,
      tenant: Schema.decodeUnknownSync(Tenant)(tenantRow),
      tenantId,
    };
  };

  it('rejects both paid event creation paths after a concurrent payment-account removal', async () => {
    const fixture = await seedTenant();
    const creatorId = createId();
    const optionId = createId();
    const stripeAccountId = `acct_${fixture.tenantId}`;
    const stripeTaxRateId = `txr_${fixture.tenantId}`;
    userIds.push(creatorId);
    await database.insert(users).values({
      auth0Id: `auth0|${creatorId}`,
      communicationEmail: `${creatorId}@example.com`,
      email: `${creatorId}@example.com`,
      firstName: 'Event',
      id: creatorId,
      lastName: 'Author',
    });
    await database
      .insert(usersToTenants)
      .values({ tenantId: fixture.tenantId, userId: creatorId });
    await database.insert(eventTemplates).values({
      categoryId: fixture.categoryId,
      description: '<p>Paid event template</p>',
      icon: { iconColor: 0, iconName: 'circle' },
      id: fixture.templateId,
      simpleModeEnabled: false,
      tenantId: fixture.tenantId,
      title: 'Paid event template',
    });
    await database.insert(tenantStripeTaxRates).values({
      active: true,
      inclusive: true,
      percentage: '19',
      stripeAccountId,
      stripeTaxRateId,
      tenantId: fixture.tenantId,
    });
    await database.insert(templateRegistrationOptions).values({
      closeRegistrationOffset: 1,
      id: optionId,
      isPaid: true,
      openRegistrationOffset: 168,
      organizingRegistration: false,
      price: 1000,
      spots: 10,
      stripeTaxRateId,
      templateId: fixture.templateId,
      title: 'Participant',
    });
    const tenant = Tenant.make({ ...fixture.tenant, stripeAccountId });
    const context = createAuthorContext(tenant, ['events:create']);
    const ordinaryContext = {
      ...context,
      user: { ...context.user, auth0Id: `auth0|${creatorId}`, id: creatorId },
    };
    const platformContext = {
      authData: {},
      authenticated: true,
      permissions: [],
      platformAuthority: PlatformAdministratorAuthority.make({
        actorEmail: 'platform@example.com',
        actorId: 'auth0|account-race',
        kind: 'platformAdministrator',
      }),
      tenant,
      user: null,
      userAssigned: false,
    } satisfies RpcRequestContextShape;
    const ordinaryCreate = eventLifecycleHandlers['events.create'](
      {
        description: '<p>A paid event</p>',
        end: '2099-07-10T14:00:00.000Z',
        icon: { iconColor: 0, iconName: 'circle' },
        registrationOptions: [
          {
            cancellationDeadlineHoursBeforeStart: null,
            closeRegistrationTime: '2099-07-10T11:00:00.000Z',
            description: null,
            esnCardDiscountedPrice: null,
            isPaid: true,
            openRegistrationTime: '2099-07-01T12:00:00.000Z',
            organizingRegistration: false,
            price: 1000,
            refundFeesOnCancellation: null,
            registeredDescription: null,
            registrationMode: 'fcfs',
            roleIds: [],
            sourceTemplateRegistrationOptionId: optionId,
            spots: 10,
            stripeTaxRateId,
            title: 'Participant',
            transferDeadlineHoursBeforeStart: null,
          },
        ],
        start: '2099-07-10T12:00:00.000Z',
        templateId: fixture.templateId,
        title: 'Paid event',
      },
      {
        client: new Rpc.ServerClient(1),
        headers: Headers.empty,
        requestId: RpcMessage.RequestId(1),
        rpc: EventsCreate.middleware(RpcRequestContextMiddleware),
      },
    ).pipe(Effect.provideService(RpcRequestContext, ordinaryContext));
    const platformCreate = platformEventHandlers['platform.events.create'](
      {
        creatorUserId: creatorId,
        description: '<p>A paid event</p>',
        end: '2099-07-10T14:00:00.000Z',
        reason: 'Create reviewed event',
        start: '2099-07-10T12:00:00.000Z',
        targetTenantId: fixture.tenantId,
        templateId: fixture.templateId,
        title: 'Paid event',
      },
      undefined,
    ).pipe(
      Effect.provideService(RpcRequestContext, platformContext),
      Effect.map(({ id }) => ({ id })),
    );
    for (const operation of [ordinaryCreate, platformCreate]) {
      await database
        .update(tenants)
        .set({ stripeAccountId })
        .where(eq(tenants.id, fixture.tenantId));
      const client = await pool.connect();
      let transactionOpen = false;
      let settle = Promise.resolve();
      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const backend = await client.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const pid = backend.rows[0]?.pid;
        if (!pid)
          throw new Error('Missing payment configuration writer backend');
        await client.query(
          'UPDATE tenants SET "stripeAccountId" = NULL WHERE id = $1',
          [fixture.tenantId],
        );
        const pending = Effect.runPromiseExit(
          operation.pipe(
            Effect.provide(
              Layer.mergeAll(
                RpcAccess.Default,
                makeDatabaseServiceLayer(databaseUrl),
              ),
            ),
          ),
        );
        settle = pending.then(() => {
          // Cleanup awaits settlement; the outcome is asserted below.
        });
        await waitForBlockedTransaction(pool, pid);
        await client.query('COMMIT');
        transactionOpen = false;
        const outcome = await pending;
        if (Exit.isSuccess(outcome))
          throw new Error('Paid event used a removed payment account');
        expect(Cause.findErrorOption(outcome.cause)).toMatchObject({
          _tag: 'Some',
          value: { _tag: 'RpcBadRequestError', reason: 'paymentSetupRequired' },
        });
        expect(
          await database.query.eventInstances.findMany({
            where: { tenantId: fixture.tenantId },
          }),
        ).toEqual([]);
        expect(
          await database.query.platformAuditEntries.findMany({
            where: { targetTenantId: fixture.tenantId },
          }),
        ).toEqual([]);
      } finally {
        try {
          if (transactionOpen) {
            await client.query('ROLLBACK');
            transactionOpen = false;
          }
        } finally {
          client.release(transactionOpen);
          await settle;
        }
      }
    }
  }, 30_000);

  it.each(['create', 'update'] as const)(
    'rejects a stale template %s after a concurrent currency update and accepts a refreshed retry',
    async (mode) => {
      const fixture = await seedTenant();
      const input = {
        addOns: [],
        categoryId: fixture.categoryId,
        description:
          '<p>Template amounts reviewed in the current currency.</p>',
        icon: { iconColor: 0, iconName: 'circle' },
        location: null,
        planningTips: null,
        questions: [],
        registrationOptions: [],
        simpleModeEnabled: false,
        title: 'Reviewed currency template',
      } satisfies TemplateGraphInput;
      if (mode === 'update')
        await database.insert(eventTemplates).values({
          categoryId: fixture.categoryId,
          description: 'Original description',
          icon: input.icon,
          id: fixture.templateId,
          simpleModeEnabled: false,
          tenantId: fixture.tenantId,
          title: 'Original template',
        });
      const saveTemplate = (tenant: Tenant) => {
        const permissions = ['templates:create', 'templates:editAll'] as const;
        const context = createAuthorContext(tenant, permissions);
        const options = {
          client: new Rpc.ServerClient(1),
          headers: Headers.empty,
          requestId: RpcMessage.RequestId(1),
        };
        const operation =
          mode === 'create'
            ? templateHandlers['templates.create'](input, {
                ...options,
                rpc: TemplatesCreate.middleware(RpcRequestContextMiddleware),
              })
            : templateHandlers['templates.update'](
                { ...input, id: fixture.templateId },
                {
                  ...options,
                  rpc: TemplatesUpdate.middleware(RpcRequestContextMiddleware),
                },
              );
        return operation.pipe(
          Effect.provideService(RpcRequestContext, context),
          Effect.provide(
            Layer.mergeAll(
              RpcAccess.Default,
              makeDatabaseServiceLayer(databaseUrl),
            ),
          ),
        );
      };
      const client = await pool.connect();
      let transactionOpen = false;
      let settleTemplate = Promise.resolve();
      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const backend = await client.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const pid = backend.rows[0]?.pid;
        if (!pid) throw new Error('Missing currency writer backend');
        await client.query('UPDATE tenants SET currency = $1 WHERE id = $2', [
          'CZK',
          fixture.tenantId,
        ]);
        const pending = Effect.runPromiseExit(saveTemplate(fixture.tenant));
        settleTemplate = pending.then(() => {
          // Cleanup waits for settlement; the assertion below inspects the outcome.
        });
        await waitForBlockedTransaction(pool, pid);
        await client.query('COMMIT');
        transactionOpen = false;
        const outcome = await pending;
        if (Exit.isSuccess(outcome))
          throw new Error('Stale template write unexpectedly succeeded');
        expect(Cause.findErrorOption(outcome.cause)).toMatchObject({
          _tag: 'Some',
          value: {
            _tag: 'RpcBadRequestError',
            message:
              "The organization's currency changed while you were editing.",
            reason:
              'Nothing was saved. Open the form again and review every amount in CZK before saving.',
          },
        });
        expect(
          await database.query.eventTemplates.findMany({
            columns: { title: true },
            where: { tenantId: fixture.tenantId },
          }),
        ).toEqual(mode === 'create' ? [] : [{ title: 'Original template' }]);
      } finally {
        try {
          if (transactionOpen) {
            await client.query('ROLLBACK');
            transactionOpen = false;
          }
        } finally {
          client.release(transactionOpen);
          await settleTemplate;
        }
      }
      const refreshed = await Effect.runPromise(
        saveTemplate(Tenant.make({ ...fixture.tenant, currency: 'CZK' })),
      );
      expect(
        await database.query.eventTemplates.findFirst({
          columns: { title: true },
          where: { id: refreshed.id, tenantId: fixture.tenantId },
        }),
      ).toEqual({ title: input.title });
    },
    30_000,
  );

  it('keeps a role when a concurrent template write commits a reference to it', async () => {
    const fixture = await seedTenant();
    const roleId = createId();
    await database
      .insert(roles)
      .values({ id: roleId, name: 'Attendee', tenantId: fixture.tenantId });
    const input = {
      addOns: [],
      categoryId: fixture.categoryId,
      description: '<p>A template with role-restricted registration.</p>',
      icon: { iconColor: 0, iconName: 'circle' },
      location: null,
      planningTips: null,
      questions: [],
      registrationOptions: [
        {
          cancellationDeadlineHoursBeforeStart: null,
          closeRegistrationOffset: 0,
          description: null,
          esnCardDiscountedPrice: null,
          isPaid: false,
          key: 'attendee',
          openRegistrationOffset: 24,
          organizingRegistration: false,
          price: 0,
          refundFeesOnCancellation: null,
          registeredDescription: null,
          registrationMode: 'fcfs',
          roleIds: [roleId],
          spots: 10,
          stripeTaxRateId: null,
          title: 'Attendee',
          transferDeadlineHoursBeforeStart: null,
        },
      ],
      simpleModeEnabled: false,
      title: 'Role-restricted template',
    } satisfies TemplateGraphInput;
    const context = createAuthorContext(fixture.tenant, [
      'templates:create',
      'admin:manageRoles',
    ]);
    const handlerLayer = Layer.mergeAll(
      RpcAccess.Default,
      makeDatabaseServiceLayer(databaseUrl),
      Layer.succeed(RpcRequestContext, context),
    );
    const options = {
      client: new Rpc.ServerClient(1),
      headers: Headers.empty,
      requestId: RpcMessage.RequestId(1),
    };
    const ready = Promise.withResolvers<number>();
    const release = Promise.withResolvers<undefined>();
    const settlements: Promise<void>[] = [];
    const write = Effect.runPromiseExit(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((transaction) =>
          Effect.gen(function* () {
            const created = yield* templateHandlers['templates.create'](input, {
              ...options,
              rpc: TemplatesCreate.middleware(RpcRequestContextMiddleware),
            }).pipe(
              Effect.provideService(
                Database,
                Object.assign(transaction, { $client: effectDatabase.$client }),
              ),
            );
            const [backend] = yield* transaction
              .select({ pid: sql<number>`pg_backend_pid()` })
              .from(tenants)
              .where(eq(tenants.id, fixture.tenantId));
            if (!backend) throw new Error('Missing template writer backend');
            ready.resolve(backend.pid);
            yield* Effect.promise(() => release.promise);
            return created;
          }),
        ),
      ).pipe(Effect.provide(handlerLayer)),
    );
    settlements.push(
      write.then(() => {
        // Drain the writer before fixture cleanup, including failed assertions.
      }),
    );
    try {
      const pid = await Promise.race([
        ready.promise,
        write.then((outcome) => {
          throw new Error(
            'Template writer ended before its transaction barrier',
            { cause: outcome },
          );
        }),
      ]);
      const deletion = Effect.runPromiseExit(
        adminHandlers['admin.roles.delete'](
          { id: roleId },
          {
            ...options,
            rpc: AdminRolesDelete.middleware(RpcRequestContextMiddleware),
          },
        ).pipe(Effect.provide(handlerLayer)),
      );
      settlements.push(
        deletion.then(() => {
          // The expected typed failure is checked below; cleanup still waits for it.
        }),
      );
      await Promise.race([
        waitForBlockedTransaction(pool, pid),
        deletion.then((outcome) => {
          throw new Error('Role deletion did not wait for the template write', {
            cause: outcome,
          });
        }),
      ]);
      release.resolve(undefined);
      const written = await write;
      if (Exit.isFailure(written))
        throw new Error('Template writer failed', { cause: written.cause });
      const deleted = await deletion;
      if (Exit.isSuccess(deleted))
        throw new Error('Referenced role was deleted');
      expect(Cause.findErrorOption(deleted.cause)).toMatchObject({
        _tag: 'Some',
        value: {
          _tag: 'RpcBadRequestError',
          reason: 'roleInUseByTemplateOption',
        },
      });
      expect(
        await database
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.id, roleId)),
      ).toEqual([{ id: roleId }]);
      expect(
        await database
          .select({ roleIds: templateRegistrationOptions.roleIds })
          .from(templateRegistrationOptions)
          .where(eq(templateRegistrationOptions.templateId, written.value.id)),
      ).toEqual([{ roleIds: [roleId] }]);
    } finally {
      release.resolve(undefined);
      await Promise.all(settlements);
    }
  }, 30_000);

  it('makes a concurrent currency update observe the first committed template', async () => {
    const fixture = await seedTenant();
    const { promise: releaseTemplate, resolve: allowTemplateCommit } =
      Promise.withResolvers<undefined>();
    const { promise: templateLocked, resolve: markTemplateLocked } =
      Promise.withResolvers<number>();

    const templateWrite = Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((transaction) =>
          Effect.gen(function* () {
            yield* lockTenantCurrencyForFinancialConfiguration(
              transaction,
              fixture.tenantId,
              'EUR',
            );
            yield* transaction.insert(eventTemplates).values({
              categoryId: fixture.categoryId,
              description: 'First financial configuration',
              icon: { iconColor: 0, iconName: 'circle' },
              id: fixture.templateId,
              tenantId: fixture.tenantId,
              title: 'First currency template',
            });
            const [backend] = yield* transaction
              .select({ pid: sql<number>`pg_backend_pid()` })
              .from(tenants)
              .where(eq(tenants.id, fixture.tenantId));
            if (!backend) throw new Error('Missing template writer backend');
            markTemplateLocked(backend.pid);
            yield* Effect.promise(() => releaseTemplate);
          }),
        ),
      ).pipe(Effect.provide(makeDatabaseServiceLayer(databaseUrl))),
    );
    const holderPid = await templateLocked;

    const currencyUpdate = (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT currency FROM tenants WHERE id = $1 FOR UPDATE',
          [fixture.tenantId],
        );
        const dependentData = await client.query<{ exists: boolean }>(
          `SELECT EXISTS(
            SELECT 1 FROM event_templates WHERE "tenantId" = $1
          ) AS exists`,
          [fixture.tenantId],
        );
        if (dependentData.rows[0]?.exists) {
          await client.query('ROLLBACK');
          return 'blocked' as const;
        }
        await client.query('UPDATE tenants SET currency = $1 WHERE id = $2', [
          'AUD',
          fixture.tenantId,
        ]);
        await client.query('COMMIT');
        return 'updated' as const;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
      } finally {
        client.release();
      }
    })();

    try {
      await waitForBlockedTransaction(pool, holderPid);
    } finally {
      allowTemplateCommit(undefined);
      await templateWrite;
    }
    expect(await currencyUpdate).toBe('blocked');
    expect(
      await database.query.tenants.findFirst({
        columns: { currency: true },
        where: { id: fixture.tenantId },
      }),
    ).toEqual({ currency: 'EUR' });
  }, 30_000);
});
