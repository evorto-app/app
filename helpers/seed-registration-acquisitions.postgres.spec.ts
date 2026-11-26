import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Pool } from 'pg';

import { createId } from '@db/create-id';
import { Database, databaseLayer } from '@db/index';
import { createNodePgPoolConfig } from '@db/pg-connection-config';
import { relations } from '@db/relations';
import * as schema from '@db/schema';
import { lockCurrentRegistrationAcquisition } from '../src/server/registrations/registration-acquisition-write';
import { addRegistrations } from './add-registrations';
import {
  assertSeededRegistrationAcquisitions,
  findConfirmedRegistrationsWithoutCurrentAcquisition,
} from './seed-registration-acquisitions';
import { resolvePostgresIntegrationEnvironment } from './testing/postgres-integration-environment';

type TestDatabase = NodePgDatabase<typeof relations>;

const seedDate = new Date('2030-01-01T12:00:00.000Z');
const eligibleUserCount = 12;

const makeLayer = (url: string) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: { DATABASE_TLS_REQUIRED: 'false', DATABASE_URL: url },
    }),
  );
  return Layer.mergeAll(config, databaseLayer.pipe(Layer.provide(config)));
};

const makeUser = (id: string) => ({
  auth0Id: `auth0|${id}`,
  communicationEmail: `${id}@example.com`,
  email: `${id}@example.com`,
  firstName: 'Seed',
  id,
  lastName: 'Acquisition',
});

describe('seeded registration acquisitions in PostgreSQL', () => {
  const tenantId = createId();
  const roleId = createId();
  const categoryId = createId();
  const templateId = createId();
  const eventId = createId();
  const optionId = createId();
  const creatorId = createId();
  const eligibleUserIds = Array.from({ length: eligibleUserCount }, () =>
    createId(),
  );
  const extraUserIds = [createId(), createId(), createId()];
  const allUserIds = [creatorId, ...eligibleUserIds, ...extraUserIds];
  let database: TestDatabase;
  let layer: ReturnType<typeof makeLayer>;
  let pool: Pool;
  let seeded: Awaited<ReturnType<typeof addRegistrations>>;

  beforeAll(async () => {
    const environment = await resolvePostgresIntegrationEnvironment({
      environment: {
        ...process.env,
        POSTGRES_INTEGRATION_DATABASE_URL: process.env['DATABASE_URL'],
      },
    });
    pool = new Pool(
      createNodePgPoolConfig({ databaseUrl: environment.databaseUrl }),
    );
    database = drizzle({ client: pool, relations });
    layer = makeLayer(environment.databaseUrl);

    await database.insert(schema.tenants).values({
      currency: 'EUR',
      domain: `${tenantId}.seed-acquisitions.example`,
      id: tenantId,
      name: 'Seed acquisitions',
    });
    await database.insert(schema.users).values(allUserIds.map(makeUser));
    await database
      .insert(schema.roles)
      .values({ id: roleId, name: 'Seed attendee', tenantId });
    const memberships = eligibleUserIds.map((userId) => ({
      id: createId(),
      tenantId,
      userId,
    }));
    await database.insert(schema.usersToTenants).values(memberships);
    await database.insert(schema.rolesToTenantUsers).values(
      memberships.map((membership) => ({
        roleId,
        tenantId,
        userTenantId: membership.id,
      })),
    );
    await database.insert(schema.eventTemplateCategories).values({
      icon: { iconColor: 0, iconName: 'circle' },
      id: categoryId,
      tenantId,
      title: 'Seed acquisitions',
    });
    await database.insert(schema.eventTemplates).values({
      categoryId,
      description: 'Seed acquisitions test',
      icon: { iconColor: 0, iconName: 'circle' },
      id: templateId,
      tenantId,
      title: 'Seed acquisitions',
    });
    const start = new Date('2030-02-01T18:00:00.000Z');
    await database.insert(schema.eventInstances).values({
      creatorId,
      description: 'Seed acquisitions test',
      end: new Date('2030-02-01T21:00:00.000Z'),
      icon: { iconColor: 0, iconName: 'circle' },
      id: eventId,
      reviewedAt: seedDate,
      reviewedBy: creatorId,
      start,
      status: 'APPROVED',
      templateId,
      tenantId,
      title: 'Seed acquisitions',
    });
    await database.insert(schema.eventRegistrationOptions).values({
      closeRegistrationTime: new Date('2030-01-31T18:00:00.000Z'),
      eventId,
      id: optionId,
      isPaid: false,
      openRegistrationTime: new Date('2029-12-01T00:00:00.000Z'),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      roleIds: [roleId],
      spots: 10,
      title: 'Participant',
    });
    // Event index 0 fills completely and adds a waitlist, so with twelve
    // eligible users the CONFIRMED rows are practically certain.
    seeded = await addRegistrations(database, {
      currency: 'EUR',
      events: [
        {
          id: eventId,
          registrationOptions: [
            {
              confirmedSpots: 0,
              id: optionId,
              isPaid: false,
              price: 0,
              roleIds: [roleId],
              spots: 10,
            },
          ],
          start,
          tenantId,
          title: 'Seed acquisitions',
        },
      ],
      seedDate,
      tenantId,
    });
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    const attempt = async (cleanup: () => PromiseLike<unknown>) => {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    };
    await attempt(() =>
      database
        .delete(schema.registrationAcquisitionComponents)
        .where(eq(schema.registrationAcquisitionComponents.tenantId, tenantId)),
    );
    await attempt(() =>
      database
        .delete(schema.registrationAcquisitions)
        .where(eq(schema.registrationAcquisitions.tenantId, tenantId)),
    );
    await attempt(() =>
      database
        .delete(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.tenantId, tenantId)),
    );
    await attempt(() =>
      database
        .delete(schema.eventRegistrationOptions)
        .where(eq(schema.eventRegistrationOptions.eventId, eventId)),
    );
    await attempt(() =>
      database
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, eventId)),
    );
    await attempt(() =>
      database
        .delete(schema.eventTemplates)
        .where(eq(schema.eventTemplates.id, templateId)),
    );
    await attempt(() =>
      database
        .delete(schema.eventTemplateCategories)
        .where(eq(schema.eventTemplateCategories.id, categoryId)),
    );
    await attempt(() =>
      database
        .delete(schema.rolesToTenantUsers)
        .where(eq(schema.rolesToTenantUsers.tenantId, tenantId)),
    );
    await attempt(() =>
      database
        .delete(schema.usersToTenants)
        .where(eq(schema.usersToTenants.tenantId, tenantId)),
    );
    await attempt(() =>
      database.delete(schema.roles).where(eq(schema.roles.tenantId, tenantId)),
    );
    await attempt(() =>
      database.delete(schema.users).where(inArray(schema.users.id, allUserIds)),
    );
    await attempt(() =>
      database.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
    await attempt(() => pool.end());
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Seed acquisition fixture cleanup failed',
      );
    }
  });

  it('writes an initial acquisition and component for every CONFIRMED registration only', async () => {
    const confirmed = seeded.filter(
      (registration) => registration.status === 'CONFIRMED',
    );
    expect(confirmed.length).toBeGreaterThan(0);
    const acquisitions = await database.query.registrationAcquisitions.findMany(
      { where: { tenantId } },
    );
    const components =
      await database.query.registrationAcquisitionComponents.findMany({
        where: { tenantId },
      });

    expect(acquisitions).toHaveLength(confirmed.length);
    expect(components).toHaveLength(confirmed.length);
    for (const registration of confirmed) {
      const registrationAcquisitions = acquisitions.filter(
        (acquisition) => acquisition.registrationId === registration.id,
      );
      expect(registrationAcquisitions).toHaveLength(1);
      expect(registrationAcquisitions[0]).toMatchObject({
        kind: 'initial',
        operationKey: `seed:${registration.id}`,
        ordinal: 0,
        ownerUserId: registration.userId,
        spotCount: 1,
      });
      const registrationComponents = components.filter(
        (component) => component.registrationId === registration.id,
      );
      expect(registrationComponents).toHaveLength(1);
      expect(registrationComponents[0]).toMatchObject({
        acquisitionId: registrationAcquisitions[0]?.id,
        acquisitionPaymentId: null,
        allocationKey: 'registration',
        currency: 'EUR',
        grossAmount: 0,
        kind: 'registration',
        quantity: 1,
      });
    }
    const confirmedIds = new Set(confirmed.map(({ id }) => id));
    expect(
      acquisitions.filter(
        (acquisition) => !confirmedIds.has(acquisition.registrationId),
      ),
    ).toEqual([]);
    expect(
      await findConfirmedRegistrationsWithoutCurrentAcquisition(
        database,
        tenantId,
      ),
    ).toEqual([]);
    await expect(
      assertSeededRegistrationAcquisitions(database, tenantId),
    ).resolves.toBeUndefined();
  });

  it('lets the real cancellation lock take a seeded CONFIRMED registration', async () => {
    const registration = seeded.find(
      (candidate) => candidate.status === 'CONFIRMED',
    );
    expect(registration).toBeDefined();
    if (!registration?.id) throw new Error('No seeded CONFIRMED registration');
    const registrationId = registration.id;
    const ownerUserId = registration.userId;

    const locked = await Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((tx) =>
          lockCurrentRegistrationAcquisition(tx, {
            ownerUserId,
            registrationId,
            tenantId,
          }),
        ),
      ).pipe(Effect.provide(layer)),
    );

    expect(locked.acquisition.ownerUserId).toBe(ownerUserId);
    expect(locked.acquisition.registrationId).toBe(registrationId);
    expect(locked.payments).toEqual([]);
    expect(locked.components).toHaveLength(1);
  });

  it('reports CONFIRMED registrations with a missing or foreign current acquisition', async () => {
    const [missingUserId, foreignUserId, otherOwnerId] = extraUserIds;
    if (!missingUserId || !foreignUserId || !otherOwnerId) {
      throw new Error('Missing extra fixture users');
    }
    const missingId = createId();
    const foreignId = createId();
    await database.insert(schema.eventRegistrations).values(
      [
        { id: missingId, userId: missingUserId },
        { id: foreignId, userId: foreignUserId },
      ].map(({ id, userId }) => ({
        basePriceAtRegistration: 0,
        discountAmount: 0,
        eventId,
        id,
        registrationOptionId: optionId,
        status: 'CONFIRMED' as const,
        tenantId,
        userId,
      })),
    );
    await database.insert(schema.registrationAcquisitions).values({
      acquiredAt: seedDate,
      eventId,
      kind: 'initial',
      operationKey: `seed:${foreignId}`,
      ordinal: 0,
      ownerUserId: otherOwnerId,
      registrationId: foreignId,
      spotCount: 1,
      tenantId,
    });

    const found = await findConfirmedRegistrationsWithoutCurrentAcquisition(
      database,
      tenantId,
    );

    expect(
      found.toSorted((a, b) =>
        a.registrationId.localeCompare(b.registrationId),
      ),
    ).toEqual(
      [
        {
          currentOwnerUserId: null,
          registrationId: missingId,
          userId: missingUserId,
        },
        {
          currentOwnerUserId: otherOwnerId,
          registrationId: foreignId,
          userId: foreignUserId,
        },
      ].toSorted((a, b) => a.registrationId.localeCompare(b.registrationId)),
    );
    await expect(
      assertSeededRegistrationAcquisitions(database, tenantId),
    ).rejects.toThrow(/2 CONFIRMED registration/);
  });
});
