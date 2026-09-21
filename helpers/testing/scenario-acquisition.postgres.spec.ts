import { describe, expect, it } from '@effect/vitest';
import { DrizzleQueryError, eq, getTableName, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { createId } from '@db/create-id';
import { createNodePgPoolConfig } from '@db/pg-connection-config';
import { relations } from '@db/relations';
import * as schema from '@db/schema';
import { seedManualApprovalScenario } from '../../tests/support/utils/manual-approval-scenario';
import { seedPaidRegistrationTransferScenario } from '../../tests/support/utils/paid-registration-transfer-scenario';
import { seedProfileEventCards } from '../../tests/support/utils/profile-event-cards';
import type { SeedTenantResult } from '../seed-tenant';
import { usersToAuthenticate } from '../user-data';
import {
  requiredPostgresMajorVersion,
  resolvePostgresIntegrationEnvironment,
} from './postgres-integration-environment';

type TestDatabase = NodePgDatabase<typeof relations>;
type Cleanup = () => Promise<void>;
const seedDate = new Date('2030-01-01T12:00:00.000Z');

const throwFailures = (failures: readonly unknown[]) => {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Scenario proof and cleanup failed', {
      cause: failures[0],
    });
  }
};

const withCleanups = async (
  operation: Cleanup,
  cleanups: readonly Cleanup[],
) => {
  const failures: unknown[] = [];
  try {
    await operation();
  } catch (error) {
    failures.push(error);
  }
  for (const cleanup of cleanups.toReversed()) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  throwFailures(failures);
};

const readScenarioGraph = async (database: TestDatabase, tenantId: string) => {
  const events = await database
    .select({ id: schema.eventInstances.id })
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.tenantId, tenantId));
  const eventIds = events.map((event) => event.id);
  const selections = [
    ...[
      schema.eventInstances,
      schema.eventRegistrations,
      schema.transactions,
      schema.eventRegistrationAddonPurchases,
      schema.eventRegistrationAddonPurchaseLots,
      schema.registrationAcquisitions,
      schema.registrationAcquisitionPayments,
      schema.registrationAcquisitionComponents,
      schema.eventRegistrationAddonFulfillmentEvents,
      schema.eventRegistrationAddonRefundAllocations,
      schema.registrationAcquisitionRefundAllocations,
      schema.registrationTransfers,
      schema.registrationTransferBundleAddonPurchases,
      schema.registrationTransferBundleAddonPurchaseLots,
      schema.registrationTransferRefundPlanItems,
      schema.registrationTransferRefundPlanAcquisitionLinks,
      schema.registrationTransferEvents,
    ].map((table) => ({ table, predicate: eq(table.tenantId, tenantId) })),
    ...[
      schema.eventRegistrationOptions,
      schema.eventAddons,
      schema.addonToEventRegistrationOptions,
    ].map((table) => ({ table, predicate: inArray(table.eventId, eventIds) })),
  ];
  const snapshot: Record<string, string> = {};
  for (const { table, predicate } of selections) {
    const result = await database.execute<{ snapshot: string }>(sql`
      SELECT coalesce(jsonb_agg(to_jsonb(probe_row)
        ORDER BY to_jsonb(probe_row)::text), '[]'::jsonb)::text AS snapshot
      FROM (SELECT * FROM ${table} WHERE ${predicate}) AS probe_row
    `);
    const value = result.rows[0]?.snapshot;
    if (typeof value !== 'string') throw new Error('Missing scenario snapshot');
    snapshot[getTableName(table)] = value;
  }
  return snapshot;
};

const expectLateFailure = async (operation: Cleanup, marker: string) => {
  try {
    await operation();
  } catch (error) {
    if (!(error instanceof DrizzleQueryError)) throw error;
    try {
      expect(error.cause).toMatchObject({ code: 'P0001', message: marker });
    } catch (assertionError) {
      throw new AggregateError(
        [error, assertionError],
        'Scenario failed before the intended final write',
        // eslint-disable-next-line preserve-caught-error -- Preserve the original database failure as primary; both errors remain in the aggregate.
        { cause: error },
      );
    }
    return;
  }
  throw new Error('Scenario acquisition unexpectedly returned successfully');
};

const withLateFailureTrigger = async (
  database: TestDatabase,
  input: {
    marker: string;
    table:
      | typeof schema.eventInstances
      | typeof schema.registrationTransferEvents
      | typeof schema.transactions;
    tenantId: string;
    timing: 'BEFORE UPDATE' | 'AFTER INSERT';
  },
  operation: Cleanup,
) => {
  const name = `scenario_failure_${createId()}`;
  const functionName = sql`${sql.identifier('public')}.${sql.identifier(name)}`;
  const triggerName = sql.identifier(name);
  const cleanups: Cleanup[] = [];
  await withCleanups(async () => {
    await database.execute(sql`SELECT
      set_config('evorto.scenario_failure_tenant', ${input.tenantId}, true),
      set_config('evorto.scenario_failure_marker', ${input.marker}, true)
    `);
    await database.execute(sql`CREATE FUNCTION ${functionName}()
      RETURNS trigger LANGUAGE plpgsql AS $scenario$
      BEGIN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = current_setting('evorto.scenario_failure_marker');
      END;
      $scenario$`);
    cleanups.push(async () => {
      await database.execute(sql`DROP FUNCTION ${functionName}()`);
    });
    await database.execute(sql`CREATE TRIGGER ${triggerName}
      ${sql.raw(input.timing)} ON ${input.table}
      FOR EACH ROW WHEN (
        NEW.${sql.identifier(input.table.tenantId.name)} =
          current_setting('evorto.scenario_failure_tenant', true)
      ) EXECUTE FUNCTION ${functionName}()`);
    cleanups.push(async () => {
      await database.execute(
        sql`DROP TRIGGER ${triggerName} ON ${input.table}`,
      );
    });
    await operation();
  }, cleanups);
};

const seedPrerequisites = async (database: TestDatabase) => {
  const sourceIdentity = usersToAuthenticate.find(
    (user) => user.roles === 'user',
  );
  const recipientIdentity = usersToAuthenticate.find(
    (user) => user.roles === 'admin',
  );
  if (!sourceIdentity || !recipientIdentity) {
    throw new Error('Expected canonical scenario users');
  }
  await database
    .insert(schema.users)
    .values(
      [sourceIdentity, recipientIdentity].map((user) => ({
        auth0Id: user.authId,
        communicationEmail: user.email,
        email: user.email,
        firstName: 'Scenario',
        id: user.id,
        lastName: 'Rollback',
      })),
    )
    .onConflictDoNothing({ target: schema.users.id });
  const source = await database.query.users.findFirst({
    where: { id: sourceIdentity.id },
  });
  const recipient = await database.query.users.findFirst({
    where: { id: recipientIdentity.id },
  });
  if (!source || !recipient)
    throw new Error('Expected persisted scenario users');

  const tenantId = createId();
  const stripeAccountId = `acct_scenario_${tenantId}`;
  const stripeTaxRateId = `txr_scenario_${tenantId}`;
  const [tenant] = await database
    .insert(schema.tenants)
    .values({
      currency: 'EUR',
      domain: `scenario-${tenantId}.example`,
      id: tenantId,
      name: 'Scenario rollback',
      stripeAccountId,
      timezone: 'Europe/Berlin',
    })
    .returning();
  if (!tenant) throw new Error('Expected scenario tenant');
  const [category] = await database
    .insert(schema.eventTemplateCategories)
    .values({
      icon: { iconColor: 0, iconName: 'circle' },
      tenantId,
      title: 'Scenario rollback',
    })
    .returning();
  if (!category) throw new Error('Expected scenario category');
  const [template] = await database
    .insert(schema.eventTemplates)
    .values({
      categoryId: category.id,
      description: 'Local scenario rollback prerequisites',
      icon: category.icon,
      tenantId,
      title: 'Scenario rollback',
    })
    .returning();
  if (!template) throw new Error('Expected scenario template');
  await database.insert(schema.tenantStripeTaxRates).values([
    {
      active: true,
      displayName: 'VAT',
      inclusive: true,
      percentage: '19',
      stripeAccountId,
      stripeTaxRateId,
      tenantId,
    },
    {
      active: true,
      displayName: 'Zero rate',
      inclusive: true,
      percentage: '0',
      stripeAccountId,
      stripeTaxRateId: `${stripeTaxRateId}_zero`,
      tenantId,
    },
  ]);

  const atDay = (offset: number) =>
    new Date(seedDate.getTime() + offset * 24 * 60 * 60 * 1000);
  const futureEventId = createId();
  const pastEventId = createId();
  const draftEventId = createId();
  const eventTerms = [
    { id: futureEventId, start: atDay(2), status: 'APPROVED' },
    { id: pastEventId, start: atDay(-1), status: 'APPROVED' },
    { id: draftEventId, start: atDay(3), status: 'DRAFT' },
  ] satisfies Pick<
    typeof schema.eventInstances.$inferInsert,
    'id' | 'start' | 'status'
  >[];
  await database.insert(schema.eventInstances).values(
    eventTerms.map((event) => ({
      ...event,
      creatorId: source.id,
      description: 'Scenario acquisition source',
      end: new Date(event.start.getTime() + 2 * 60 * 60 * 1000),
      icon: template.icon,
      ...(event.status === 'APPROVED'
        ? { reviewedAt: seedDate, reviewedBy: recipient.id }
        : {}),
      templateId: template.id,
      tenantId,
      title: `Scenario source ${event.id}`,
    })),
  );
  const freeOptionId = createId();
  const paidOptionId = createId();
  const closedOptionId = createId();
  await database.insert(schema.eventRegistrationOptions).values([
    {
      checkedInSpots: 1,
      closeRegistrationTime: atDay(1),
      confirmedSpots: 1,
      eventId: futureEventId,
      id: freeOptionId,
      isPaid: false,
      openRegistrationTime: atDay(-1),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      spots: 10,
      stripeTaxRateId: null,
      title: 'Free option',
    },
    {
      closeRegistrationTime: atDay(1),
      eventId: futureEventId,
      id: paidOptionId,
      isPaid: true,
      openRegistrationTime: atDay(-1),
      organizingRegistration: false,
      price: 1200,
      registrationMode: 'fcfs',
      spots: 10,
      stripeTaxRateId,
      title: 'Paid option',
    },
    {
      closeRegistrationTime: atDay(-2),
      eventId: pastEventId,
      id: closedOptionId,
      isPaid: false,
      openRegistrationTime: atDay(-3),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      spots: 10,
      stripeTaxRateId: null,
      title: 'Closed option',
    },
  ]);
  const registrations = await database
    .insert(schema.eventRegistrations)
    .values({
      basePriceAtRegistration: 0,
      checkInTime: seedDate,
      discountAmount: 0,
      eventId: futureEventId,
      registrationOptionId: freeOptionId,
      status: 'CONFIRMED',
      tenantId,
      userId: source.id,
    })
    .returning();
  const seeded = {
    events: await database.query.eventInstances.findMany({
      orderBy: { id: 'asc' },
      where: { tenantId },
      with: { registrationOptions: true },
    }),
    registrations,
    roles: [],
    scenario: {
      events: {
        closedReg: { eventId: pastEventId, optionId: closedOptionId },
        draft: { eventId: draftEventId },
        freeOpen: { eventId: futureEventId, optionId: freeOptionId },
        paidOpen: { eventId: futureEventId, optionId: paidOptionId },
        past: { eventId: pastEventId },
      },
    },
    templateCategories: [category],
    templates: [
      {
        addOns: [],
        description: template.description,
        icon: template.icon.iconName,
        id: template.id,
        questions: [],
        seedKey: 'example-config',
        tenantId,
        title: template.title,
      },
    ],
    tenant,
  } satisfies SeedTenantResult;
  return { recipient, seeded, source, templateId: template.id };
};

const withScenarioFixture = async (
  operation: (
    database: TestDatabase,
    fixture: Awaited<ReturnType<typeof seedPrerequisites>>,
  ) => Promise<void>,
) => {
  const environment = await resolvePostgresIntegrationEnvironment({
    environment: {
      ...process.env,
      POSTGRES_INTEGRATION_DATABASE_URL: process.env['DATABASE_URL'],
    },
  });
  const pool = new Pool(
    createNodePgPoolConfig({ databaseUrl: environment.databaseUrl }),
  );
  const proof = async () => {
    const version = await pool.query<{ server_version_num: string }>(
      'SHOW server_version_num',
    );
    expect(
      Math.floor(Number(version.rows[0]?.server_version_num) / 10_000),
    ).toBe(requiredPostgresMajorVersion);
    const database = drizzle({ client: pool, relations });
    const userIds = usersToAuthenticate
      .filter((user) => user.roles === 'user' || user.roles === 'admin')
      .map((user) => user.id);
    const readUsers = () =>
      database
        .select()
        .from(schema.users)
        .where(inArray(schema.users.id, userIds))
        .orderBy(schema.users.id);
    const beforeUsers = await readUsers();
    const completed = new Error('Roll back scenario prerequisites');
    const failures: unknown[] = [];
    let tenantId: string | undefined;
    try {
      // Actual helper transactions use savepoints inside this owned transaction.
      await database.transaction(async (transaction) => {
        try {
          const fixture = await seedPrerequisites(transaction);
          tenantId = fixture.seeded.tenant.id;
          await operation(transaction, fixture);
        } catch (error) {
          failures.push(error);
        }
        throw completed;
      });
    } catch (error) {
      if (error !== completed) failures.push(error);
    }
    for (const check of [
      async () => {
        if (!tenantId)
          throw new Error('Scenario prerequisites did not complete');
        expect(
          await database.query.tenants.findFirst({ where: { id: tenantId } }),
        ).toBeUndefined();
      },
      async () => {
        expect(await readUsers()).toEqual(beforeUsers);
      },
    ]) {
      try {
        await check();
      } catch (error) {
        failures.push(error);
      }
    }
    throwFailures(failures);
  };
  await withCleanups(proof, [() => pool.end()]);
};

describe('scenario acquisition rollback in PostgreSQL', () => {
  it('restores manual registration status, counters and event dates after a final update failure', async () => {
    await withScenarioFixture(async (database, { seeded }) => {
      const before = await readScenarioGraph(database, seeded.tenant.id);
      const marker = 'manual-scenario-final-update';
      await withLateFailureTrigger(
        database,
        {
          marker,
          table: schema.eventInstances,
          tenantId: seeded.tenant.id,
          timing: 'BEFORE UPDATE',
        },
        async () => {
          await expectLateFailure(async () => {
            await seedManualApprovalScenario({
              database,
              kind: 'free',
              seeded,
            });
          }, marker);
          expect(await readScenarioGraph(database, seeded.tenant.id)).toEqual(
            before,
          );
        },
      );
    });
  });

  it('removes all paid transfer setup rows after the final transfer event insert fails', async () => {
    await withScenarioFixture(
      async (database, { recipient, seeded, source, templateId }) => {
        const before = await readScenarioGraph(database, seeded.tenant.id);
        const marker = 'paid-transfer-scenario-final-insert';
        await withLateFailureTrigger(
          database,
          {
            marker,
            table: schema.registrationTransferEvents,
            tenantId: seeded.tenant.id,
            timing: 'AFTER INSERT',
          },
          async () => {
            await expectLateFailure(async () => {
              await seedPaidRegistrationTransferScenario({
                database,
                recipient,
                source,
                templateId,
                tenant: seeded.tenant,
                title: 'Paid transfer rollback proof',
              });
            }, marker);
            expect(await readScenarioGraph(database, seeded.tenant.id)).toEqual(
              before,
            );
          },
        );
      },
    );
  });

  it('rolls back profile cards and nested add-ons before running its registered cleanup', async () => {
    await withScenarioFixture(async (database, { seeded, source }) => {
      const before = await readScenarioGraph(database, seeded.tenant.id);
      const marker = 'profile-scenario-final-checkout-insert';
      const cleanups: Cleanup[] = [];
      let cleanupCalls = 0;
      const acquire = async () => {
        await withLateFailureTrigger(
          database,
          {
            marker,
            table: schema.transactions,
            tenantId: seeded.tenant.id,
            timing: 'AFTER INSERT',
          },
          async () => {
            await expectLateFailure(async () => {
              await seedProfileEventCards({
                database,
                registerDatabaseCleanup: (cleanup) => {
                  cleanups.push(async () => {
                    cleanupCalls += 1;
                    await cleanup();
                  });
                },
                seedDate,
                seeded,
                userId: source.id,
              });
            }, marker);
            expect(cleanups).toHaveLength(1);
            expect(cleanupCalls).toBe(0);
            // Cleanup must not hide partial rows left by a failed acquisition.
            expect(await readScenarioGraph(database, seeded.tenant.id)).toEqual(
              before,
            );
          },
        );
      };
      await withCleanups(acquire, cleanups);
      expect(cleanupCalls).toBe(1);
      expect(await readScenarioGraph(database, seeded.tenant.id)).toEqual(
        before,
      );
    });
  });
});
