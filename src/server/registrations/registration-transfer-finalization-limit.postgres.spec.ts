import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Pool, type PoolClient } from 'pg';

import { Database, databaseLayer } from '../../db';
import { createId } from '../../db/create-id';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import {
  emailOutbox,
  eventInstances,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitions,
  registrationTransferEvents,
  registrationTransfers,
  roles,
  rolesToTenantUsers,
  tenants,
  transactions,
  users,
  usersToTenants,
} from '../../db/schema';
import { finalizeRegistrationTransferCheckout } from './registration-transfer-finalization';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

type TestDatabase = NodePgDatabase<typeof relations>;

interface TransferCandidate {
  readonly acquisitionId: string;
  readonly eventId: string;
  readonly optionId: string;
  readonly registrationId: string;
  readonly sourceUserId: string;
  readonly transactionId: string;
  readonly transferId: string;
}

interface TransferLimitFixture {
  readonly candidates: readonly TransferCandidate[];
  readonly categoryId: string;
  readonly eligibleRoleId: string;
  readonly membershipId: string;
  readonly recipientUserId: string;
  readonly templateId: string;
  readonly tenantId: string;
  readonly unassignedRoleId: string;
}

const makeLayer = (url: string) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        DATABASE_URL: url,
      },
    }),
  );
  return Layer.mergeAll(config, databaseLayer.pipe(Layer.provide(config)));
};

type TestLayer = ReturnType<typeof makeLayer>;

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 10_000,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
};

const waitForBlockedRecipientLocks = (pool: Pool, minimumCount: number) =>
  waitFor(async () => {
    const blocked = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%users_to_tenants%'
      `,
    );
    return Number(blocked.rows[0]?.count ?? 0) >= minimumCount;
  }, `Timed out waiting for ${minimumCount} blocked recipient locks`);

const lockRecipientMembership = async (
  pool: Pool,
  fixture: TransferLimitFixture,
) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    await client.query(
      'SELECT id FROM users_to_tenants WHERE id = $1 FOR UPDATE',
      [fixture.membershipId],
    );
    return client;
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
};

const seedTransferLimitFixture = async (
  database: TestDatabase,
): Promise<TransferLimitFixture> => {
  const tenantId = createId();
  const categoryId = createId();
  const templateId = createId();
  const recipientUserId = createId();
  const membershipId = createId();
  const eligibleRoleId = createId();
  const unassignedRoleId = createId();
  const now = Date.now();
  const candidates: readonly TransferCandidate[] = [
    {
      acquisitionId: createId(),
      eventId: createId(),
      optionId: createId(),
      registrationId: createId(),
      sourceUserId: createId(),
      transactionId: createId(),
      transferId: createId(),
    },
    {
      acquisitionId: createId(),
      eventId: createId(),
      optionId: createId(),
      registrationId: createId(),
      sourceUserId: createId(),
      transactionId: createId(),
      transferId: createId(),
    },
  ];

  await database.insert(tenants).values({
    domain: `${tenantId}.transfer-limit.example`,
    id: tenantId,
    maxActiveRegistrationsPerUser: 1,
    name: 'Transfer finalization limit',
    stripeAccountId: 'acct_transfer_limit',
  });
  const userValues: (typeof users.$inferInsert)[] = [
    ...candidates.map(({ sourceUserId }, index) => ({
      auth0Id: `auth0|transfer-source-${sourceUserId}`,
      communicationEmail: `source-${index}@example.com`,
      email: `source-${index}@example.com`,
      firstName: 'Transfer',
      id: sourceUserId,
      lastName: `Source ${index}`,
    })),
    {
      auth0Id: `auth0|transfer-recipient-${recipientUserId}`,
      communicationEmail: 'recipient@example.com',
      email: 'recipient@example.com',
      firstName: 'Transfer',
      id: recipientUserId,
      lastName: 'Recipient',
    },
  ];
  await database.insert(users).values(userValues);
  await database.insert(usersToTenants).values({
    id: membershipId,
    tenantId,
    userId: recipientUserId,
  });
  await database.insert(roles).values([
    {
      id: eligibleRoleId,
      name: 'Transfer eligible',
      tenantId,
    },
    {
      id: unassignedRoleId,
      name: 'Transfer ineligible',
      tenantId,
    },
  ]);
  await database.insert(rolesToTenantUsers).values({
    roleId: eligibleRoleId,
    tenantId,
    userTenantId: membershipId,
  });
  await database.insert(eventTemplateCategories).values({
    icon: { iconColor: 0, iconName: 'circle' },
    id: categoryId,
    tenantId,
    title: 'Transfer limit',
  });
  await database.insert(eventTemplates).values({
    categoryId,
    description: 'Concurrent paid transfer finalization',
    icon: { iconColor: 0, iconName: 'circle' },
    id: templateId,
    tenantId,
    title: 'Transfer limit',
  });

  const eventValues: (typeof eventInstances.$inferInsert)[] = candidates.map(
    ({ eventId, sourceUserId }, index) => ({
      creatorId: sourceUserId,
      description: `Concurrent transfer event ${index + 1}`,
      end: new Date(now + (9 + index) * 24 * 60 * 60 * 1000),
      icon: { iconColor: 0, iconName: 'circle' },
      id: eventId,
      start: new Date(now + (7 + index) * 24 * 60 * 60 * 1000),
      status: 'APPROVED',
      templateId,
      tenantId,
      title: `Concurrent transfer event ${index + 1}`,
    }),
  );
  await database.insert(eventInstances).values(eventValues);

  const optionValues: (typeof eventRegistrationOptions.$inferInsert)[] =
    candidates.map(({ eventId, optionId }) => ({
      closeRegistrationTime: new Date(now + 6 * 24 * 60 * 60 * 1000),
      eventId,
      id: optionId,
      isPaid: true,
      openRegistrationTime: new Date(now - 24 * 60 * 60 * 1000),
      organizingRegistration: false,
      price: 1000,
      registrationMode: 'fcfs',
      roleIds: [eligibleRoleId],
      spots: 10,
      title: 'Participant',
    }));
  await database.insert(eventRegistrationOptions).values(optionValues);

  const registrationValues: (typeof eventRegistrations.$inferInsert)[] =
    candidates.map(({ eventId, optionId, registrationId, sourceUserId }) => ({
      eventId,
      id: registrationId,
      registrationOptionId: optionId,
      status: 'CONFIRMED',
      tenantId,
      userId: sourceUserId,
    }));
  await database.insert(eventRegistrations).values(registrationValues);

  const acquiredAt = new Date(now - 60_000);
  const acquisitionValues: (typeof registrationAcquisitions.$inferInsert)[] =
    candidates.map(
      ({ acquisitionId, eventId, registrationId, sourceUserId }) => ({
        acquiredAt,
        eventId,
        id: acquisitionId,
        kind: 'initial',
        operationKey: `registration-initial:${registrationId}`,
        ordinal: 0,
        ownerUserId: sourceUserId,
        registrationId,
        spotCount: 1,
        tenantId,
      }),
    );
  await database.insert(registrationAcquisitions).values(acquisitionValues);
  const componentValues: (typeof registrationAcquisitionComponents.$inferInsert)[] =
    candidates.map(({ acquisitionId, eventId, registrationId }) => ({
      acquiredAt,
      acquisitionId,
      allocationKey: 'registration',
      applicationFeeAmount: 0,
      baseAmount: 0,
      currency: 'EUR',
      eventId,
      grossAmount: 0,
      kind: 'registration',
      netAmount: 0,
      quantity: 1,
      registrationId,
      stripeFeeAmount: 0,
      taxAmount: 0,
      tenantId,
    }));
  await database
    .insert(registrationAcquisitionComponents)
    .values(componentValues);

  const paymentValues: (typeof transactions.$inferInsert)[] = candidates.map(
    ({ eventId, registrationId, transactionId, transferId }, index) => ({
      amount: 1000,
      appFee: 35,
      currency: 'EUR',
      eventId,
      eventRegistrationId: registrationId,
      id: transactionId,
      method: 'stripe',
      status: 'successful',
      stripeAccountId: 'acct_transfer_limit',
      stripeChargeId: `ch_${transactionId}`,
      stripeCheckoutRequest: {
        customerEmail: 'recipient@example.com',
        eventTitle: `Concurrent transfer event ${index + 1}`,
        eventUrl: `https://transfer-limit.example/events/${eventId}`,
        expiresAt: Math.floor((now + 60 * 60 * 1000) / 1000),
        lineItems: [
          {
            allocationKey: `registration-transfer:${transferId}:registration`,
            kind: 'registration',
            name: 'Participant',
            quantity: 1,
            unitAmount: 1000,
          },
        ],
        notificationEmail: 'recipient@example.com',
      },
      stripeFee: 15,
      stripeNetAmount: 950,
      stripePaymentIntentId: `pi_${transactionId}`,
      targetUserId: recipientUserId,
      tenantId,
      type: 'registration',
    }),
  );
  await database.insert(transactions).values(paymentValues);

  const transferValues: (typeof registrationTransfers.$inferInsert)[] =
    candidates.map(
      ({
        eventId,
        optionId,
        registrationId,
        sourceUserId,
        transactionId,
        transferId,
      }) => ({
        claimCodeHash: `code-${transferId}`,
        claimTokenHash: `token-${transferId}`,
        eventId,
        expiresAt: new Date(now + 60 * 60 * 1000),
        id: transferId,
        recipientBasePrice: 1000,
        recipientCheckoutTransactionId: transactionId,
        recipientRegistrationId: registrationId,
        recipientSpotCount: 1,
        recipientUserId,
        registrationOptionId: optionId,
        sourceRegistrationId: registrationId,
        sourceSpotCount: 1,
        sourceUserId,
        status: 'checkout_pending',
        tenantId,
      }),
    );
  await database.insert(registrationTransfers).values(transferValues);

  return {
    candidates,
    categoryId,
    eligibleRoleId,
    membershipId,
    recipientUserId,
    templateId,
    tenantId,
    unassignedRoleId,
  };
};

const cleanTransferLimitFixture = async (
  database: TestDatabase,
  fixture: TransferLimitFixture,
) => {
  await database
    .delete(emailOutbox)
    .where(eq(emailOutbox.tenantId, fixture.tenantId));
  await database
    .delete(registrationTransferEvents)
    .where(eq(registrationTransferEvents.tenantId, fixture.tenantId));
  await database
    .delete(registrationAcquisitionComponents)
    .where(eq(registrationAcquisitionComponents.tenantId, fixture.tenantId));
  await database
    .delete(registrationAcquisitionPayments)
    .where(eq(registrationAcquisitionPayments.tenantId, fixture.tenantId));
  await database
    .delete(registrationAcquisitions)
    .where(eq(registrationAcquisitions.tenantId, fixture.tenantId));
  await database
    .delete(registrationTransfers)
    .where(eq(registrationTransfers.tenantId, fixture.tenantId));
  await database
    .delete(transactions)
    .where(eq(transactions.tenantId, fixture.tenantId));
  await database
    .delete(eventRegistrations)
    .where(eq(eventRegistrations.tenantId, fixture.tenantId));
  for (const candidate of fixture.candidates) {
    await database
      .delete(eventRegistrationOptions)
      .where(eq(eventRegistrationOptions.id, candidate.optionId));
    await database
      .delete(eventInstances)
      .where(eq(eventInstances.id, candidate.eventId));
  }
  await database
    .delete(eventTemplates)
    .where(eq(eventTemplates.id, fixture.templateId));
  await database
    .delete(eventTemplateCategories)
    .where(eq(eventTemplateCategories.id, fixture.categoryId));
  await database
    .delete(rolesToTenantUsers)
    .where(eq(rolesToTenantUsers.tenantId, fixture.tenantId));
  await database.delete(roles).where(eq(roles.tenantId, fixture.tenantId));
  await database
    .delete(usersToTenants)
    .where(eq(usersToTenants.tenantId, fixture.tenantId));
  await database.delete(users).where(eq(users.id, fixture.recipientUserId));
  for (const candidate of fixture.candidates) {
    await database.delete(users).where(eq(users.id, candidate.sourceUserId));
  }
  await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
};

const finalizeCandidate = (
  layer: TestLayer,
  tenantId: string,
  candidate: TransferCandidate,
) =>
  Effect.runPromise(
    Database.use((database) =>
      database.transaction((tx) =>
        finalizeRegistrationTransferCheckout(tx, {
          registrationId: candidate.registrationId,
          tenantId,
          transactionId: candidate.transactionId,
        }),
      ),
    ).pipe(Effect.provide(layer)),
  );

describe('registration transfer finalization tenant limit', () => {
  let database: TestDatabase;
  const fixtures: TransferLimitFixture[] = [];
  let layer: TestLayer;
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
    layer = makeLayer(databaseUrl);
  });

  afterAll(async () => {
    for (const fixture of fixtures.toReversed()) {
      await cleanTransferLimitFixture(database, fixture);
    }
    await pool.end();
  });

  it('allows only one concurrent paid transfer across future events at a limit of one', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    const membershipLock: PoolClient = await lockRecipientMembership(
      pool,
      fixture,
    );

    try {
      const finalizations = fixture.candidates.map((candidate) =>
        finalizeCandidate(layer, fixture.tenantId, candidate),
      );
      await waitForBlockedRecipientLocks(pool, 2);
      await membershipLock.query('COMMIT');

      const outcomes = await Promise.all(finalizations);
      expect(
        outcomes.filter((outcome) => outcome === 'finalized'),
      ).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome === 'compensationQueued'),
      ).toHaveLength(1);

      const recipientRegistrations = await database
        .select({ id: eventRegistrations.id })
        .from(eventRegistrations)
        .where(
          and(
            eq(eventRegistrations.tenantId, fixture.tenantId),
            eq(eventRegistrations.userId, fixture.recipientUserId),
          ),
        );
      expect(recipientRegistrations).toHaveLength(1);

      const transferRows = await database
        .select({ status: registrationTransfers.status })
        .from(registrationTransfers)
        .where(eq(registrationTransfers.tenantId, fixture.tenantId));
      expect(
        transferRows.filter(({ status }) => status === 'completed'),
      ).toHaveLength(1);
      expect(
        transferRows.filter(({ status }) => status === 'compensation_pending'),
      ).toHaveLength(1);

      const compensationClaims = await database
        .select({ amount: transactions.amount })
        .from(transactions)
        .where(
          and(
            eq(transactions.tenantId, fixture.tenantId),
            eq(transactions.type, 'refund'),
          ),
        );
      expect(compensationClaims).toEqual([{ amount: -1000 }]);
    } finally {
      try {
        if (!membershipLock.released) {
          await membershipLock.query('ROLLBACK');
        }
      } finally {
        membershipLock.release();
      }
    }
  }, 30_000);

  it('compensates when the recipient loses a required role during Checkout', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    const candidate = fixture.candidates[0];
    if (!candidate) throw new Error('Expected a transfer candidate');

    await database
      .delete(rolesToTenantUsers)
      .where(
        and(
          eq(rolesToTenantUsers.roleId, fixture.eligibleRoleId),
          eq(rolesToTenantUsers.userTenantId, fixture.membershipId),
        ),
      );

    const outcome = await finalizeCandidate(layer, fixture.tenantId, candidate);
    expect(outcome).toBe('compensationQueued');

    const registration = await database.query.eventRegistrations.findFirst({
      where: { id: candidate.registrationId },
    });
    expect(registration?.userId).toBe(candidate.sourceUserId);
    const transfer = await database.query.registrationTransfers.findFirst({
      where: { id: candidate.transferId },
    });
    expect(transfer?.status).toBe('compensation_pending');
    expect(transfer?.compensationRefundTransactionId).not.toBeNull();
  });

  it('compensates when the option requires a different role during Checkout', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    const candidate = fixture.candidates[0];
    if (!candidate) throw new Error('Expected a transfer candidate');

    await database
      .update(eventRegistrationOptions)
      .set({ roleIds: [fixture.unassignedRoleId] })
      .where(eq(eventRegistrationOptions.id, candidate.optionId));

    const outcome = await finalizeCandidate(layer, fixture.tenantId, candidate);
    expect(outcome).toBe('compensationQueued');

    const registration = await database.query.eventRegistrations.findFirst({
      where: { id: candidate.registrationId },
    });
    expect(registration?.userId).toBe(candidate.sourceUserId);
    const compensationClaims = await database
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          eq(transactions.sourceTransactionId, candidate.transactionId),
          eq(transactions.type, 'refund'),
        ),
      );
    expect(compensationClaims).toEqual([{ amount: -1000 }]);
  });
});
