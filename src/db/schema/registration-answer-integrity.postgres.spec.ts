import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { DrizzleQueryError, eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import Stripe from 'stripe';

import { EventRegistrationService } from '../../server/effect/rpc/handlers/events/event-registration.service';
import { ensureAnsweredEventQuestionsUnchanged } from '../../server/registrations/event-question-answer-guard';
import { RegistrationTransferService } from '../../server/registrations/registration-transfer.service';
import { StripeClient } from '../../server/stripe-client';
import { Database, databaseLayer } from '../database.layer';
import { createNodePgPoolConfig } from '../pg-connection-config';
import { relations } from '../relations';
import {
  eventInstances,
  eventRegistrationAnswerQuestionOwnerForeignKeyName,
  eventRegistrationAnswerRegistrationOwnerForeignKeyName,
  eventRegistrationAnswerRegistrationQuestionUniqueConstraintName,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrationQuestionOptionEventForeignKeyName,
  eventRegistrationQuestions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  registrationTransferAnswers,
  registrationTransfers,
  tenants,
  users,
  usersToTenants,
} from './index';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

interface RegistrationAnswerFixture {
  answerId: string;
  categoryId: string;
  eventIds: readonly [string, string];
  optionIds: readonly [string, string, string];
  questionIds: readonly [string, string, string];
  registrationId: string;
  templateId: string;
  tenantIds: readonly [string, string];
  userId: string;
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeFixture = (): RegistrationAnswerFixture => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);

  return {
    answerId: `ans-${suffix}`,
    categoryId: `cat-${suffix}`,
    eventIds: [`evt-a-${suffix}`, `evt-b-${suffix}`],
    optionIds: [`opt-a1-${suffix}`, `opt-a2-${suffix}`, `opt-b-${suffix}`],
    questionIds: [`q-a1-${suffix}`, `q-a2-${suffix}`, `q-b-${suffix}`],
    registrationId: `reg-${suffix}`,
    templateId: `tpl-${suffix}`,
    tenantIds: [`ten-a-${suffix}`, `ten-b-${suffix}`],
    userId: `usr-${suffix}`,
  };
};

const expectConstraintViolation = async ({
  code,
  constraint,
  operation,
}: {
  code: '23503' | '23505';
  constraint: string;
  operation: PromiseLike<unknown>;
}) => {
  try {
    await operation;
    throw new Error(`Expected constraint ${constraint} to reject`);
  } catch (error) {
    expect(error).toBeInstanceOf(DrizzleQueryError);
    if (!(error instanceof DrizzleQueryError)) {
      throw error;
    }

    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause).toHaveProperty('code', code);
    expect(error.cause).toHaveProperty('constraint', constraint);
  }
};

const seedFixture = async (
  database: TestDatabase,
  fixture: RegistrationAnswerFixture,
) => {
  const now = Date.now();

  await database.transaction(async (transaction) => {
    await transaction.insert(tenants).values(
      fixture.tenantIds.map((tenantId, index) => ({
        domain: `${tenantId}.answer-integrity.example`,
        id: tenantId,
        name: `Answer integrity tenant ${index + 1}`,
      })),
    );
    await transaction.insert(users).values({
      auth0Id: `answer-integrity|${fixture.userId}`,
      communicationEmail: `${fixture.userId}@example.com`,
      email: `${fixture.userId}@example.com`,
      firstName: 'Answer',
      id: fixture.userId,
      lastName: 'Integrity',
    });
    await transaction.insert(eventTemplateCategories).values({
      icon: { iconColor: 0, iconName: 'circle' },
      id: fixture.categoryId,
      tenantId: fixture.tenantIds[0],
      title: 'Answer category',
    });
    await transaction.insert(eventTemplates).values({
      categoryId: fixture.categoryId,
      description: 'Registration answer integrity fixture',
      icon: { iconColor: 0, iconName: 'circle' },
      id: fixture.templateId,
      tenantId: fixture.tenantIds[0],
      title: 'Answer template',
    });
    await transaction.insert(eventInstances).values(
      fixture.eventIds.map(
        (eventId, index) =>
          ({
            creatorId: fixture.userId,
            description: 'Registration answer integrity fixture',
            end: new Date(now + 2 * 24 * 60 * 60 * 1000),
            icon: { iconColor: 0, iconName: 'circle' },
            id: eventId,
            start: new Date(now + 24 * 60 * 60 * 1000),
            templateId: fixture.templateId,
            tenantId: fixture.tenantIds[0],
            title: `Answer event ${index + 1}`,
          }) satisfies typeof eventInstances.$inferInsert,
      ),
    );
    const option = {
      closeRegistrationTime: new Date(now + 12 * 60 * 60 * 1000),
      eventId: fixture.eventIds[0],
      isPaid: false,
      openRegistrationTime: new Date(now - 60 * 60 * 1000),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      spots: 10,
      title: 'First event option',
    } satisfies typeof eventRegistrationOptions.$inferInsert;
    await transaction.insert(eventRegistrationOptions).values([
      { ...option, id: fixture.optionIds[0] },
      {
        ...option,
        id: fixture.optionIds[1],
        title: 'Second option in the same event',
      },
      {
        ...option,
        eventId: fixture.eventIds[1],
        id: fixture.optionIds[2],
        title: 'Another event in the same tenant',
      },
    ]);
    await transaction.insert(eventRegistrationQuestions).values([
      {
        eventId: fixture.eventIds[0],
        id: fixture.questionIds[0],
        registrationOptionId: fixture.optionIds[0],
        title: 'First option question',
      },
      {
        eventId: fixture.eventIds[0],
        id: fixture.questionIds[1],
        registrationOptionId: fixture.optionIds[1],
        title: 'Second option question',
      },
      {
        eventId: fixture.eventIds[1],
        id: fixture.questionIds[2],
        registrationOptionId: fixture.optionIds[2],
        title: 'Another event question',
      },
    ]);
    await transaction.insert(eventRegistrations).values({
      basePriceAtRegistration: 0,
      discountAmount: 0,
      eventId: fixture.eventIds[0],
      id: fixture.registrationId,
      registrationOptionId: fixture.optionIds[0],
      status: 'CONFIRMED',
      tenantId: fixture.tenantIds[0],
      userId: fixture.userId,
    });
  });
};

const cleanFixture = async (
  database: TestDatabase,
  fixture: RegistrationAnswerFixture,
) => {
  await database
    .delete(registrationTransferAnswers)
    .where(inArray(registrationTransferAnswers.tenantId, fixture.tenantIds));
  await database
    .delete(registrationTransfers)
    .where(inArray(registrationTransfers.tenantId, fixture.tenantIds));
  await database
    .delete(eventRegistrationQuestionAnswers)
    .where(
      inArray(eventRegistrationQuestionAnswers.tenantId, fixture.tenantIds),
    );
  await database
    .delete(eventRegistrationQuestions)
    .where(inArray(eventRegistrationQuestions.eventId, fixture.eventIds));
  await database
    .delete(eventRegistrations)
    .where(eq(eventRegistrations.id, fixture.registrationId));
  await database
    .delete(eventRegistrationOptions)
    .where(inArray(eventRegistrationOptions.id, fixture.optionIds));
  await database
    .delete(eventInstances)
    .where(inArray(eventInstances.id, fixture.eventIds));
  await database
    .delete(eventTemplates)
    .where(eq(eventTemplates.id, fixture.templateId));
  await database
    .delete(eventTemplateCategories)
    .where(eq(eventTemplateCategories.id, fixture.categoryId));
  await database
    .delete(usersToTenants)
    .where(eq(usersToTenants.userId, fixture.userId));
  await database.delete(users).where(eq(users.id, fixture.userId));
  await database.delete(tenants).where(inArray(tenants.id, fixture.tenantIds));
};

describe('registration answer integrity in PostgreSQL', () => {
  const fixture = makeFixture();
  const pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
  const database = drizzle({ client: pool, relations });
  const answer = {
    answer: 'Matching registration answer',
    eventId: fixture.eventIds[0],
    questionId: fixture.questionIds[0],
    registrationId: fixture.registrationId,
    registrationOptionId: fixture.optionIds[0],
    tenantId: fixture.tenantIds[0],
  } satisfies typeof eventRegistrationQuestionAnswers.$inferInsert;

  beforeAll(async () => {
    await seedFixture(database, fixture);
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    try {
      await cleanFixture(database, fixture);
    } catch (error) {
      failures.push(error);
    }
    try {
      await pool.end();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Failed to release registration answer fixtures',
        { cause: failures[0] },
      );
    }
  });

  it('rejects a question paired with an option from another event', async () => {
    await expectConstraintViolation({
      code: '23503',
      constraint: eventRegistrationQuestionOptionEventForeignKeyName,
      operation: database.insert(eventRegistrationQuestions).values({
        eventId: fixture.eventIds[0],
        registrationOptionId: fixture.optionIds[2],
        title: 'Mismatched event and option',
      }),
    });
  });

  it('rejects a question from another option in the same event', async () => {
    await expectConstraintViolation({
      code: '23503',
      constraint: eventRegistrationAnswerQuestionOwnerForeignKeyName,
      operation: database.insert(eventRegistrationQuestionAnswers).values({
        ...answer,
        questionId: fixture.questionIds[1],
      }),
    });
  });

  it('rejects a question from another event', async () => {
    await expectConstraintViolation({
      code: '23503',
      constraint: eventRegistrationAnswerQuestionOwnerForeignKeyName,
      operation: database.insert(eventRegistrationQuestionAnswers).values({
        ...answer,
        questionId: fixture.questionIds[2],
      }),
    });
  });

  it('rejects a matching question and option outside the registration option', async () => {
    await expectConstraintViolation({
      code: '23503',
      constraint: eventRegistrationAnswerRegistrationOwnerForeignKeyName,
      operation: database.insert(eventRegistrationQuestionAnswers).values({
        ...answer,
        questionId: fixture.questionIds[1],
        registrationOptionId: fixture.optionIds[1],
      }),
    });
  });

  it('rejects a matching question and option from another event in the same tenant', async () => {
    await expectConstraintViolation({
      code: '23503',
      constraint: eventRegistrationAnswerRegistrationOwnerForeignKeyName,
      operation: database.insert(eventRegistrationQuestionAnswers).values({
        ...answer,
        eventId: fixture.eventIds[1],
        questionId: fixture.questionIds[2],
        registrationOptionId: fixture.optionIds[2],
      }),
    });
  });

  it('rejects another tenant even when question, option, event, and registration match', async () => {
    await expectConstraintViolation({
      code: '23503',
      constraint: eventRegistrationAnswerRegistrationOwnerForeignKeyName,
      operation: database.insert(eventRegistrationQuestionAnswers).values({
        ...answer,
        tenantId: fixture.tenantIds[1],
      }),
    });
  });

  it('accepts one scoped answer and rejects a duplicate', async () => {
    try {
      const rows = await database
        .insert(eventRegistrationQuestionAnswers)
        .values({ ...answer, id: fixture.answerId })
        .returning();

      expect(rows).toEqual([
        expect.objectContaining({ ...answer, id: fixture.answerId }),
      ]);
      await expectConstraintViolation({
        code: '23505',
        constraint:
          eventRegistrationAnswerRegistrationQuestionUniqueConstraintName,
        operation: database
          .insert(eventRegistrationQuestionAnswers)
          .values(answer),
      });
    } finally {
      await database
        .delete(eventRegistrationQuestionAnswers)
        .where(
          eq(
            eventRegistrationQuestionAnswers.registrationId,
            fixture.registrationId,
          ),
        );
    }
  });
});

const questionRaceLayer = (url: string) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        BASE_URL: 'https://question-race.example',
        DATABASE_TLS_REQUIRED: 'false',
        DATABASE_URL: url,
      },
    }),
  );
  return Layer.mergeAll(
    config,
    databaseLayer.pipe(Layer.provide(config)),
    Layer.succeed(StripeClient, new Stripe('sk_test_question_race')),
  );
};

const waitForQuestionRaceLock = async (pool: Pool, blockerPid: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_stat_activity
       WHERE datname = current_database() AND state = 'active'
       AND wait_event_type = 'Lock' AND $1::int = ANY(pg_blocking_pids(pid))`,
      [blockerPid],
    );
    if (Number(blocked.rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out observing the question-history race lock');
};

// The blocked backend is observed before the winning transaction commits;
// these races do not rely on a sleep to assume that the other side started.
describe('question answer history concurrency in PostgreSQL', () => {
  const pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
  const database = drizzle({ client: pool, relations });
  const layer = questionRaceLayer(databaseUrl);
  afterAll(() => pool.end());

  for (const history of ['registration', 'transfer'] as const) {
    for (const mutation of ['remove', 'change'] as const) {
      it(`preserves ${history} history when an answer wins a question ${mutation}`, async () => {
        const fixture = makeFixture();
        await seedFixture(database, fixture);
        const client = await pool.connect();
        const writer = drizzle({ client, relations });
        let pending: Promise<unknown> | undefined;
        try {
          const before = await database
            .select()
            .from(eventRegistrationQuestions)
            .where(eq(eventRegistrationQuestions.id, fixture.questionIds[0]));
          const transferId = `tr-${fixture.registrationId}`;
          if (history === 'transfer') {
            await database.insert(registrationTransfers).values({
              claimCodeHash: randomUUID(),
              claimTokenHash: randomUUID(),
              eventId: fixture.eventIds[0],
              expiresAt: new Date(Date.now() + 60_000),
              id: transferId,
              registrationOptionId: fixture.optionIds[0],
              sourceRegistrationId: fixture.registrationId,
              sourceSpotCount: 1,
              sourceUserId: fixture.userId,
              tenantId: fixture.tenantIds[0],
            });
          }
          await client.query('BEGIN');
          const pidResult = await client.query<{ pid: number }>(
            'SELECT pg_backend_pid() AS pid',
          );
          const pid = pidResult.rows[0]?.pid;
          if (pid === undefined) throw new Error('Missing answer writer PID');
          const answer = {
            answer: 'Saved before mutation',
            eventId: fixture.eventIds[0],
            questionId: fixture.questionIds[0],
            registrationOptionId: fixture.optionIds[0],
            tenantId: fixture.tenantIds[0],
          };
          if (history === 'registration') {
            await writer
              .insert(eventRegistrationQuestionAnswers)
              .values({ ...answer, registrationId: fixture.registrationId });
          } else {
            await writer
              .insert(registrationTransferAnswers)
              .values({ ...answer, transferId });
          }
          const result = Effect.runPromise(
            Database.use((db) =>
              db.transaction((tx) =>
                Effect.gen(function* () {
                  yield* tx
                    .select({ id: eventInstances.id })
                    .from(eventInstances)
                    .where(eq(eventInstances.id, fixture.eventIds[0]))
                    .for('update');
                  yield* ensureAnsweredEventQuestionsUnchanged(tx, {
                    before,
                    submitted:
                      mutation === 'remove'
                        ? []
                        : before.map((question) => ({
                            ...question,
                            title: 'Changed meaning',
                          })),
                  });
                  if (mutation === 'remove') {
                    yield* tx
                      .delete(eventRegistrationQuestions)
                      .where(
                        eq(
                          eventRegistrationQuestions.id,
                          fixture.questionIds[0],
                        ),
                      );
                  } else {
                    yield* tx
                      .update(eventRegistrationQuestions)
                      .set({ title: 'Changed meaning' })
                      .where(
                        eq(
                          eventRegistrationQuestions.id,
                          fixture.questionIds[0],
                        ),
                      );
                  }
                }),
              ),
            ).pipe(
              Effect.match({
                onFailure: (error) => ({ error }),
                onSuccess: () => ({ success: true }),
              }),
              Effect.provide(layer),
            ),
          );
          pending = result;
          await waitForQuestionRaceLock(pool, pid);
          await client.query('COMMIT');
          expect(await result).toMatchObject({
            error: { _tag: 'RpcBadRequestError', reason: 'eventQuestionInUse' },
          });
          expect(
            await database
              .select({ title: eventRegistrationQuestions.title })
              .from(eventRegistrationQuestions)
              .where(eq(eventRegistrationQuestions.id, fixture.questionIds[0])),
          ).toEqual([{ title: 'First option question' }]);
          const saved =
            history === 'registration'
              ? await database
                  .select({ answer: eventRegistrationQuestionAnswers.answer })
                  .from(eventRegistrationQuestionAnswers)
                  .where(
                    eq(
                      eventRegistrationQuestionAnswers.questionId,
                      fixture.questionIds[0],
                    ),
                  )
              : await database
                  .select({ answer: registrationTransferAnswers.answer })
                  .from(registrationTransferAnswers)
                  .where(
                    eq(
                      registrationTransferAnswers.questionId,
                      fixture.questionIds[0],
                    ),
                  );
          expect(saved).toEqual([{ answer: 'Saved before mutation' }]);
        } finally {
          await client.query('ROLLBACK');
          client.release();
          if (pending) await pending;
          await cleanFixture(database, fixture);
        }
      }, 20_000);
    }
  }

  for (const writer of ['registration', 'waitlist'] as const) {
    for (const mutation of ['remove', 'require', 'add required'] as const) {
      it(`revalidates ${writer} answers when a question ${mutation} wins`, async () => {
        const fixture = makeFixture();
        await seedFixture(database, fixture);
        await database
          .update(eventRegistrations)
          .set({ status: 'CANCELLED' })
          .where(eq(eventRegistrations.id, fixture.registrationId));
        await database
          .insert(usersToTenants)
          .values({ tenantId: fixture.tenantIds[0], userId: fixture.userId });
        await database
          .update(eventInstances)
          .set({ reviewedAt: new Date(), status: 'APPROVED' })
          .where(eq(eventInstances.id, fixture.eventIds[0]));
        if (writer === 'waitlist')
          await database
            .update(eventRegistrationOptions)
            .set({ confirmedSpots: 10 })
            .where(eq(eventRegistrationOptions.id, fixture.optionIds[0]));
        if (mutation === 'require')
          await database
            .update(eventRegistrationQuestions)
            .set({ required: false })
            .where(eq(eventRegistrationQuestions.id, fixture.questionIds[0]));
        const client = await pool.connect();
        const editor = drizzle({ client, relations });
        let pending: Promise<unknown> | undefined;
        try {
          await client.query('BEGIN');
          const pidResult = await client.query<{ pid: number }>(
            'SELECT pg_backend_pid() AS pid',
          );
          const pid = pidResult.rows[0]?.pid;
          if (pid === undefined) throw new Error('Missing question editor PID');
          await editor
            .select({ id: eventInstances.id })
            .from(eventInstances)
            .where(eq(eventInstances.id, fixture.eventIds[0]))
            .for('update');
          if (mutation === 'remove') {
            await editor
              .delete(eventRegistrationQuestions)
              .where(eq(eventRegistrationQuestions.id, fixture.questionIds[0]));
          } else if (mutation === 'require') {
            await editor
              .update(eventRegistrationQuestions)
              .set({ required: true })
              .where(eq(eventRegistrationQuestions.id, fixture.questionIds[0]));
          } else {
            await editor.insert(eventRegistrationQuestions).values({
              eventId: fixture.eventIds[0],
              registrationOptionId: fixture.optionIds[0],
              required: true,
              title: 'New required question',
            });
          }
          const input = {
            answers:
              mutation === 'require'
                ? []
                : [
                    {
                      answer: 'Answer to old definition',
                      questionId: fixture.questionIds[0],
                    },
                  ],
            eventId: fixture.eventIds[0],
            guestCount: 0,
            registrationOptionId: fixture.optionIds[0],
            tenant: {
              currency: 'EUR' as const,
              domain: `${fixture.tenantIds[0]}.answer-integrity.example`,
              id: fixture.tenantIds[0],
              stripeAccountId: null,
            },
            user: {
              email: `${fixture.userId}@example.com`,
              id: fixture.userId,
              roleIds: [],
            },
          };
          const result = Effect.runPromise(
            (writer === 'registration'
              ? EventRegistrationService.registerForEvent(input)
              : EventRegistrationService.joinWaitlist(input)
            ).pipe(
              Effect.match({
                onFailure: (error) => ({ error }),
                onSuccess: () => ({ success: true }),
              }),
              Effect.provide(EventRegistrationService.Default),
              Effect.provide(layer),
            ),
          );
          pending = result;
          await waitForQuestionRaceLock(pool, pid);
          await client.query('COMMIT');
          expect(await result).toMatchObject({
            error: {
              _tag: 'EventRegistrationConflictError',
              message:
                mutation === 'remove'
                  ? 'Registration question does not belong to this option'
                  : 'Required registration question is missing',
            },
          });
          expect(
            await database
              .select({ status: eventRegistrations.status })
              .from(eventRegistrations)
              .where(eq(eventRegistrations.eventId, fixture.eventIds[0])),
          ).toEqual([{ status: 'CANCELLED' }]);
          expect(
            await database
              .select()
              .from(eventRegistrationQuestionAnswers)
              .where(
                eq(
                  eventRegistrationQuestionAnswers.eventId,
                  fixture.eventIds[0],
                ),
              ),
          ).toEqual([]);
          expect(
            await database
              .select({
                confirmed: eventRegistrationOptions.confirmedSpots,
                reserved: eventRegistrationOptions.reservedSpots,
                waitlist: eventRegistrationOptions.waitlistSpots,
              })
              .from(eventRegistrationOptions)
              .where(eq(eventRegistrationOptions.id, fixture.optionIds[0])),
          ).toEqual([
            {
              confirmed: writer === 'waitlist' ? 10 : 0,
              reserved: 0,
              waitlist: 0,
            },
          ]);
        } finally {
          await client.query('ROLLBACK');
          client.release();
          if (pending) await pending;
          await cleanFixture(database, fixture);
        }
      }, 20_000);
    }
  }
  it('lets an answer writer finish its option write while a transfer offer waits on tenant terms', async () => {
    const fixture = makeFixture();
    await seedFixture(database, fixture);
    await database
      .update(eventInstances)
      .set({ reviewedAt: new Date(), status: 'APPROVED' })
      .where(eq(eventInstances.id, fixture.eventIds[0]));
    const client = await pool.connect();
    const writer = drizzle({ client, relations });
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      const pidResult = await client.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const pid = pidResult.rows[0]?.pid;
      if (pid === undefined) throw new Error('Missing answer writer PID');
      await writer
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, fixture.tenantIds[0]))
        .for('key share');
      await writer
        .select({ id: eventInstances.id })
        .from(eventInstances)
        .where(eq(eventInstances.id, fixture.eventIds[0]))
        .for('share');
      const result = Effect.runPromise(
        RegistrationTransferService.use((service) =>
          service.createOffer({
            registrationId: fixture.registrationId,
            tenant: {
              cancellationDeadlineHoursBeforeStart: 0,
              currency: 'EUR',
              domain: `${fixture.tenantIds[0]}.answer-integrity.example`,
              id: fixture.tenantIds[0],
              maxActiveRegistrationsPerUser: 0,
              name: 'Question race tenant',
              refundFeesOnCancellation: false,
              stripeAccountId: null,
              transferDeadlineHoursBeforeStart: 0,
            },
            user: {
              communicationEmail: `${fixture.userId}@example.com`,
              email: `${fixture.userId}@example.com`,
              id: fixture.userId,
              roleIds: [],
            },
          }),
        ).pipe(
          Effect.match({
            onFailure: (error) => ({ error }),
            onSuccess: () => ({ success: true }),
          }),
          Effect.provide(RegistrationTransferService.Default),
          Effect.provide(layer),
        ),
      );
      pending = result;
      await waitForQuestionRaceLock(pool, pid);
      await writer
        .update(eventRegistrationOptions)
        .set({ spots: 11 })
        .where(eq(eventRegistrationOptions.id, fixture.optionIds[0]));
      await client.query('COMMIT');
      // The fixture deliberately has no acquisition. Reaching this typed guard
      // proves terms were read after the writer committed, without provider I/O.
      expect(await result).toMatchObject({
        error: {
          _tag: 'RegistrationTransferConflictError',
          message:
            'Registration payment ownership is not initialized for the current owner.',
        },
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
      if (pending) await pending;
      await cleanFixture(database, fixture);
    }
  }, 20_000);
});
