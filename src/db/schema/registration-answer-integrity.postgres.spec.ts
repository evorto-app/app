import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { DrizzleQueryError, inArray } from 'drizzle-orm';
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
  categoryIds: readonly [string, string];
  eventIds: readonly [string, string];
  optionIds: readonly [string, string, string];
  questionIds: readonly [string, string, string];
  registrationId: string;
  templateIds: readonly [string, string];
  tenantIds: readonly [string, string];
  userIds: readonly [string, string];
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeFixture = (): RegistrationAnswerFixture => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6);

  return {
    answerId: `ans-${suffix}`,
    categoryIds: [`cat-a-${suffix}`, `cat-b-${suffix}`],
    eventIds: [`evt-a-${suffix}`, `evt-b-${suffix}`],
    optionIds: [`opt-a1-${suffix}`, `opt-a2-${suffix}`, `opt-b-${suffix}`],
    questionIds: [`q-a1-${suffix}`, `q-a2-${suffix}`, `q-b-${suffix}`],
    registrationId: `reg-${suffix}`,
    templateIds: [`tpl-a-${suffix}`, `tpl-b-${suffix}`],
    tenantIds: [`ten-a-${suffix}`, `ten-b-${suffix}`],
    userIds: [`usr-a-${suffix}`, `usr-b-${suffix}`],
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

  await database.insert(tenants).values(
    fixture.tenantIds.map((tenantId, index) => ({
      domain: `${tenantId}.answer-integrity.example`,
      id: tenantId,
      name: `Answer integrity tenant ${index + 1}`,
    })),
  );
  await database.insert(users).values(
    fixture.userIds.map((userId, index) => ({
      auth0Id: `answer-integrity|${userId}`,
      communicationEmail: `${userId}@example.com`,
      email: `${userId}@example.com`,
      firstName: `Answer ${index + 1}`,
      id: userId,
      lastName: 'Integrity',
    })),
  );
  await database.insert(eventTemplateCategories).values(
    fixture.categoryIds.map((categoryId, index) => ({
      icon: { iconColor: 0, iconName: 'circle' },
      id: categoryId,
      tenantId: fixture.tenantIds[index],
      title: `Answer category ${index + 1}`,
    })),
  );
  await database.insert(eventTemplates).values(
    fixture.templateIds.map(
      (templateId, index) =>
        ({
          categoryId: fixture.categoryIds[index],
          description: 'Registration answer integrity fixture',
          icon: { iconColor: 0, iconName: 'circle' },
          id: templateId,
          listingAudience: 'both',
          tenantId: fixture.tenantIds[index],
          title: `Answer template ${index + 1}`,
        }) satisfies typeof eventTemplates.$inferInsert,
    ),
  );
  await database.insert(eventInstances).values(
    fixture.eventIds.map(
      (eventId, index) =>
        ({
          creatorId: fixture.userIds[index],
          description: 'Registration answer integrity fixture',
          end: new Date(now + 2 * 24 * 60 * 60 * 1000),
          icon: { iconColor: 0, iconName: 'circle' },
          id: eventId,
          listingAudience: 'both',
          start: new Date(now + 24 * 60 * 60 * 1000),
          templateId: fixture.templateIds[index],
          tenantId: fixture.tenantIds[index],
          title: `Answer event ${index + 1}`,
        }) satisfies typeof eventInstances.$inferInsert,
    ),
  );
  await database.insert(eventRegistrationOptions).values([
    {
      closeRegistrationTime: new Date(now + 12 * 60 * 60 * 1000),
      eventId: fixture.eventIds[0],
      id: fixture.optionIds[0],
      isPaid: false,
      openRegistrationTime: new Date(now - 60 * 60 * 1000),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      spots: 10,
      title: 'First event option',
    },
    {
      closeRegistrationTime: new Date(now + 12 * 60 * 60 * 1000),
      eventId: fixture.eventIds[0],
      id: fixture.optionIds[1],
      isPaid: false,
      openRegistrationTime: new Date(now - 60 * 60 * 1000),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      spots: 10,
      title: 'Second event option',
    },
    {
      closeRegistrationTime: new Date(now + 12 * 60 * 60 * 1000),
      eventId: fixture.eventIds[1],
      id: fixture.optionIds[2],
      isPaid: false,
      openRegistrationTime: new Date(now - 60 * 60 * 1000),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      spots: 10,
      title: 'Foreign tenant option',
    },
  ]);
  await database.insert(eventRegistrationQuestions).values([
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
      title: 'Foreign tenant question',
    },
  ]);
  await database.insert(eventRegistrations).values({
    eventId: fixture.eventIds[0],
    id: fixture.registrationId,
    registrationOptionId: fixture.optionIds[0],
    status: 'CONFIRMED',
    tenantId: fixture.tenantIds[0],
    userId: fixture.userIds[0],
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
    .where(inArray(eventRegistrations.tenantId, fixture.tenantIds));
  await database
    .delete(eventRegistrationOptions)
    .where(inArray(eventRegistrationOptions.id, fixture.optionIds));
  await database
    .delete(eventInstances)
    .where(inArray(eventInstances.id, fixture.eventIds));
  await database
    .delete(eventTemplates)
    .where(inArray(eventTemplates.id, fixture.templateIds));
  await database
    .delete(eventTemplateCategories)
    .where(inArray(eventTemplateCategories.id, fixture.categoryIds));
  await database.delete(users).where(inArray(users.id, fixture.userIds));
  await database.delete(tenants).where(inArray(tenants.id, fixture.tenantIds));
};

describe('registration answer integrity in PostgreSQL', () => {
  const fixture = makeFixture();
  let database: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
    await seedFixture(database, fixture);
  });

  afterAll(async () => {
    await cleanFixture(database, fixture);
    await pool.end();
  });

  it('rejects a question paired with an option from another event', async () => {
    await expectConstraintViolation({
      code: '23503',
      constraint: eventRegistrationQuestionOptionEventForeignKeyName,
      operation: database.insert(eventRegistrationQuestions).values({
        eventId: fixture.eventIds[0],
        id: `q-bad-${fixture.answerId.slice(-6)}`,
        registrationOptionId: fixture.optionIds[2],
        title: 'Mismatched event and option',
      }),
    });
  });

  it('rejects answers outside the question or registration owner tuple', async () => {
    await expectConstraintViolation({
      code: '23503',
      constraint: eventRegistrationAnswerQuestionOwnerForeignKeyName,
      operation: database.insert(eventRegistrationQuestionAnswers).values({
        answer: 'Question belongs to another event',
        eventId: fixture.eventIds[0],
        questionId: fixture.questionIds[2],
        registrationId: fixture.registrationId,
        registrationOptionId: fixture.optionIds[0],
        tenantId: fixture.tenantIds[0],
      }),
    });
    await expectConstraintViolation({
      code: '23503',
      constraint: eventRegistrationAnswerRegistrationOwnerForeignKeyName,
      operation: database.insert(eventRegistrationQuestionAnswers).values({
        answer: 'Question belongs to another option',
        eventId: fixture.eventIds[0],
        questionId: fixture.questionIds[1],
        registrationId: fixture.registrationId,
        registrationOptionId: fixture.optionIds[1],
        tenantId: fixture.tenantIds[0],
      }),
    });
    await expectConstraintViolation({
      code: '23503',
      constraint: eventRegistrationAnswerRegistrationOwnerForeignKeyName,
      operation: database.insert(eventRegistrationQuestionAnswers).values({
        answer: 'Question belongs to another tenant',
        eventId: fixture.eventIds[1],
        questionId: fixture.questionIds[2],
        registrationId: fixture.registrationId,
        registrationOptionId: fixture.optionIds[2],
        tenantId: fixture.tenantIds[1],
      }),
    });
  });

  it('accepts one scoped answer and rejects a duplicate', async () => {
    const answer = {
      answer: 'Matching registration answer',
      eventId: fixture.eventIds[0],
      questionId: fixture.questionIds[0],
      registrationId: fixture.registrationId,
      registrationOptionId: fixture.optionIds[0],
      tenantId: fixture.tenantIds[0],
    };

    await expect(
      database
        .insert(eventRegistrationQuestionAnswers)
        .values({ ...answer, id: fixture.answerId }),
    ).resolves.toBeDefined();
    await expectConstraintViolation({
      code: '23505',
      constraint:
        eventRegistrationAnswerRegistrationQuestionUniqueConstraintName,
      operation: database
        .insert(eventRegistrationQuestionAnswers)
        .values(answer),
    });
  });
});
