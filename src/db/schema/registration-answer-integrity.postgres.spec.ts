import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { and, DrizzleQueryError, eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  Cause,
  ConfigProvider,
  Deferred,
  Effect,
  Exit,
  Layer,
  Result,
  Schema,
} from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import Stripe from 'stripe';

import { runDatabaseCleanups } from '../../../tests/support/utils/database-cleanup';
import { deleteRegistrationAcquisitionLedger } from '../../../tests/support/utils/registration-acquisition-cleanup';
import {
  seedFreeAddonRegistrationEvent,
  seedFreeRegistrationAddon,
} from '../../../tests/support/utils/seed-registration-addons';
import {
  Adapters,
  type ValidationResult,
} from '../../server/discounts/providers';
import { userDiscountCardLockStatement } from '../../server/discounts/user-discount-card-lock';
import { discountHandlers } from '../../server/effect/rpc/handlers/discounts.handlers';
import { EventRegistrationService } from '../../server/effect/rpc/handlers/events/event-registration.service';
import { RpcAccess } from '../../server/effect/rpc/handlers/shared/rpc-access.service';
import { ensureAnsweredEventQuestionsUnchanged } from '../../server/registrations/event-question-answer-guard';
import { RegistrationTransferService } from '../../server/registrations/registration-transfer.service';
import { StripeClient } from '../../server/stripe-client';
import {
  MAX_REGISTRATION_ANSWER_LENGTH,
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
} from '../../shared/registration-question-limits';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../shared/rpc-contracts/app-rpcs';
import {
  DiscountsRefreshMyCard,
  DiscountsUpsertMyCard,
} from '../../shared/rpc-contracts/app-rpcs/discounts.rpcs';
import { Tenant } from '../../types/custom/tenant';
import { User } from '../../types/custom/user';
import { Database, databaseLayer } from '../database.layer';
import { createNodePgPoolConfig } from '../pg-connection-config';
import { relations } from '../relations';
import {
  addonToEventRegistrationOptions,
  emailOutbox,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationAnswerQuestionOwnerForeignKeyName,
  eventRegistrationAnswerRegistrationOwnerForeignKeyName,
  eventRegistrationAnswerRegistrationQuestionUniqueConstraintName,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrationQuestionOptionEventForeignKeyName,
  eventRegistrationQuestions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  platformAuditEntries,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitions,
  registrationTransferAnswers,
  registrationTransfers,
  templateRegistrationOptions,
  templateRegistrationQuestions,
  tenants,
  tenantStripeTaxRates,
  transactions,
  userDiscountCards,
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
  transferId: string;
  userId: string;
}

type TestDatabase = NodePgDatabase<typeof relations>;

const recordFailure = (failures: unknown[], error: unknown) => {
  if (!failures.includes(error)) failures.push(error);
};

const trackFixtureOperation = <T>(
  operation: Promise<T>,
  settledOperations: Promise<void>[],
  failures: unknown[],
) => {
  settledOperations.push(
    (async () => {
      try {
        await operation;
      } catch (error) {
        recordFailure(failures, error);
      }
    })(),
  );
  return operation;
};

const throwCleanupFailures = (failures: unknown[]) => {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      'PostgreSQL fixture and cleanup failures',
    );
  }
};

const rollbackAndReleaseClient = async (
  client: PoolClient,
  failures: unknown[],
) => {
  let discard = false;
  try {
    await client.query('ROLLBACK');
  } catch (error) {
    discard = true;
    recordFailure(failures, error);
  }
  try {
    client.release(discard);
  } catch (error) {
    recordFailure(failures, error);
  }
};

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
    transferId: `tr-${suffix}`,
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
  includeFinancialHistory = true,
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
    await transaction.insert(templateRegistrationOptions).values({
      closeRegistrationOffset: 0,
      id: fixture.optionIds[0],
      isPaid: false,
      openRegistrationOffset: 24,
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      spots: 10,
      templateId: fixture.templateId,
      title: 'Template question option',
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
    if (includeFinancialHistory) {
      await transaction.insert(registrationAcquisitions).values({
        acquiredAt: new Date(now),
        eventId: fixture.eventIds[0],
        kind: 'initial',
        operationKey: `registration-initial:${fixture.registrationId}`,
        ordinal: 0,
        ownerUserId: fixture.userId,
        registrationId: fixture.registrationId,
        spotCount: 1,
        tenantId: fixture.tenantIds[0],
      });
      await transaction.insert(registrationTransfers).values({
        claimCodeHash: fixture.transferId.padEnd(64, 'a'),
        eventId: fixture.eventIds[0],
        expiresAt: new Date(now + 60_000),
        id: fixture.transferId,
        registrationOptionId: fixture.optionIds[0],
        sourceRegistrationId: fixture.registrationId,
        sourceSpotCount: 1,
        sourceUserId: fixture.userId,
        tenantId: fixture.tenantIds[0],
      });
    }
  });
};

const cleanFixture = async (
  database: TestDatabase,
  fixture: RegistrationAnswerFixture,
) => {
  await database
    .delete(emailOutbox)
    .where(inArray(emailOutbox.tenantId, fixture.tenantIds));
  await database
    .delete(platformAuditEntries)
    .where(inArray(platformAuditEntries.targetTenantId, fixture.tenantIds));
  await database
    .delete(registrationAcquisitionComponents)
    .where(
      inArray(registrationAcquisitionComponents.tenantId, fixture.tenantIds),
    );
  await database
    .delete(registrationAcquisitionPayments)
    .where(
      inArray(registrationAcquisitionPayments.tenantId, fixture.tenantIds),
    );
  await database
    .delete(registrationAcquisitions)
    .where(inArray(registrationAcquisitions.tenantId, fixture.tenantIds));
  await database
    .delete(eventRegistrationAddonPurchaseLots)
    .where(
      inArray(eventRegistrationAddonPurchaseLots.tenantId, fixture.tenantIds),
    );
  await database
    .delete(eventRegistrationAddonPurchases)
    .where(
      inArray(eventRegistrationAddonPurchases.tenantId, fixture.tenantIds),
    );
  await database
    .delete(transactions)
    .where(inArray(transactions.tenantId, fixture.tenantIds));
  await database
    .delete(registrationTransferAnswers)
    .where(inArray(registrationTransferAnswers.tenantId, fixture.tenantIds));
  await database
    .delete(registrationTransfers)
    .where(inArray(registrationTransfers.tenantId, fixture.tenantIds));
  await deleteRegistrationAcquisitionLedger({
    database,
    registrationIds: [fixture.registrationId],
    tenantId: fixture.tenantIds[0],
  });
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
    .delete(eventAddons)
    .where(inArray(eventAddons.eventId, fixture.eventIds));
  await database
    .delete(eventInstances)
    .where(inArray(eventInstances.id, fixture.eventIds));
  await database
    .delete(templateRegistrationQuestions)
    .where(eq(templateRegistrationQuestions.templateId, fixture.templateId));
  await database
    .delete(templateRegistrationOptions)
    .where(eq(templateRegistrationOptions.templateId, fixture.templateId));
  await database
    .delete(eventTemplates)
    .where(eq(eventTemplates.id, fixture.templateId));
  await database
    .delete(eventTemplateCategories)
    .where(eq(eventTemplateCategories.id, fixture.categoryId));
  await database
    .delete(usersToTenants)
    .where(eq(usersToTenants.userId, fixture.userId));
  await database
    .delete(userDiscountCards)
    .where(eq(userDiscountCards.userId, fixture.userId));
  await database
    .delete(tenantStripeTaxRates)
    .where(inArray(tenantStripeTaxRates.tenantId, fixture.tenantIds));
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

  const questionStorage = [
    {
      insert: (title: string, description: string) =>
        database
          .insert(eventRegistrationQuestions)
          .values({
            description,
            eventId: fixture.eventIds[0],
            registrationOptionId: fixture.optionIds[0],
            title,
          })
          .returning({
            description: eventRegistrationQuestions.description,
            title: eventRegistrationQuestions.title,
          }),
      name: 'event question',
    },
    {
      insert: (title: string, description: string) =>
        database
          .insert(templateRegistrationQuestions)
          .values({
            description,
            registrationOptionId: fixture.optionIds[0],
            templateId: fixture.templateId,
            title,
          })
          .returning({
            description: templateRegistrationQuestions.description,
            title: templateRegistrationQuestions.title,
          }),
      name: 'template question',
    },
  ];

  it.each(questionStorage)(
    'stores exact $name title and description limits',
    async (storage) => {
      const title = 'q'.repeat(MAX_REGISTRATION_QUESTION_TITLE_LENGTH);
      const description = 'd'.repeat(
        MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
      );
      await expect(storage.insert(title, description)).resolves.toEqual([
        { description, title },
      ]);
    },
  );

  it.each(questionStorage)(
    'rejects an oversized $name title',
    async (storage) => {
      await expect(
        storage.insert(
          'q'.repeat(MAX_REGISTRATION_QUESTION_TITLE_LENGTH + 1),
          'Description',
        ),
      ).rejects.toMatchObject({ cause: { code: '22001' } });
    },
  );

  it.each(questionStorage)(
    'rejects an oversized $name description',
    async (storage) => {
      await expect(
        storage.insert(
          'Question',
          'd'.repeat(MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH + 1),
        ),
      ).rejects.toMatchObject({ cause: { code: '22001' } });
    },
  );

  it('stores an answer at the exact character limit', async () => {
    const boundedAnswer = 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH);
    try {
      const rows = await database
        .insert(eventRegistrationQuestionAnswers)
        .values({ ...answer, answer: boundedAnswer })
        .returning({ answer: eventRegistrationQuestionAnswers.answer });
      expect(rows).toEqual([{ answer: boundedAnswer }]);
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

  it('rejects an answer above the character limit', async () => {
    await expect(
      database.insert(eventRegistrationQuestionAnswers).values({
        ...answer,
        answer: 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH + 1),
      }),
    ).rejects.toMatchObject({ cause: { code: '22001' } });
  });

  it('stores a transfer answer at the exact destination character limit', async () => {
    const boundedAnswer = 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH);
    try {
      const rows = await database
        .insert(registrationTransferAnswers)
        .values({
          answer: boundedAnswer,
          eventId: fixture.eventIds[0],
          questionId: fixture.questionIds[0],
          registrationOptionId: fixture.optionIds[0],
          tenantId: fixture.tenantIds[0],
          transferId: fixture.transferId,
        })
        .returning({ answer: registrationTransferAnswers.answer });
      expect(rows).toEqual([{ answer: boundedAnswer }]);
    } finally {
      await database
        .delete(registrationTransferAnswers)
        .where(eq(registrationTransferAnswers.transferId, fixture.transferId));
    }
  });

  it('rejects a transfer answer that cannot fit the destination storage', async () => {
    await expect(
      database.insert(registrationTransferAnswers).values({
        answer: 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH + 1),
        eventId: fixture.eventIds[0],
        questionId: fixture.questionIds[0],
        registrationOptionId: fixture.optionIds[0],
        tenantId: fixture.tenantIds[0],
        transferId: fixture.transferId,
      }),
    ).rejects.toMatchObject({ cause: { code: '22001' } });
  });

  const originalState = () =>
    Promise.all([
      database
        .select()
        .from(eventInstances)
        .where(inArray(eventInstances.id, fixture.eventIds)),
      database
        .select()
        .from(eventRegistrationOptions)
        .where(inArray(eventRegistrationOptions.id, fixture.optionIds)),
      database
        .select()
        .from(eventRegistrations)
        .where(eq(eventRegistrations.id, fixture.registrationId)),
      database
        .select()
        .from(registrationAcquisitions)
        .where(
          eq(registrationAcquisitions.registrationId, fixture.registrationId),
        ),
      database
        .select()
        .from(registrationAcquisitionComponents)
        .where(
          eq(
            registrationAcquisitionComponents.registrationId,
            fixture.registrationId,
          ),
        ),
      database
        .select()
        .from(eventRegistrationQuestionAnswers)
        .where(
          eq(
            eventRegistrationQuestionAnswers.registrationId,
            fixture.registrationId,
          ),
        ),
    ]);
  const fixtureWindow = () => ({
    closeRegistrationTime: new Date(Date.now() + 60_000),
    end: new Date(Date.now() + 180_000),
    openRegistrationTime: new Date(Date.now() - 60_000),
    start: new Date(Date.now() + 120_000),
  });

  it('leaves original registrations and acquisitions intact when owned setup fails', async () => {
    const before = await originalState();
    const cleanups: (() => Promise<void>)[] = [];
    const beforeEvents = await database
      .select({ id: eventInstances.id })
      .from(eventInstances)
      .where(eq(eventInstances.tenantId, fixture.tenantIds[0]));
    await expect(
      seedFreeAddonRegistrationEvent({
        database,
        registerDatabaseCleanup: (cleanup) => {
          cleanups.push(() => cleanup(database));
        },
        sourceEventId: fixture.eventIds[0],
        sourceOptionId: fixture.optionIds[0],
        tenantId: fixture.tenantIds[0],
        window: { ...fixtureWindow(), closeRegistrationTime: new Date(0) },
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    expect(cleanups).toHaveLength(1);
    await runDatabaseCleanups(cleanups, async () => {
      /* Suite teardown owns the pool. */
    });
    expect(await originalState()).toEqual(before);
    expect(
      await database
        .select({ id: eventInstances.id })
        .from(eventInstances)
        .where(eq(eventInstances.tenantId, fixture.tenantIds[0])),
    ).toEqual(beforeEvents);
  });

  it('cleans only the owned registration graph with the supplied database after the setup pool closes', async () => {
    const before = await originalState();
    const cleanups: (() => Promise<void>)[] = [];
    const setupPool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    const setupDatabase = drizzle({ client: setupPool, relations });
    const scenario = await seedFreeAddonRegistrationEvent({
      database: setupDatabase,
      registerDatabaseCleanup: (cleanup) => {
        cleanups.push(() => cleanup(database));
      },
      sourceEventId: fixture.eventIds[0],
      sourceOptionId: fixture.optionIds[0],
      tenantId: fixture.tenantIds[0],
      window: fixtureWindow(),
    }).finally(() => setupPool.end());
    try {
      const [registration] = await database
        .insert(eventRegistrations)
        .values({
          basePriceAtRegistration: 0,
          discountAmount: 0,
          eventId: scenario.eventId,
          registrationOptionId: scenario.optionId,
          status: 'CONFIRMED',
          tenantId: fixture.tenantIds[0],
          userId: fixture.userId,
        })
        .returning();
      if (!registration) throw new Error('Expected owned registration');
      const [acquisition] = await database
        .insert(registrationAcquisitions)
        .values({
          acquiredAt: new Date(),
          eventId: scenario.eventId,
          kind: 'initial',
          operationKey: `registration-initial:${registration.id}`,
          ordinal: 0,
          ownerUserId: fixture.userId,
          registrationId: registration.id,
          spotCount: 1,
          tenantId: fixture.tenantIds[0],
        })
        .returning();
      if (!acquisition) throw new Error('Expected owned acquisition');
      await database.insert(registrationAcquisitionComponents).values({
        acquiredAt: new Date(),
        acquisitionId: acquisition.id,
        allocationKey: `registration-initial:${registration.id}`,
        applicationFeeAmount: 0,
        baseAmount: 0,
        currency: 'EUR',
        eventId: scenario.eventId,
        grossAmount: 0,
        kind: 'registration',
        netAmount: 0,
        quantity: 1,
        registrationId: registration.id,
        stripeFeeAmount: 0,
        taxAmount: 0,
        tenantId: fixture.tenantIds[0],
      });
      const addonId = `addon-${fixture.registrationId.slice(-10)}`;
      await seedFreeRegistrationAddon({
        addonId,
        database,
        eventId: scenario.eventId,
        registrationOptionId: scenario.optionId,
      });
      await database.insert(eventRegistrationAddonPurchases).values({
        addonId,
        eventId: scenario.eventId,
        includedQuantity: 0,
        purchasedQuantity: 1,
        quantity: 1,
        registrationId: registration.id,
        registrationOptionId: scenario.optionId,
        tenantId: fixture.tenantIds[0],
        unitPrice: 0,
      });
      const [question] = await database
        .insert(eventRegistrationQuestions)
        .values({
          eventId: scenario.eventId,
          registrationOptionId: scenario.optionId,
          title: 'Owned question',
        })
        .returning();
      if (!question) throw new Error('Expected owned question');
      await database.insert(eventRegistrationQuestionAnswers).values({
        answer: 'Owned answer',
        eventId: scenario.eventId,
        questionId: question.id,
        registrationId: registration.id,
        registrationOptionId: scenario.optionId,
        tenantId: fixture.tenantIds[0],
      });
    } finally {
      await runDatabaseCleanups(cleanups, async () => {
        /* Suite teardown owns the pool. */
      });
    }
    await runDatabaseCleanups(cleanups, async () => {
      /* Suite teardown owns the pool. */
    });
    expect(await originalState()).toEqual(before);
    expect(
      await database
        .select()
        .from(eventInstances)
        .where(eq(eventInstances.id, scenario.eventId)),
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(registrationAcquisitions)
        .where(eq(registrationAcquisitions.eventId, scenario.eventId)),
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(registrationAcquisitionComponents)
        .where(eq(registrationAcquisitionComponents.eventId, scenario.eventId)),
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(eventAddons)
        .where(eq(eventAddons.eventId, scenario.eventId)),
    ).toEqual([]);
  });
});

const questionRaceLayer = (
  url: string,
  stripe = new Stripe('sk_test_question_race'),
  pinnedNowIso?: string,
) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        BASE_URL: 'https://question-race.example',
        DATABASE_TLS_REQUIRED: 'false',
        DATABASE_URL: url,
        ...(pinnedNowIso && { E2E_NOW_ISO: pinnedNowIso }),
      },
    }),
  );
  return Layer.mergeAll(
    config,
    databaseLayer.pipe(Layer.provide(config)),
    Layer.succeed(StripeClient, stripe),
  );
};

const waitForQuestionRaceLock = async (pool: Pool, blockerPid: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE datname = current_database() AND state = 'active'
       AND wait_event_type = 'Lock' AND $1::int = ANY(pg_blocking_pids(pid))
       ORDER BY pid`,
      [blockerPid],
    );
    const waitingPid = blocked.rows[0]?.pid;
    if (waitingPid !== undefined) return waitingPid;
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
        await seedFixture(database, fixture, false);
        const client = await pool.connect();
        const writer = drizzle({ client, relations });
        const failures: unknown[] = [];
        const settledOperations: Promise<void>[] = [];
        try {
          const before = await database
            .select()
            .from(eventRegistrationQuestions)
            .where(eq(eventRegistrationQuestions.id, fixture.questionIds[0]));
          const transferId = `tr-${fixture.registrationId}`;
          if (history === 'transfer') {
            await database.insert(registrationTransfers).values({
              claimCodeHash: randomUUID(),
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
          trackFixtureOperation(result, settledOperations, failures);
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
        } catch (error) {
          recordFailure(failures, error);
        } finally {
          await rollbackAndReleaseClient(client, failures);
          await Promise.all(settledOperations);
          try {
            await cleanFixture(database, fixture);
          } catch (error) {
            recordFailure(failures, error);
          }
        }
        throwCleanupFailures(failures);
      }, 20_000);
    }
  }

  for (const writer of ['registration', 'waitlist'] as const) {
    for (const mutation of ['remove', 'require', 'add required'] as const) {
      it(`revalidates ${writer} answers when a question ${mutation} wins`, async () => {
        const fixture = makeFixture();
        await seedFixture(database, fixture, false);
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
        const failures: unknown[] = [];
        const settledOperations: Promise<void>[] = [];
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
              maxActiveRegistrationsPerUser: 0,
              name: 'Question race tenant',
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
          trackFixtureOperation(result, settledOperations, failures);
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
        } catch (error) {
          recordFailure(failures, error);
        } finally {
          await rollbackAndReleaseClient(client, failures);
          await Promise.all(settledOperations);
          try {
            await cleanFixture(database, fixture);
          } catch (error) {
            recordFailure(failures, error);
          }
        }
        throwCleanupFailures(failures);
      }, 20_000);
    }
  }
  it('lets an answer writer finish its option write while a transfer offer waits on tenant terms', async () => {
    const fixture = makeFixture();
    await seedFixture(database, fixture, false);
    await database
      .update(eventInstances)
      .set({ reviewedAt: new Date(), status: 'APPROVED' })
      .where(eq(eventInstances.id, fixture.eventIds[0]));
    const client = await pool.connect();
    const writer = drizzle({ client, relations });
    const failures: unknown[] = [];
    const settledOperations: Promise<void>[] = [];
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
      trackFixtureOperation(result, settledOperations, failures);
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
            'The payment history for this ticket is incomplete, so it cannot be transferred. No ticket transfer or refund was started. Ask an organizer for help.',
        },
      });
    } catch (error) {
      recordFailure(failures, error);
    } finally {
      await rollbackAndReleaseClient(client, failures);
      await Promise.all(settledOperations);
      try {
        await cleanFixture(database, fixture);
      } catch (error) {
        recordFailure(failures, error);
      }
    }
    throwCleanupFailures(failures);
  }, 20_000);
});

type AdmissionSnapshotMutation =
  | 'add-on free to paid'
  | 'add-on price'
  | 'add-on quantities'
  | 'add-on removal'
  | 'card becomes verified'
  | 'card invalidation'
  | 'card removal'
  | 'card validity window'
  | 'closing window'
  | 'discount'
  | 'event start'
  | 'event status'
  | 'expired card becomes verified'
  | 'first verified card'
  | 'free to paid'
  | 'invalid card becomes verified'
  | 'price'
  | 'provider disabled';

type AdmissionSnapshotWriter = 'manual approval' | 'registration' | 'waitlist';

const discountEligibilityMutations = new Set<AdmissionSnapshotMutation>([
  'card becomes verified',
  'card invalidation',
  'card removal',
  'card validity window',
  'expired card becomes verified',
  'first verified card',
  'invalid card becomes verified',
  'provider disabled',
]);

const admissionSnapshotNow = new Date('2026-10-01T10:00:00.000Z');
const admissionSnapshotEventStart = new Date('2026-10-02T10:00:00.000Z');

class AdmissionSnapshotStripeHttpClient extends Stripe.HttpClient {
  requestCount = 0;

  override getClientName() {
    return 'registration-admission-snapshot-test';
  }

  override makeRequest(): Promise<Stripe.HttpClientResponse> {
    this.requestCount++;
    return Promise.reject(
      new Error('Unexpected Stripe request during stale admission'),
    );
  }
}

const seedAdmissionSnapshotFixture = async (
  database: TestDatabase,
  fixture: RegistrationAnswerFixture,
  writer: AdmissionSnapshotWriter,
  mutation: AdmissionSnapshotMutation,
) => {
  await seedFixture(database, fixture);
  const stripeAccountId = `acct_${fixture.tenantIds[0]}`;
  const stripeTaxRateId = `txr_${fixture.optionIds[0]}`;
  const usesDiscount =
    mutation === 'discount' ||
    mutation === 'event start' ||
    discountEligibilityMutations.has(mutation);
  const usesAddon = mutation.startsWith('add-on ');
  const addonId = `add-${fixture.userId}`;
  await database
    .update(tenants)
    .set({
      discountProviders: {
        esnCard: {
          config: {},
          status: usesDiscount ? 'enabled' : 'disabled',
        },
      },
      stripeAccountId,
    })
    .where(eq(tenants.id, fixture.tenantIds[0]));
  await database.insert(tenantStripeTaxRates).values({
    active: true,
    inclusive: true,
    percentage: '0',
    stripeAccountId,
    stripeTaxRateId,
    tenantId: fixture.tenantIds[0],
  });
  await database.insert(usersToTenants).values({
    tenantId: fixture.tenantIds[0],
    userId: fixture.userId,
  });
  await database
    .update(eventInstances)
    .set({
      end: new Date('2026-10-05T10:00:00.000Z'),
      reviewedAt: admissionSnapshotNow,
      start: admissionSnapshotEventStart,
      status: 'APPROVED',
    })
    .where(eq(eventInstances.id, fixture.eventIds[0]));
  const initiallyPaid =
    writer !== 'waitlist' && mutation !== 'free to paid' && !usesAddon;
  await database
    .update(eventRegistrationOptions)
    .set({
      closeRegistrationTime: new Date('2026-10-01T20:00:00.000Z'),
      confirmedSpots: writer === 'waitlist' ? 10 : 0,
      isPaid: initiallyPaid,
      openRegistrationTime: new Date('2026-09-30T10:00:00.000Z'),
      price: initiallyPaid ? 1000 : 0,
      registrationMode: writer === 'manual approval' ? 'application' : 'fcfs',
      stripeTaxRateId: initiallyPaid ? stripeTaxRateId : null,
    })
    .where(eq(eventRegistrationOptions.id, fixture.optionIds[0]));
  await database
    .update(eventRegistrations)
    .set({
      basePriceAtRegistration:
        writer === 'manual approval' ? null : initiallyPaid ? 1000 : 0,
      discountAmount: writer === 'manual approval' ? null : 0,
      status: writer === 'manual approval' ? 'PENDING' : 'CANCELLED',
    })
    .where(eq(eventRegistrations.id, fixture.registrationId));
  if (writer === 'manual approval') {
    await database.insert(eventRegistrationQuestionAnswers).values({
      answer: 'Existing manual application answer',
      eventId: fixture.eventIds[0],
      questionId: fixture.questionIds[0],
      registrationId: fixture.registrationId,
      registrationOptionId: fixture.optionIds[0],
      tenantId: fixture.tenantIds[0],
    });
  }
  if (usesDiscount) {
    await database
      .update(tenants)
      .set({
        discountProviders: { esnCard: { config: {}, status: 'enabled' } },
      })
      .where(eq(tenants.id, fixture.tenantIds[1]));
    await database.insert(usersToTenants).values({
      tenantId: fixture.tenantIds[1],
      userId: fixture.userId,
    });
    if (mutation !== 'first verified card') {
      const status =
        mutation === 'card becomes verified'
          ? 'unverified'
          : mutation === 'invalid card becomes verified'
            ? 'invalid'
            : mutation === 'expired card becomes verified'
              ? 'expired'
              : 'verified';
      const hasValidityWindow = status === 'verified' || status === 'expired';
      await database.insert(userDiscountCards).values({
        identifier: `card-${fixture.userId}`,
        status,
        type: 'esnCard',
        userId: fixture.userId,
        validFrom: hasValidityWindow
          ? new Date('2026-09-01T00:00:00.000Z')
          : null,
        validTo:
          status === 'expired'
            ? new Date('2026-09-30T00:00:00.000Z')
            : status === 'verified'
              ? new Date('2026-10-03T00:00:00.000Z')
              : null,
      });
    }
    await database.insert(eventRegistrationOptionDiscounts).values({
      discountedPrice: mutation === 'provider disabled' ? 0 : 500,
      discountType: 'esnCard',
      eventId: fixture.eventIds[0],
      registrationOptionId: fixture.optionIds[0],
    });
  }
  if (usesAddon) {
    const addonIsPaid = mutation !== 'add-on free to paid';
    await database.insert(eventAddons).values({
      allowMultiple: true,
      allowPurchaseBeforeEvent: false,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      eventId: fixture.eventIds[0],
      id: addonId,
      isPaid: addonIsPaid,
      maxQuantityPerUser: 3,
      price: addonIsPaid ? 300 : 0,
      stripeTaxRateId: addonIsPaid ? stripeTaxRateId : null,
      title: 'Selected admission add-on',
      totalAvailableQuantity: 10,
    });
    await database.insert(addonToEventRegistrationOptions).values({
      addonId,
      eventId: fixture.eventIds[0],
      includedQuantity: 1,
      optionalPurchaseQuantity: 2,
      registrationOptionId: fixture.optionIds[0],
    });
  }
  return {
    addOns: usesAddon ? [{ addOnId: addonId, quantity: 1 }] : [],
    stripeAccountId,
    stripeTaxRateId,
  };
};

const readAdmissionSnapshotEffects = async (
  database: TestDatabase,
  fixture: RegistrationAnswerFixture,
) => {
  const [
    registrations,
    capacity,
    answers,
    payments,
    acquisitions,
    acquisitionComponents,
    acquisitionPayments,
    emails,
    audit,
    addonStock,
    addonPurchases,
    addonLots,
  ] = await Promise.all([
    database
      .select()
      .from(eventRegistrations)
      .where(eq(eventRegistrations.tenantId, fixture.tenantIds[0]))
      .orderBy(eventRegistrations.id),
    database
      .select({
        checkedInSpots: eventRegistrationOptions.checkedInSpots,
        confirmedSpots: eventRegistrationOptions.confirmedSpots,
        id: eventRegistrationOptions.id,
        reservedSpots: eventRegistrationOptions.reservedSpots,
        waitlistSpots: eventRegistrationOptions.waitlistSpots,
      })
      .from(eventRegistrationOptions)
      .where(inArray(eventRegistrationOptions.id, fixture.optionIds))
      .orderBy(eventRegistrationOptions.id),
    database
      .select()
      .from(eventRegistrationQuestionAnswers)
      .where(
        eq(eventRegistrationQuestionAnswers.tenantId, fixture.tenantIds[0]),
      )
      .orderBy(eventRegistrationQuestionAnswers.id),
    database
      .select()
      .from(transactions)
      .where(eq(transactions.tenantId, fixture.tenantIds[0]))
      .orderBy(transactions.id),
    database
      .select()
      .from(registrationAcquisitions)
      .where(eq(registrationAcquisitions.tenantId, fixture.tenantIds[0]))
      .orderBy(registrationAcquisitions.id),
    database
      .select()
      .from(registrationAcquisitionComponents)
      .where(
        eq(registrationAcquisitionComponents.tenantId, fixture.tenantIds[0]),
      )
      .orderBy(registrationAcquisitionComponents.id),
    database
      .select()
      .from(registrationAcquisitionPayments)
      .where(eq(registrationAcquisitionPayments.tenantId, fixture.tenantIds[0]))
      .orderBy(registrationAcquisitionPayments.id),
    database
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.tenantId, fixture.tenantIds[0]))
      .orderBy(emailOutbox.id),
    database
      .select()
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.targetTenantId, fixture.tenantIds[0]))
      .orderBy(platformAuditEntries.id),
    database
      .select({
        id: eventAddons.id,
        quantity: eventAddons.totalAvailableQuantity,
      })
      .from(eventAddons)
      .where(eq(eventAddons.eventId, fixture.eventIds[0]))
      .orderBy(eventAddons.id),
    database
      .select()
      .from(eventRegistrationAddonPurchases)
      .where(eq(eventRegistrationAddonPurchases.tenantId, fixture.tenantIds[0]))
      .orderBy(eventRegistrationAddonPurchases.id),
    database
      .select()
      .from(eventRegistrationAddonPurchaseLots)
      .where(
        eq(eventRegistrationAddonPurchaseLots.tenantId, fixture.tenantIds[0]),
      )
      .orderBy(eventRegistrationAddonPurchaseLots.id),
  ]);
  return {
    acquisitionComponents,
    acquisitionPayments,
    acquisitions,
    addonLots,
    addonPurchases,
    addonStock,
    answers,
    audit,
    capacity,
    emails,
    payments,
    registrations,
  };
};

const admissionCardRequestContext = (tenant: Tenant, userId: string) =>
  ({
    authData: {},
    authenticated: true,
    permissions: [],
    platformAuthority: null,
    tenant,
    user: Schema.decodeUnknownSync(User)({
      attributes: [],
      auth0Id: `answer-integrity|${userId}`,
      communicationEmail: `${userId}@example.com`,
      email: `${userId}@example.com`,
      firstName: 'Answer',
      id: userId,
      lastName: 'Integrity',
      permissions: [],
      roleIds: [],
    }),
    userAssigned: true,
  }) satisfies RpcRequestContextShape;

const startAdmissionCardInvalidation = async (
  database: TestDatabase,
  fixture: RegistrationAnswerFixture,
  layer: ReturnType<typeof questionRaceLayer>,
) => {
  const [storedTenant] = await database
    .select()
    .from(tenants)
    .where(eq(tenants.id, fixture.tenantIds[1]));
  const tenant = Schema.decodeUnknownSync(Tenant)(storedTenant);
  const validationStarted = Effect.runSync(Deferred.make<undefined>());
  const releaseValidation = Effect.runSync(Deferred.make<ValidationResult>());
  const invalidResult: ValidationResult = {
    metadata: { provider: 'synthetic-admission-test' },
    status: 'invalid',
  };
  let validationCalls = 0;
  const originalAdapter = Adapters.esnCard;
  Adapters.esnCard = {
    validate: ({ identifier }) => {
      expect(identifier).toBe(`card-${fixture.userId}`);
      validationCalls++;
      Effect.runSync(Deferred.succeed(validationStarted, undefined));
      return Effect.runPromise(Deferred.await(releaseValidation));
    },
  };
  const refreshResult = Effect.runPromise(
    discountHandlers['discounts.refreshMyCard'](
      { type: 'esnCard' },
      {
        client: new Rpc.ServerClient(1),
        headers: Headers.empty,
        requestId: RpcMessage.RequestId(1),
        rpc: DiscountsRefreshMyCard.middleware(RpcRequestContextMiddleware),
      },
    ).pipe(
      Effect.provide(RpcAccess.Default),
      Effect.provideService(
        RpcRequestContext,
        admissionCardRequestContext(tenant, fixture.userId),
      ),
      Effect.provide(layer),
    ),
  );
  try {
    // The real handler has invoked its synthetic provider before opening its
    // short write transaction and acquiring any of its database locks.
    await Promise.race([
      Effect.runPromise(Deferred.await(validationStarted)),
      refreshResult.then(() => {
        throw new Error(
          'Card refresh finished before provider validation release',
        );
      }),
    ]);
  } catch (error) {
    Effect.runSync(Deferred.succeed(releaseValidation, invalidResult));
    Adapters.esnCard = originalAdapter;
    throw error;
  }
  return {
    cleanup: async () => {
      Effect.runSync(Deferred.succeed(releaseValidation, invalidResult));
      try {
        await refreshResult;
      } finally {
        Adapters.esnCard = originalAdapter;
      }
    },
    complete: async () => {
      Effect.runSync(Deferred.succeed(releaseValidation, invalidResult));
      expect(await refreshResult).toMatchObject({
        status: 'invalid',
        validTo: null,
      });
      expect(validationCalls).toBe(1);
    },
    releaseValidation: () =>
      Effect.runSync(Deferred.succeed(releaseValidation, invalidResult)),
  };
};

const changeAdmissionSnapshot = async (
  editor: TestDatabase,
  fixture: RegistrationAnswerFixture,
  mutation: AdmissionSnapshotMutation,
  stripeTaxRateId: string,
) => {
  switch (mutation) {
    case 'add-on free to paid': {
      await editor
        .update(eventAddons)
        .set({ isPaid: true, price: 300, stripeTaxRateId })
        .where(eq(eventAddons.id, `add-${fixture.userId}`));
      break;
    }
    case 'add-on price': {
      await editor
        .update(eventAddons)
        .set({ price: 450 })
        .where(eq(eventAddons.id, `add-${fixture.userId}`));
      break;
    }
    case 'add-on quantities': {
      await editor
        .update(addonToEventRegistrationOptions)
        .set({ includedQuantity: 2, optionalPurchaseQuantity: 1 })
        .where(
          eq(addonToEventRegistrationOptions.addonId, `add-${fixture.userId}`),
        );
      break;
    }
    case 'add-on removal': {
      await editor
        .delete(addonToEventRegistrationOptions)
        .where(
          eq(addonToEventRegistrationOptions.addonId, `add-${fixture.userId}`),
        );
      break;
    }
    case 'card becomes verified':
    case 'expired card becomes verified':
    case 'invalid card becomes verified': {
      await editor
        .update(userDiscountCards)
        .set({
          status: 'verified',
          validFrom: new Date('2026-09-01T00:00:00.000Z'),
          validTo: new Date('2026-10-03T00:00:00.000Z'),
        })
        .where(
          and(
            eq(userDiscountCards.type, 'esnCard'),
            eq(userDiscountCards.userId, fixture.userId),
          ),
        );
      break;
    }
    case 'card invalidation': {
      // The real refresh handler commits this mutation after admission blocks.
      break;
    }
    case 'card removal': {
      await editor
        .delete(userDiscountCards)
        .where(
          and(
            eq(userDiscountCards.type, 'esnCard'),
            eq(userDiscountCards.userId, fixture.userId),
          ),
        );
      break;
    }
    case 'card validity window': {
      await editor
        .update(userDiscountCards)
        .set({ validTo: admissionSnapshotEventStart })
        .where(
          and(
            eq(userDiscountCards.type, 'esnCard'),
            eq(userDiscountCards.userId, fixture.userId),
          ),
        );
      break;
    }
    case 'closing window': {
      await editor
        .update(eventRegistrationOptions)
        .set({ closeRegistrationTime: new Date('2026-10-01T09:00:00.000Z') })
        .where(eq(eventRegistrationOptions.id, fixture.optionIds[0]));
      break;
    }
    case 'discount': {
      await editor
        .update(eventRegistrationOptionDiscounts)
        .set({ discountedPrice: 750 })
        .where(
          eq(
            eventRegistrationOptionDiscounts.registrationOptionId,
            fixture.optionIds[0],
          ),
        );
      break;
    }
    case 'event start': {
      await editor
        .update(eventInstances)
        .set({ start: new Date('2026-10-04T10:00:00.000Z') })
        .where(eq(eventInstances.id, fixture.eventIds[0]));
      break;
    }
    case 'event status': {
      await editor
        .update(eventInstances)
        .set({ reviewedAt: null, status: 'DRAFT' })
        .where(eq(eventInstances.id, fixture.eventIds[0]));
      break;
    }
    case 'first verified card': {
      await editor.insert(userDiscountCards).values({
        identifier: `card-${fixture.userId}`,
        status: 'verified',
        type: 'esnCard',
        userId: fixture.userId,
        validFrom: new Date('2026-09-01T00:00:00.000Z'),
        validTo: new Date('2026-10-03T00:00:00.000Z'),
      });
      break;
    }
    case 'free to paid': {
      await editor
        .update(eventRegistrationOptions)
        .set({ isPaid: true, price: 1200, stripeTaxRateId })
        .where(eq(eventRegistrationOptions.id, fixture.optionIds[0]));
      break;
    }
    case 'price': {
      await editor
        .update(eventRegistrationOptions)
        .set({ price: 1200 })
        .where(eq(eventRegistrationOptions.id, fixture.optionIds[0]));
      break;
    }
    case 'provider disabled': {
      await editor
        .update(tenants)
        .set({
          discountProviders: { esnCard: { config: {}, status: 'disabled' } },
        })
        .where(eq(tenants.id, fixture.tenantIds[0]));
      break;
    }
  }
};

const waitForCardSaveLockChain = async (
  pool: Pool,
  registrationPid: number,
  initialSavePid: number,
) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const writers = await pool.query<{ query: string }>(
      `SELECT query FROM pg_stat_activity
       WHERE datname = current_database() AND state = 'active'
       AND wait_event_type = 'Lock'
       AND ($1::int = ANY(pg_blocking_pids(pid)) OR $2::int = ANY(pg_blocking_pids(pid)))`,
      [registrationPid, initialSavePid],
    );
    if (writers.rows.length === 2) return writers.rows;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out observing both real card-save lock dependencies');
};

describe('registration admission snapshots in PostgreSQL', () => {
  const pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
  const database = drizzle({ client: pool, relations });
  afterAll(() => pool.end());

  const cases = [
    { mutation: 'add-on price', writer: 'registration' },
    { mutation: 'add-on free to paid', writer: 'registration' },
    { mutation: 'add-on quantities', writer: 'registration' },
    { mutation: 'add-on removal', writer: 'registration' },
    { mutation: 'price', writer: 'registration' },
    { mutation: 'discount', writer: 'registration' },
    { mutation: 'event status', writer: 'registration' },
    { mutation: 'closing window', writer: 'registration' },
    { mutation: 'event start', writer: 'registration' },
    { mutation: 'free to paid', writer: 'registration' },
    { mutation: 'event status', writer: 'waitlist' },
    { mutation: 'closing window', writer: 'waitlist' },
    { mutation: 'price', writer: 'manual approval' },
    { mutation: 'discount', writer: 'manual approval' },
    { mutation: 'event status', writer: 'manual approval' },
    { mutation: 'card invalidation', writer: 'registration' },
    { mutation: 'card validity window', writer: 'registration' },
    { mutation: 'card removal', writer: 'registration' },
    { mutation: 'provider disabled', writer: 'registration' },
    { mutation: 'card invalidation', writer: 'manual approval' },
    { mutation: 'card validity window', writer: 'manual approval' },
    { mutation: 'card removal', writer: 'manual approval' },
    { mutation: 'provider disabled', writer: 'manual approval' },
    { mutation: 'card becomes verified', writer: 'registration' },
    { mutation: 'expired card becomes verified', writer: 'registration' },
    { mutation: 'invalid card becomes verified', writer: 'registration' },
    { mutation: 'first verified card', writer: 'registration' },
    { mutation: 'card becomes verified', writer: 'manual approval' },
    { mutation: 'expired card becomes verified', writer: 'manual approval' },
    { mutation: 'invalid card becomes verified', writer: 'manual approval' },
    { mutation: 'first verified card', writer: 'manual approval' },
  ] as const satisfies readonly {
    mutation: AdmissionSnapshotMutation;
    writer: AdmissionSnapshotWriter;
  }[];

  for (const { mutation, writer } of cases) {
    it(`rejects stale ${writer} without side effects when ${mutation} changes before admission locks`, async () => {
      const fixture = makeFixture();
      const failures: unknown[] = [];
      try {
        const { addOns, stripeAccountId, stripeTaxRateId } =
          await seedAdmissionSnapshotFixture(
            database,
            fixture,
            writer,
            mutation,
          );
        const stripeHttpClient = new AdmissionSnapshotStripeHttpClient();
        const stripe = new Stripe('sk_test_admission_snapshot', {
          httpClient: stripeHttpClient,
          maxNetworkRetries: 0,
        });
        const layer = questionRaceLayer(
          databaseUrl,
          stripe,
          admissionSnapshotNow.toISOString(),
        );
        const tenant = {
          currency: 'EUR' as const,
          domain: `${fixture.tenantIds[0]}.answer-integrity.example`,
          emailSenderEmail: undefined,
          emailSenderName: undefined,
          id: fixture.tenantIds[0],
          maxActiveRegistrationsPerUser: 0,
          name: 'Admission snapshot tenant',
          stripeAccountId,
          timezone: 'Europe/Berlin',
        };
        const client = await pool.connect();
        const editor = drizzle({ client, relations });
        const settledOperations: Promise<void>[] = [];
        let approvalHookCalls = 0;
        let cardInvalidation:
          | Awaited<ReturnType<typeof startAdmissionCardInvalidation>>
          | undefined;
        try {
          const before = await readAdmissionSnapshotEffects(database, fixture);
          const beforeDiscounts = discountEligibilityMutations.has(mutation)
            ? await database
                .select()
                .from(eventRegistrationOptionDiscounts)
                .where(
                  eq(
                    eventRegistrationOptionDiscounts.registrationOptionId,
                    fixture.optionIds[0],
                  ),
                )
                .orderBy(eventRegistrationOptionDiscounts.id)
            : undefined;
          await client.query('BEGIN');
          const pidResult = await client.query<{ pid: number }>(
            'SELECT pg_backend_pid() AS pid',
          );
          const pid = pidResult.rows[0]?.pid;
          if (pid === undefined)
            throw new Error('Missing admission editor PID');
          let admissionBlockerPid = pid;
          if (mutation === 'card invalidation') {
            await editor
              .select({ id: userDiscountCards.id })
              .from(userDiscountCards)
              .where(
                and(
                  eq(userDiscountCards.type, 'esnCard'),
                  eq(userDiscountCards.userId, fixture.userId),
                ),
              )
              .for('update');
            cardInvalidation = await startAdmissionCardInvalidation(
              database,
              fixture,
              layer,
            );
            cardInvalidation.releaseValidation();
            // Refresh through the other organization holds the global owner
            // lock while waiting for the card row. Admission waits for it.
            admissionBlockerPid = await waitForQuestionRaceLock(pool, pid);
          } else if (
            discountEligibilityMutations.has(mutation) &&
            mutation !== 'provider disabled'
          ) {
            // Protect every status and absence without locking either tenant.
            // The next admission read must see this commit after its lock wait.
            await editor.execute(
              userDiscountCardLockStatement(fixture.userId, 'exclusive'),
            );
            await changeAdmissionSnapshot(
              editor,
              fixture,
              mutation,
              stripeTaxRateId,
            );
          } else {
            // Match both event editors: tenant UPDATE precedes event UPDATE.
            // Changes stay uncommitted while the service reads its old snapshot.
            await editor
              .select({ id: tenants.id })
              .from(tenants)
              .where(eq(tenants.id, fixture.tenantIds[0]))
              .for('update');
            await editor
              .select({ id: eventInstances.id })
              .from(eventInstances)
              .where(eq(eventInstances.id, fixture.eventIds[0]))
              .for('update');
            await changeAdmissionSnapshot(
              editor,
              fixture,
              mutation,
              stripeTaxRateId,
            );
          }
          const input = {
            addOns,
            answers: [
              {
                answer: 'Answer to the observed sign-up details',
                questionId: fixture.questionIds[0],
              },
            ],
            eventId: fixture.eventIds[0],
            guestCount: 0,
            registrationOptionId: fixture.optionIds[0],
            tenant,
            user: {
              email: `${fixture.userId}@example.com`,
              id: fixture.userId,
              roleIds: [],
            },
          };
          const operation =
            writer === 'manual approval'
              ? EventRegistrationService.approveManualRegistration({
                  executiveUserId: fixture.userId,
                  expectedEventId: fixture.eventIds[0],
                  onApproved: (tx, transition) =>
                    Effect.gen(function* () {
                      approvalHookCalls++;
                      yield* tx.insert(platformAuditEntries).values({
                        action: 'registration.approve',
                        actorId: 'admission-snapshot-test',
                        after: {
                          resourceId: fixture.registrationId,
                          resourceType: 'registration',
                          state: { status: transition.statusAfter },
                        },
                        before: {
                          resourceId: fixture.registrationId,
                          resourceType: 'registration',
                          state: { status: 'PENDING' },
                        },
                        reason: 'Approve the reviewed registration',
                        targetTenantId: fixture.tenantIds[0],
                      });
                    }),
                  registrationId: fixture.registrationId,
                  targetTenant: tenant,
                })
              : writer === 'waitlist'
                ? EventRegistrationService.joinWaitlist(input)
                : EventRegistrationService.registerForEvent(input);
          const result = Effect.runPromise(
            Effect.gen(function* () {
              yield* operation;
            }).pipe(
              Effect.match({
                onFailure: (error) => ({ error }),
                onSuccess: () => ({ success: true }),
              }),
              Effect.provide(EventRegistrationService.Default),
              Effect.provide(layer),
            ),
          );
          trackFixtureOperation(result, settledOperations, failures);
          await waitForQuestionRaceLock(pool, admissionBlockerPid);
          await client.query('COMMIT');
          if (cardInvalidation) await cardInvalidation.complete();

          expect(await result).toMatchObject({
            error: {
              _tag: 'EventRegistrationConflictError',
              message:
                mutation === 'event status'
                  ? writer === 'manual approval'
                    ? 'This event is not open for approvals.'
                    : 'This event is not open for sign-ups.'
                  : mutation === 'closing window'
                    ? 'Sign-ups are not open at this time.'
                    : 'Sign-up details changed while this request was being processed. Nothing was saved. Review the current details and try again.',
            },
          });
          expect(await readAdmissionSnapshotEffects(database, fixture)).toEqual(
            before,
          );
          if (beforeDiscounts !== undefined) {
            expect(
              await database
                .select()
                .from(eventRegistrationOptionDiscounts)
                .where(
                  eq(
                    eventRegistrationOptionDiscounts.registrationOptionId,
                    fixture.optionIds[0],
                  ),
                )
                .orderBy(eventRegistrationOptionDiscounts.id),
            ).toEqual(beforeDiscounts);
          }
          expect(stripeHttpClient.requestCount).toBe(0);
          expect(approvalHookCalls).toBe(0);
        } catch (error) {
          recordFailure(failures, error);
        } finally {
          await rollbackAndReleaseClient(client, failures);
          try {
            if (cardInvalidation) await cardInvalidation.cleanup();
          } catch (error) {
            recordFailure(failures, error);
          }
          await Promise.all(settledOperations);
        }
      } catch (error) {
        recordFailure(failures, error);
      } finally {
        try {
          await cleanFixture(database, fixture);
        } catch (error) {
          recordFailure(failures, error);
        }
      }
      throwCleanupFailures(failures);
    }, 20_000);
  }

  it('waits for global pricing readers before card saves across organizations', async () => {
    const fixture = makeFixture();
    const otherUserId = `new-${fixture.userId}`;
    const originalAdapter = Adapters.esnCard;
    const failures: unknown[] = [];
    const settledOperations: Promise<void>[] = [];
    try {
      await seedAdmissionSnapshotFixture(
        database,
        fixture,
        'registration',
        'card invalidation',
      );
      await database.insert(users).values({
        auth0Id: `answer-integrity|${otherUserId}`,
        communicationEmail: `${otherUserId}@example.com`,
        email: `${otherUserId}@example.com`,
        firstName: 'Second',
        id: otherUserId,
        lastName: 'Card owner',
      });
      await database.insert(usersToTenants).values({
        tenantId: fixture.tenantIds[1],
        userId: otherUserId,
      });
      const [storedTenant] = await database
        .select()
        .from(tenants)
        .where(eq(tenants.id, fixture.tenantIds[0]));
      const tenant = Schema.decodeUnknownSync(Tenant)(storedTenant);
      const [storedOtherTenant] = await database
        .select()
        .from(tenants)
        .where(eq(tenants.id, fixture.tenantIds[1]));
      const otherTenant = Schema.decodeUnknownSync(Tenant)(storedOtherTenant);
      const stripeHttpClient = new AdmissionSnapshotStripeHttpClient();
      const layer = questionRaceLayer(
        databaseUrl,
        new Stripe('sk_test_card_write_order', {
          httpClient: stripeHttpClient,
          maxNetworkRetries: 0,
        }),
        admissionSnapshotNow.toISOString(),
      );
      const identifier = `target-${fixture.userId}`;
      let validationCalls = 0;
      Adapters.esnCard = {
        validate: ({ identifier: requestedIdentifier }) => {
          expect(requestedIdentifier).toBe(identifier);
          validationCalls++;
          return Promise.resolve({
            metadata: { provider: 'synthetic-admission-test' },
            status: 'verified',
            validFrom: new Date('2026-09-01T00:00:00.000Z'),
            validTo: new Date('2026-10-03T00:00:00.000Z'),
          });
        },
      };
      const saveCard = (userId: string) =>
        trackFixtureOperation(
          Effect.runPromise(
            discountHandlers['discounts.upsertMyCard'](
              { identifier, type: 'esnCard' },
              {
                client: new Rpc.ServerClient(1),
                headers: Headers.empty,
                requestId: RpcMessage.RequestId(1),
                rpc: DiscountsUpsertMyCard.middleware(
                  RpcRequestContextMiddleware,
                ),
              },
            ).pipe(
              Effect.result,
              Effect.exit,
              Effect.provide(RpcAccess.Default),
              Effect.provideService(
                RpcRequestContext,
                admissionCardRequestContext(
                  userId === otherUserId ? otherTenant : tenant,
                  userId,
                ),
              ),
              Effect.provide(layer),
            ),
          ).then((exit) => {
            if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
            return exit.value;
          }),
          settledOperations,
          failures,
        );
      const client = await pool.connect();
      const editor = drizzle({ client, relations });
      try {
        await client.query('BEGIN');
        const pidResult = await client.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const pid = pidResult.rows[0]?.pid;
        if (pid === undefined)
          throw new Error('Missing card-order blocker PID');
        for (const userId of [fixture.userId, otherUserId].toSorted()) {
          await editor.execute(userDiscountCardLockStatement(userId, 'shared'));
        }
        const initialSave = saveCard(otherUserId);
        const initialSavePid = await waitForQuestionRaceLock(pool, pid);
        const replacementSave = saveCard(fixture.userId);
        const waitingWriters = await waitForCardSaveLockChain(
          pool,
          pid,
          initialSavePid,
        );
        expect(validationCalls).toBe(2);
        // Neither save may own the existing card or claim its identifier while
        // pricing readers protect those global owners, including an absent card.
        await client.query("SET LOCAL lock_timeout = '1000ms'");
        const cards = await editor
          .select({ identifier: userDiscountCards.identifier })
          .from(userDiscountCards)
          .where(
            inArray(userDiscountCards.userId, [fixture.userId, otherUserId]),
          )
          .for('share');
        expect(cards).toEqual([{ identifier: `card-${fixture.userId}` }]);
        expect(waitingWriters).toHaveLength(2);
        for (const writer of waitingWriters) {
          expect(writer.query).toContain('pg_advisory_xact_lock(');
        }
        await client.query('COMMIT');

        const [initialResult, replacementResult] = await Promise.all([
          initialSave,
          replacementSave,
        ]);
        const results = [initialResult, replacementResult];
        expect(
          results.filter((result) => Result.isSuccess(result)),
        ).toHaveLength(1);
        const failures = results.filter((result) => Result.isFailure(result));
        expect(failures).toHaveLength(1);
        expect(failures[0]?.failure).toMatchObject({
          _tag: 'DiscountCardConflictError',
        });
        const winnerUserId = Result.isSuccess(initialResult)
          ? otherUserId
          : fixture.userId;
        expect(
          await database
            .select({
              status: userDiscountCards.status,
              userId: userDiscountCards.userId,
            })
            .from(userDiscountCards)
            .where(
              and(
                eq(userDiscountCards.identifier, identifier),
                eq(userDiscountCards.type, 'esnCard'),
              ),
            ),
        ).toEqual([{ status: 'verified', userId: winnerUserId }]);
        expect(stripeHttpClient.requestCount).toBe(0);
      } catch (error) {
        recordFailure(failures, error);
      } finally {
        await rollbackAndReleaseClient(client, failures);
        await Promise.all(settledOperations);
      }
    } catch (error) {
      recordFailure(failures, error);
    } finally {
      await Promise.all(settledOperations);
      Adapters.esnCard = originalAdapter;
      try {
        await database
          .delete(usersToTenants)
          .where(eq(usersToTenants.userId, otherUserId));
      } catch (error) {
        recordFailure(failures, error);
      }
      try {
        await cleanFixture(database, fixture);
      } catch (error) {
        recordFailure(failures, error);
      }
      try {
        await database
          .delete(userDiscountCards)
          .where(eq(userDiscountCards.userId, otherUserId));
      } catch (error) {
        recordFailure(failures, error);
      }
      try {
        await database.delete(users).where(eq(users.id, otherUserId));
      } catch (error) {
        recordFailure(failures, error);
      }
    }
    throwCleanupFailures(failures);
  }, 20_000);
});
