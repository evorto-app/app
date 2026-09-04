import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { DrizzleQueryError, eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

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
  tenants,
  users,
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
