import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect';
import { Pool, type PoolClient } from 'pg';
import Stripe from 'stripe';

import { Database, type DatabaseClient, databaseLayer } from '../../db';
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
  tenantStripeTaxRates,
  transactions,
  users,
  usersToTenants,
} from '../../db/schema';
import { RegistrationTransferConflictError } from '../../shared/rpc-contracts/app-rpcs/registration-transfers.errors';
import { EventRegistrationService } from '../effect/rpc/handlers/events/event-registration.service';
import { StripeClient } from '../stripe-client';
import { createRegistrationTransferClaimCode } from './registration-transfer-claim-code';
import { finalizeRegistrationTransferCheckout } from './registration-transfer-finalization';
import {
  ensureRegistrationMutationHasNoActiveTransfer,
  registrationTransferMutationBlockingStatuses,
  registrationTransferOpenDeadlinePredicate,
} from './registration-transfer-mutation-guard';
import { RegistrationTransferService } from './registration-transfer.service';

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

class NoNetworkStripeHttpClient extends Stripe.HttpClient {
  override getClientName() {
    return 'registration-transfer-finalization-fixture';
  }

  override makeRequest(): Promise<never> {
    return Promise.reject(
      new Error('Unexpected Stripe request during transfer finalization'),
    );
  }
}

const makeLayer = (url: string) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        BASE_URL: 'https://transfer-limit.example',
        CLIENT_ID: 'client-id',
        CLIENT_SECRET: 'client-secret',
        DATABASE_TLS_REQUIRED: 'false',
        DATABASE_URL: url,
        ISSUER_BASE_URL: 'https://issuer.example',
        SECRET: 'transfer-lock-order-test-secret-32-bytes',
      },
    }),
  );
  return Layer.mergeAll(
    config,
    databaseLayer.pipe(Layer.provide(config)),
    Layer.succeed(
      StripeClient,
      new Stripe('sk_test_transfer_lock_order', {
        httpClient: new NoNetworkStripeHttpClient(),
        maxNetworkRetries: 0,
      }),
    ),
  );
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

const waitForBlockedEligibilityLocks = (pool: Pool, minimumCount: number) =>
  waitFor(async () => {
    const blocked = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND (
            query ILIKE '%event_instances%'
            OR query ILIKE '%users_to_tenants%'
          )
      `,
    );
    return Number(blocked.rows[0]?.count ?? 0) >= minimumCount;
  }, `Timed out waiting for ${minimumCount} blocked eligibility locks`);

const waitForBlockedEventLock = (pool: Pool) =>
  waitFor(async () => {
    const blocked = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%event_instances%'
      `,
    );
    return Number(blocked.rows[0]?.count ?? 0) >= 1;
  }, 'Timed out waiting for the transfer event lock');

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

const lockTransferEvent = async (pool: Pool, candidate: TransferCandidate) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    await client.query(
      'SELECT id FROM event_instances WHERE id = $1 FOR UPDATE',
      [candidate.eventId],
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
  await database.insert(tenantStripeTaxRates).values({
    active: true,
    inclusive: true,
    percentage: '0',
    stripeAccountId: 'acct_transfer_limit',
    stripeTaxRateId: 'txr_transfer_limit',
    tenantId,
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
      reviewedAt: new Date(now - 2 * 60 * 60 * 1000),
      reviewedBy: sourceUserId,
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
      stripeTaxRateId: 'txr_transfer_limit',
      title: 'Participant',
    }));
  await database.insert(eventRegistrationOptions).values(optionValues);

  const registrationValues: (typeof eventRegistrations.$inferInsert)[] =
    candidates.map(({ eventId, optionId, registrationId, sourceUserId }) => ({
      basePriceAtRegistration: 0,
      discountAmount: 0,
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
        eventId,
        expiresAt: new Date(now + 60 * 60 * 1000),
        id: transferId,
        recipientBasePrice: 1000,
        recipientCheckoutTransactionId: transactionId,
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
  await database
    .delete(tenantStripeTaxRates)
    .where(eq(tenantStripeTaxRates.tenantId, fixture.tenantId));
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

const readTenantPolicyState = (database: Pick<DatabaseClient, 'select'>) =>
  database
    .select({
      enabled: sql<boolean>`relrowsecurity`,
      forced: sql<boolean>`relforcerowsecurity`,
      hasPolicies: sql<boolean>`EXISTS (
        SELECT 1 FROM pg_policy WHERE polrelid = pg_class.oid
      )`,
    })
    .from(sql`pg_class`)
    .where(sql`oid = 'public.tenants'::regclass`);

const finalizeCandidateWithoutVisibleTenantSettings = (
  tenantId: string,
  candidate: TransferCandidate,
) =>
  Database.use((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        const role = sql.identifier(`evorto_transfer_fixture_${createId()}`);
        const policy = sql.identifier(`hide_transfer_tenant_${createId()}`);

        yield* tx.execute(
          sql`LOCK TABLE public.tenants IN ACCESS EXCLUSIVE MODE`,
        );
        const policyState = yield* readTenantPolicyState(tx);
        const state = policyState[0];
        if (!state || state.enabled || state.forced || state.hasPolicies) {
          return yield* Effect.die(
            new Error(
              'Tenant visibility fixture requires disabled row security and no policies',
            ),
          );
        }

        yield* tx.execute(
          sql`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`,
        );
        yield* tx.execute(sql`GRANT USAGE ON SCHEMA public TO ${role}`);
        yield* tx.execute(sql`
          GRANT SELECT, INSERT, UPDATE, DELETE
          ON ALL TABLES IN SCHEMA public TO ${role}
        `);
        yield* tx.execute(
          sql`ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY`,
        );
        yield* tx.execute(
          sql`ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY`,
        );
        yield* tx.execute(sql`
          CREATE POLICY ${policy} ON public.tenants FOR SELECT TO ${role}
          USING (
            current_setting('evorto.test_hidden_tenant_id', true) IS NULL
            OR id <> current_setting('evorto.test_hidden_tenant_id', true)
          )
        `);
        yield* tx.execute(sql`SET LOCAL ROLE ${role}`);
        yield* tx.execute(
          sql`SELECT set_config('evorto.test_hidden_tenant_id', ${tenantId}, true)`,
        );
        const outcome = yield* finalizeRegistrationTransferCheckout(tx, {
          registrationId: candidate.registrationId,
          tenantId,
          transactionId: candidate.transactionId,
        });

        yield* tx.execute(sql`RESET ROLE`);
        yield* tx.execute(sql`DROP POLICY ${policy} ON public.tenants`);
        yield* tx.execute(
          sql`ALTER TABLE public.tenants NO FORCE ROW LEVEL SECURITY`,
        );
        yield* tx.execute(
          sql`ALTER TABLE public.tenants DISABLE ROW LEVEL SECURITY`,
        );
        yield* tx.execute(sql`DROP OWNED BY ${role}`);
        yield* tx.execute(sql`DROP ROLE ${role}`);
        return outcome;
      }),
    ),
  );

const registerRecipientForCandidate = (
  layer: TestLayer,
  fixture: TransferLimitFixture,
  candidate: TransferCandidate,
) =>
  Effect.runPromise(
    EventRegistrationService.registerForEvent({
      addOns: [],
      eventId: candidate.eventId,
      guestCount: 0,
      registrationOptionId: candidate.optionId,
      tenant: {
        currency: 'EUR',
        domain: `${fixture.tenantId}.transfer-limit.example`,
        emailSenderEmail: null,
        emailSenderName: null,
        id: fixture.tenantId,
        maxActiveRegistrationsPerUser: 1,
        name: 'Transfer limit organization',
        stripeAccountId: 'acct_transfer_limit',
      },
      user: {
        communicationEmail: 'recipient@example.com',
        email: 'recipient@example.com',
        id: fixture.recipientUserId,
        roleIds: [fixture.eligibleRoleId],
      },
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: () => ({ status: 'success' as const }),
      }),
      Effect.provide(EventRegistrationService.Default),
      Effect.provide(layer),
    ),
  );

const claimOpenCandidate = (
  layer: TestLayer,
  fixture: TransferLimitFixture,
  claimCode: string,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* RegistrationTransferService;
      return yield* service.claim({
        answers: [],
        claimCode,
        tenant: {
          cancellationDeadlineHoursBeforeStart: 24,
          currency: 'EUR',
          domain: `${fixture.tenantId}.transfer-limit.example`,
          emailSenderEmail: 'tickets@example.com',
          emailSenderName: 'Transfer limit',
          id: fixture.tenantId,
          maxActiveRegistrationsPerUser: 1,
          name: 'Transfer finalization limit',
          refundFeesOnCancellation: false,
          stripeAccountId: 'acct_transfer_limit',
          transferDeadlineHoursBeforeStart: 0,
        },
        user: {
          communicationEmail: 'recipient@example.com',
          email: 'recipient@example.com',
          id: fixture.recipientUserId,
          roleIds: [fixture.eligibleRoleId],
        },
      });
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: (result) => ({ result, status: 'success' as const }),
      }),
      Effect.provide(RegistrationTransferService.Default),
      Effect.provide(layer),
    ),
  );

const checkInCandidate = (
  layer: TestLayer,
  fixture: TransferLimitFixture,
  candidate: TransferCandidate,
  checkInTime: Date,
) =>
  Effect.runPromise(
    Database.use((database) =>
      database.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx
            .select({ id: eventRegistrations.id })
            .from(eventRegistrations)
            .where(
              and(
                eq(eventRegistrations.id, candidate.registrationId),
                eq(eventRegistrations.tenantId, fixture.tenantId),
              ),
            )
            .for('update');
          yield* ensureRegistrationMutationHasNoActiveTransfer(tx, {
            registrationId: candidate.registrationId,
            tenantId: fixture.tenantId,
          });
          yield* tx
            .update(eventRegistrations)
            .set({ checkInTime })
            .where(eq(eventRegistrations.id, candidate.registrationId));
        }),
      ),
    ).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: () => ({ status: 'success' as const }),
      }),
      Effect.provide(layer),
    ),
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

  it('releases an expired open offer exactly once when the source ticket is checked in', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    const candidate = fixture.candidates[0];
    if (!candidate) throw new Error('Expected a transfer candidate');
    await database
      .update(registrationTransfers)
      .set({
        expiresAt: new Date(Date.now() - 60_000),
        recipientBasePrice: null,
        recipientCheckoutTransactionId: null,
        recipientUserId: null,
        status: 'open',
      })
      .where(eq(registrationTransfers.id, candidate.transferId));

    const visibleBlockingTransfer =
      await database.query.registrationTransfers.findFirst({
        where: {
          RAW: registrationTransferOpenDeadlinePredicate,
          sourceRegistrationId: candidate.registrationId,
          status: { in: [...registrationTransferMutationBlockingStatuses] },
          tenantId: fixture.tenantId,
        },
      });
    expect(visibleBlockingTransfer).toBeUndefined();
    const paymentsBefore = await database.query.transactions.findMany({
      where: { tenantId: fixture.tenantId },
    });
    const checkInTime = new Date();
    expect(
      await checkInCandidate(layer, fixture, candidate, checkInTime),
    ).toEqual({
      status: 'success',
    });
    expect(
      await checkInCandidate(layer, fixture, candidate, checkInTime),
    ).toEqual({
      status: 'success',
    });

    const ticket = await database.query.eventRegistrations.findFirst({
      where: { id: candidate.registrationId, tenantId: fixture.tenantId },
    });
    expect(ticket).toMatchObject({
      checkInTime,
      status: 'CONFIRMED',
      userId: candidate.sourceUserId,
    });
    const offer = await database.query.registrationTransfers.findFirst({
      where: { id: candidate.transferId, tenantId: fixture.tenantId },
    });
    expect(offer).toMatchObject({
      expiredAt: expect.any(Date),
      recipientCheckoutTransactionId: null,
      recipientUserId: null,
      status: 'expired',
    });
    expect(
      await database.query.registrationTransferEvents.findMany({
        columns: { eventType: true, fromStatus: true, toStatus: true },
        where: { tenantId: fixture.tenantId, transferId: candidate.transferId },
      }),
    ).toEqual([
      { eventType: 'expired', fromStatus: 'open', toStatus: 'expired' },
    ]);
    expect(
      await database.query.transactions.findMany({
        where: { tenantId: fixture.tenantId },
      }),
    ).toEqual(paymentsBefore);
  });

  it.each(['open', 'checkout_pending'] as const)(
    'keeps %s offers blocking while an open offer is valid or Checkout needs reconciliation',
    async (status) => {
      const fixture = await seedTransferLimitFixture(database);
      fixtures.push(fixture);
      const candidate = fixture.candidates[0];
      if (!candidate) throw new Error('Expected a transfer candidate');
      await database
        .update(registrationTransfers)
        .set(
          status === 'open'
            ? {
                expiresAt: new Date(Date.now() + 60_000),
                recipientBasePrice: null,
                recipientCheckoutTransactionId: null,
                recipientUserId: null,
                status,
              }
            : { expiresAt: new Date(Date.now() - 60_000) },
        )
        .where(eq(registrationTransfers.id, candidate.transferId));
      const offerBefore = await database.query.registrationTransfers.findFirst({
        where: { id: candidate.transferId, tenantId: fixture.tenantId },
      });
      const visibleBlockingTransfer =
        await database.query.registrationTransfers.findFirst({
          where: {
            RAW: registrationTransferOpenDeadlinePredicate,
            sourceRegistrationId: candidate.registrationId,
            status: { in: [...registrationTransferMutationBlockingStatuses] },
            tenantId: fixture.tenantId,
          },
        });
      expect(visibleBlockingTransfer?.id).toBe(candidate.transferId);
      expect(
        await checkInCandidate(layer, fixture, candidate, new Date()),
      ).toMatchObject({
        error: { _tag: 'RegistrationTransferMutationConflict', status },
        status: 'failure',
      });
      expect(
        await database.query.registrationTransfers.findFirst({
          where: { id: candidate.transferId, tenantId: fixture.tenantId },
        }),
      ).toEqual(offerBefore);
      expect(
        await database.query.eventRegistrations.findFirst({
          where: { id: candidate.registrationId, tenantId: fixture.tenantId },
        }),
      ).toMatchObject({ checkInTime: null, userId: candidate.sourceUserId });
      expect(
        await database.query.registrationTransferEvents.findMany({
          where: {
            tenantId: fixture.tenantId,
            transferId: candidate.transferId,
          },
        }),
      ).toEqual([]);
    },
  );

  it.each([
    {
      allowed: false,
      optionDeadline: null,
      tenantDeadline: 24,
      title: 'current tenant default',
    },
    {
      allowed: false,
      optionDeadline: 24,
      tenantDeadline: 0,
      title: 'current option override',
    },
    {
      allowed: true,
      optionDeadline: 0,
      tenantDeadline: 24,
      title: 'explicit zero-hour option override',
    },
  ])(
    'rechecks the $title while claiming an older offer',
    async ({ allowed, optionDeadline, tenantDeadline }) => {
      const fixture = await seedTransferLimitFixture(database);
      fixtures.push(fixture);
      const candidate = fixture.candidates[0];
      if (!candidate) throw new Error('Expected a transfer candidate');
      const claimCredential = createRegistrationTransferClaimCode();
      const eventStart = new Date(Date.now() + 12 * 60 * 60 * 1000);
      await database
        .update(eventInstances)
        .set({ start: eventStart })
        .where(eq(eventInstances.id, candidate.eventId));
      await database
        .update(eventRegistrationOptions)
        .set({
          isPaid: false,
          price: 0,
          transferDeadlineHoursBeforeStart: optionDeadline,
        })
        .where(eq(eventRegistrationOptions.id, candidate.optionId));
      await database
        .update(registrationTransfers)
        .set({
          claimCodeHash: claimCredential.claimCodeHash,
          expiresAt: eventStart,
          recipientBasePrice: null,
          recipientCheckoutTransactionId: null,
          recipientUserId: null,
          status: 'open',
        })
        .where(eq(registrationTransfers.id, candidate.transferId));
      await database
        .delete(transactions)
        .where(eq(transactions.id, candidate.transactionId));
      await database
        .update(tenants)
        .set({ transferDeadlineHoursBeforeStart: tenantDeadline })
        .where(eq(tenants.id, fixture.tenantId));
      const offerBefore = await database.query.registrationTransfers.findFirst({
        where: { id: candidate.transferId, tenantId: fixture.tenantId },
      });
      const outcome = await claimOpenCandidate(
        layer,
        fixture,
        claimCredential.claimCode,
      );
      expect(outcome).toMatchObject(
        allowed
          ? { status: 'success' }
          : {
              error: {
                _tag: 'RegistrationTransferConflictError',
                message:
                  'The ticket transfer deadline has passed. No ticket transfer was started.',
              },
              status: 'failure',
            },
      );
      const offerAfter = await database.query.registrationTransfers.findFirst({
        where: { id: candidate.transferId, tenantId: fixture.tenantId },
      });
      if (allowed) {
        expect(offerAfter).toMatchObject({
          recipientUserId: fixture.recipientUserId,
          status: 'completed',
        });
      } else {
        expect(offerAfter).toEqual(offerBefore);
      }
      expect(
        await database.query.eventRegistrations.findFirst({
          where: { id: candidate.registrationId, tenantId: fixture.tenantId },
        }),
      ).toMatchObject({
        status: 'CONFIRMED',
        userId: allowed ? fixture.recipientUserId : candidate.sourceUserId,
      });
      expect(
        await database.query.transactions.findMany({
          where: {
            eventRegistrationId: candidate.registrationId,
            tenantId: fixture.tenantId,
          },
        }),
      ).toEqual([]);
      expect(
        await database.query.registrationAcquisitions.findMany({
          columns: { ownerUserId: true },
          orderBy: { ordinal: 'asc' },
          where: {
            registrationId: candidate.registrationId,
            tenantId: fixture.tenantId,
          },
        }),
      ).toEqual([
        { ownerUserId: candidate.sourceUserId },
        ...(allowed ? [{ ownerUserId: fixture.recipientUserId }] : []),
      ]);
    },
  );

  it('keeps an offer and both tickets unchanged when the recipient is waitlisted for the event', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    const candidate = fixture.candidates[0];
    if (!candidate) throw new Error('Expected a transfer candidate');
    const claimCredential = createRegistrationTransferClaimCode();

    await database
      .update(registrationTransfers)
      .set({
        claimCodeHash: claimCredential.claimCodeHash,
        recipientBasePrice: null,
        recipientCheckoutTransactionId: null,
        recipientUserId: null,
        status: 'open',
      })
      .where(eq(registrationTransfers.id, candidate.transferId));
    const waitlistRegistrationId = createId();
    await database.insert(eventRegistrations).values({
      eventId: candidate.eventId,
      id: waitlistRegistrationId,
      registrationOptionId: candidate.optionId,
      status: 'WAITLIST',
      tenantId: fixture.tenantId,
      userId: fixture.recipientUserId,
    });
    await database
      .update(eventRegistrationOptions)
      .set({ waitlistSpots: 1 })
      .where(eq(eventRegistrationOptions.id, candidate.optionId));

    const transferBefore = await database.query.registrationTransfers.findFirst(
      {
        columns: {
          claimCodeHash: true,
          recipientBasePrice: true,
          recipientCheckoutTransactionId: true,
          recipientUserId: true,
          sourceRegistrationId: true,
          sourceUserId: true,
          status: true,
        },
        where: { id: candidate.transferId, tenantId: fixture.tenantId },
      },
    );
    const registrationsBefore =
      await database.query.eventRegistrations.findMany({
        columns: {
          id: true,
          status: true,
          userId: true,
        },
        orderBy: { id: 'asc' },
        where: {
          eventId: candidate.eventId,
          tenantId: fixture.tenantId,
        },
      });
    const transactionsBefore = await database.query.transactions.findMany({
      columns: {
        id: true,
        sourceTransactionId: true,
        status: true,
        type: true,
      },
      orderBy: { id: 'asc' },
      where: { eventId: candidate.eventId, tenantId: fixture.tenantId },
    });
    const transferEventsBefore =
      await database.query.registrationTransferEvents.findMany({
        columns: {
          eventType: true,
          fromStatus: true,
          toStatus: true,
          transferId: true,
        },
        where: { tenantId: fixture.tenantId },
      });
    const acquisitionsBefore =
      await database.query.registrationAcquisitions.findMany({
        columns: {
          kind: true,
          ownerUserId: true,
          registrationId: true,
        },
        orderBy: { ordinal: 'asc' },
        where: {
          registrationId: candidate.registrationId,
          tenantId: fixture.tenantId,
        },
      });

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RegistrationTransferService;
        return yield* service.claim({
          answers: [],
          claimCode: claimCredential.claimCode,
          tenant: {
            cancellationDeadlineHoursBeforeStart: 24,
            currency: 'EUR',
            domain: `${fixture.tenantId}.transfer-limit.example`,
            emailSenderEmail: 'tickets@example.com',
            emailSenderName: 'Transfer limit',
            id: fixture.tenantId,
            maxActiveRegistrationsPerUser: 1,
            name: 'Transfer finalization limit',
            refundFeesOnCancellation: false,
            stripeAccountId: 'acct_transfer_limit',
            transferDeadlineHoursBeforeStart: 24,
          },
          user: {
            communicationEmail: 'recipient@example.com',
            email: 'recipient@example.com',
            id: fixture.recipientUserId,
            roleIds: [fixture.eligibleRoleId],
          },
        });
      }).pipe(
        Effect.match({
          onFailure: (error) => ({ error, status: 'failure' as const }),
          onSuccess: (result) => ({ result, status: 'success' as const }),
        }),
        Effect.provide(RegistrationTransferService.Default),
        Effect.provide(layer),
      ),
    );

    expect(outcome).toMatchObject({
      error: { _tag: 'RegistrationTransferConflictError' },
      status: 'failure',
    });
    if (outcome.status === 'failure') {
      expect(outcome.error).toBeInstanceOf(RegistrationTransferConflictError);
      expect(outcome.error.message).toBe(
        'You are already on the waitlist for this event. Leave the waitlist before accepting this ticket. The transfer was not accepted, and no payment or refund was started.',
      );
    }

    const [transferAfter, registrationsAfter, transactionsAfter] =
      await Promise.all([
        database.query.registrationTransfers.findFirst({
          columns: {
            claimCodeHash: true,
            recipientBasePrice: true,
            recipientCheckoutTransactionId: true,
            recipientUserId: true,
            sourceRegistrationId: true,
            sourceUserId: true,
            status: true,
          },
          where: { id: candidate.transferId, tenantId: fixture.tenantId },
        }),
        database.query.eventRegistrations.findMany({
          columns: {
            id: true,
            status: true,
            userId: true,
          },
          orderBy: { id: 'asc' },
          where: {
            eventId: candidate.eventId,
            tenantId: fixture.tenantId,
          },
        }),
        database.query.transactions.findMany({
          columns: {
            id: true,
            sourceTransactionId: true,
            status: true,
            type: true,
          },
          orderBy: { id: 'asc' },
          where: { eventId: candidate.eventId, tenantId: fixture.tenantId },
        }),
      ]);
    const [transferEventsAfter, acquisitionsAfter] = await Promise.all([
      database.query.registrationTransferEvents.findMany({
        columns: {
          eventType: true,
          fromStatus: true,
          toStatus: true,
          transferId: true,
        },
        where: { tenantId: fixture.tenantId },
      }),
      database.query.registrationAcquisitions.findMany({
        columns: {
          kind: true,
          ownerUserId: true,
          registrationId: true,
        },
        orderBy: { ordinal: 'asc' },
        where: {
          registrationId: candidate.registrationId,
          tenantId: fixture.tenantId,
        },
      }),
    ]);

    expect(transferBefore).toMatchObject({
      recipientCheckoutTransactionId: null,
      recipientUserId: null,
      sourceRegistrationId: candidate.registrationId,
      sourceUserId: candidate.sourceUserId,
      status: 'open',
    });
    expect(transferAfter).toEqual(transferBefore);
    expect(registrationsAfter).toEqual(registrationsBefore);
    expect(registrationsAfter).toEqual(
      expect.arrayContaining([
        {
          id: candidate.registrationId,
          status: 'CONFIRMED',
          userId: candidate.sourceUserId,
        },
        {
          id: waitlistRegistrationId,
          status: 'WAITLIST',
          userId: fixture.recipientUserId,
        },
      ]),
    );
    expect(transactionsAfter).toEqual(transactionsBefore);
    expect(transactionsAfter.filter(({ type }) => type === 'refund')).toEqual(
      [],
    );
    expect(transferEventsAfter).toEqual(transferEventsBefore);
    expect(acquisitionsAfter).toEqual(acquisitionsBefore);
    expect(acquisitionsAfter).toEqual([
      {
        kind: 'initial',
        ownerUserId: candidate.sourceUserId,
        registrationId: candidate.registrationId,
      },
    ]);
  });

  it('ignores waitlists when rechecking the recipient limit after payment', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    const transferCandidate = fixture.candidates[0];
    const waitlistCandidate = fixture.candidates[1];
    if (!transferCandidate || !waitlistCandidate) {
      throw new Error('Expected two transfer candidates');
    }

    await database.insert(eventRegistrations).values({
      eventId: waitlistCandidate.eventId,
      registrationOptionId: waitlistCandidate.optionId,
      status: 'WAITLIST',
      tenantId: fixture.tenantId,
      userId: fixture.recipientUserId,
    });
    await database
      .update(eventRegistrationOptions)
      .set({ waitlistSpots: 1 })
      .where(eq(eventRegistrationOptions.id, waitlistCandidate.optionId));

    const outcome = await finalizeCandidate(
      layer,
      fixture.tenantId,
      transferCandidate,
    );

    expect(outcome).toBe('finalized');
    const recipientRegistrations =
      await database.query.eventRegistrations.findMany({
        columns: { status: true },
        where: {
          tenantId: fixture.tenantId,
          userId: fixture.recipientUserId,
        },
      });
    expect(
      recipientRegistrations.map(({ status }) => status).toSorted(),
    ).toEqual(['CONFIRMED', 'WAITLIST']);
  });

  it('finalizes unlimited paid transfers while a compatible tenant settings lock is held', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    await database
      .update(tenants)
      .set({ maxActiveRegistrationsPerUser: 0 })
      .where(eq(tenants.id, fixture.tenantId));

    // Non-key tenant updates are compatible with KEY SHARE. Finalization must
    // finish before this transaction releases its row lock, without upgrading.
    const outcomes = await database.transaction(async (tenantTransaction) => {
      await tenantTransaction
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, fixture.tenantId))
        .for('no key update');
      const finalized = [];
      for (const candidate of fixture.candidates) {
        finalized.push(
          await Effect.runPromise(
            Database.use((effectDatabase) =>
              effectDatabase.transaction((tx) =>
                Effect.gen(function* () {
                  yield* tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
                  return yield* finalizeRegistrationTransferCheckout(tx, {
                    registrationId: candidate.registrationId,
                    tenantId: fixture.tenantId,
                    transactionId: candidate.transactionId,
                  });
                }),
              ),
            ).pipe(Effect.provide(layer)),
          ),
        );
      }
      return finalized;
    });

    expect(outcomes).toEqual(['finalized', 'finalized']);
    const recipientRegistrations = await database
      .select({ status: eventRegistrations.status })
      .from(eventRegistrations)
      .where(
        and(
          eq(eventRegistrations.tenantId, fixture.tenantId),
          eq(eventRegistrations.userId, fixture.recipientUserId),
        ),
      );
    expect(recipientRegistrations).toHaveLength(2);
    expect(
      recipientRegistrations.every(({ status }) => status === 'CONFIRMED'),
    ).toBe(true);
    const compensationClaims = await database
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, fixture.tenantId),
          eq(transactions.type, 'refund'),
        ),
      );
    expect(compensationClaims).toEqual([]);
  });

  it('preserves existing tenant RLS flags and owned policy when the visibility probe rolls back', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    const candidate = fixture.candidates[0];
    if (!candidate) throw new Error('Expected a transfer candidate');
    const roleName = `evorto_rls_sentinel_${createId()}`;
    const policyName = `transfer_rls_sentinel_${createId()}`;
    const rollbackComplete = new Error('Roll back the owned RLS fixture');

    await Effect.runPromise(
      Database.use((database) =>
        Effect.gen(function* () {
          const originalState = yield* readTenantPolicyState(database);
          expect(originalState).toEqual([
            { enabled: false, forced: false, hasPolicies: false },
          ]);
          const rollback = yield* Effect.exit(
            database.transaction((tx) =>
              Effect.gen(function* () {
                yield* tx.execute(
                  sql`LOCK TABLE public.tenants IN ACCESS EXCLUSIVE MODE`,
                );
                expect(yield* readTenantPolicyState(tx)).toEqual(originalState);
                yield* tx.execute(sql`
                  CREATE ROLE ${sql.identifier(roleName)}
                  NOLOGIN NOSUPERUSER NOBYPASSRLS
                `);
                yield* tx.execute(sql`
                  CREATE POLICY ${sql.identifier(policyName)} ON public.tenants
                  FOR SELECT TO ${sql.identifier(roleName)} USING (true)
                `);
                yield* tx.execute(
                  sql`ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY`,
                );
                yield* tx.execute(
                  sql`ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY`,
                );
                const existingState = yield* readTenantPolicyState(tx);
                expect(existingState).toEqual([
                  { enabled: true, forced: true, hasPolicies: true },
                ]);

                const rejected = yield* Effect.exit(
                  finalizeCandidateWithoutVisibleTenantSettings(
                    fixture.tenantId,
                    candidate,
                  ),
                );
                if (!Exit.isFailure(rejected)) {
                  return yield* Effect.die(
                    new Error(
                      'Expected the existing tenant policy to reject the probe',
                    ),
                  );
                }
                expect(Cause.squash(rejected.cause)).toMatchObject({
                  message:
                    'Tenant visibility fixture requires disabled row security and no policies',
                });
                expect(yield* readTenantPolicyState(tx)).toEqual(existingState);
                expect(
                  yield* tx
                    .select({ name: sql<string>`rolname` })
                    .from(sql`pg_roles`)
                    .where(sql`rolname = ${roleName}`),
                ).toEqual([{ name: roleName }]);
                expect(
                  yield* tx
                    .select({ name: sql<string>`polname` })
                    .from(sql`pg_policy`)
                    .where(
                      sql`polrelid = 'public.tenants'::regclass AND polname = ${policyName}`,
                    ),
                ).toEqual([{ name: policyName }]);
                return yield* Effect.fail(rollbackComplete);
              }),
            ),
          );
          if (!Exit.isFailure(rollback)) {
            return yield* Effect.die(
              new Error('Expected the owned RLS fixture rollback'),
            );
          }
          expect(Cause.squash(rollback.cause)).toBe(rollbackComplete);
          expect(yield* readTenantPolicyState(database)).toEqual(originalState);
          expect(
            yield* database
              .select({ name: sql<string>`rolname` })
              .from(sql`pg_roles`)
              .where(sql`rolname = ${roleName}`),
          ).toEqual([]);
          expect(
            yield* database
              .select({ name: sql<string>`polname` })
              .from(sql`pg_policy`)
              .where(
                sql`polrelid = 'public.tenants'::regclass AND polname = ${policyName}`,
              ),
          ).toEqual([]);
        }),
      ).pipe(Effect.provide(layer)),
    );
  });

  it('queues a full refund and keeps ownership unchanged when required tenant settings are missing after payment', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    const candidate = fixture.candidates[0];
    if (!candidate) throw new Error('Expected a transfer candidate');

    const outcome = await Effect.runPromise(
      finalizeCandidateWithoutVisibleTenantSettings(
        fixture.tenantId,
        candidate,
      ).pipe(Effect.provide(layer)),
    );
    expect(outcome).toBe('compensationQueued');

    const [registration, transfer, compensationClaims, acquisitions] =
      await Promise.all([
        database.query.eventRegistrations.findFirst({
          columns: { status: true, userId: true },
          where: { id: candidate.registrationId },
        }),
        database.query.registrationTransfers.findFirst({
          columns: {
            compensationRefundTransactionId: true,
            lastError: true,
            ownershipTransferredAt: true,
            status: true,
          },
          where: { id: candidate.transferId },
        }),
        database
          .select({
            amount: transactions.amount,
            sourceTransactionId: transactions.sourceTransactionId,
            stripeRefundApplicationFee: transactions.stripeRefundApplicationFee,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.sourceTransactionId, candidate.transactionId),
              eq(transactions.tenantId, fixture.tenantId),
              eq(transactions.type, 'refund'),
            ),
          ),
        database.query.registrationAcquisitions.findMany({
          columns: { kind: true, ownerUserId: true },
          orderBy: { ordinal: 'asc' },
          where: {
            registrationId: candidate.registrationId,
            tenantId: fixture.tenantId,
          },
        }),
      ]);

    expect(registration).toEqual({
      status: 'CONFIRMED',
      userId: candidate.sourceUserId,
    });
    expect(transfer).toMatchObject({
      lastError:
        'The organization could not be verified after payment; a full refund was queued and the ticket stayed with its previous holder.',
      ownershipTransferredAt: null,
      status: 'compensation_pending',
    });
    expect(transfer?.compensationRefundTransactionId).not.toBeNull();
    expect(compensationClaims).toEqual([
      {
        amount: -1000,
        sourceTransactionId: candidate.transactionId,
        stripeRefundApplicationFee: true,
      },
    ]);
    expect(acquisitions).toEqual([
      {
        kind: 'initial',
        ownerUserId: candidate.sourceUserId,
      },
    ]);
  });

  it('allows only one concurrent paid transfer across future events at a limit of one', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    const membershipLock: PoolClient = await lockRecipientMembership(
      pool,
      fixture,
    );
    let membershipLockCommitted = false;

    try {
      const finalizations = fixture.candidates.map((candidate) =>
        finalizeCandidate(layer, fixture.tenantId, candidate),
      );
      await waitForBlockedRecipientLocks(pool, 2);
      await membershipLock.query('COMMIT');
      membershipLockCommitted = true;

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
        if (!membershipLockCommitted) {
          await membershipLock.query('ROLLBACK');
        }
      } finally {
        membershipLock.release();
      }
    }
  }, 30_000);

  it('shares the canonical eligibility lock order with direct registration', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    const candidate = fixture.candidates[0];
    if (!candidate) throw new Error('Expected a transfer candidate');

    await database
      .update(eventRegistrationOptions)
      .set({ isPaid: false, price: 0, stripeTaxRateId: null })
      .where(eq(eventRegistrationOptions.id, candidate.optionId));
    const optionBefore =
      await database.query.eventRegistrationOptions.findFirst({
        columns: {
          confirmedSpots: true,
          reservedSpots: true,
        },
        where: { id: candidate.optionId },
      });
    expect(optionBefore).toBeTruthy();

    const eventLock = await lockTransferEvent(pool, candidate);
    let eventLockCommitted = false;
    try {
      const transferFinalization = finalizeCandidate(
        layer,
        fixture.tenantId,
        candidate,
      );
      await waitForBlockedEventLock(pool);

      const directRegistration = registerRecipientForCandidate(
        layer,
        fixture,
        candidate,
      );
      await waitForBlockedEligibilityLocks(pool, 2);
      await eventLock.query('COMMIT');
      eventLockCommitted = true;

      const [transferOutcome, directOutcome] = await Promise.all([
        transferFinalization,
        directRegistration,
      ]);
      expect(transferOutcome).toBe('finalized');
      expect(directOutcome).toMatchObject({
        error: {
          _tag: 'EventRegistrationConflictError',
          message: 'You are already signed up for this event.',
        },
        status: 'failure',
      });

      const [recipientRegistrations, transfer, optionAfter, acquisitions] =
        await Promise.all([
          database.query.eventRegistrations.findMany({
            columns: {
              id: true,
              status: true,
              userId: true,
            },
            where: {
              eventId: candidate.eventId,
              status: { NOT: 'CANCELLED' },
              tenantId: fixture.tenantId,
              userId: fixture.recipientUserId,
            },
          }),
          database.query.registrationTransfers.findFirst({
            columns: { status: true },
            where: { id: candidate.transferId, tenantId: fixture.tenantId },
          }),
          database.query.eventRegistrationOptions.findFirst({
            columns: {
              confirmedSpots: true,
              reservedSpots: true,
            },
            where: { id: candidate.optionId },
          }),
          database.query.registrationAcquisitions.findMany({
            columns: {
              kind: true,
              ownerUserId: true,
            },
            where: {
              registrationId: candidate.registrationId,
              tenantId: fixture.tenantId,
            },
          }),
        ]);
      expect(recipientRegistrations).toEqual([
        {
          id: candidate.registrationId,
          status: 'CONFIRMED',
          userId: fixture.recipientUserId,
        },
      ]);
      expect(transfer?.status).toBe('completed');
      expect(optionAfter).toEqual(optionBefore);
      expect(acquisitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'claim_transfer',
            ownerUserId: fixture.recipientUserId,
          }),
        ]),
      );

      const compensationClaims = await database
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.sourceTransactionId, candidate.transactionId),
            eq(transactions.tenantId, fixture.tenantId),
            eq(transactions.type, 'refund'),
          ),
        );
      expect(compensationClaims).toEqual([]);
    } finally {
      try {
        if (!eventLockCommitted) {
          await eventLock.query('ROLLBACK');
        }
      } finally {
        eventLock.release();
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

  it('compensates when the event stops being approved during Checkout', async () => {
    const fixture = await seedTransferLimitFixture(database);
    fixtures.push(fixture);
    const candidate = fixture.candidates[0];
    if (!candidate) throw new Error('Expected a transfer candidate');

    await database
      .update(eventInstances)
      .set({
        reviewedAt: null,
        reviewedBy: null,
        status: 'DRAFT',
        statusComment: null,
      })
      .where(eq(eventInstances.id, candidate.eventId));

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
});
