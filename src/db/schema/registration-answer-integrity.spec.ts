import { describe, expect, it } from '@effect/vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  MAX_REGISTRATION_ANSWER_LENGTH,
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
} from '../../shared/registration-question-limits';
import {
  eventRegistrationAnswerQuestionOwnerForeignKeyName,
  eventRegistrationAnswerRegistrationOwnerForeignKeyName,
  eventRegistrationAnswerRegistrationQuestionUniqueConstraintName,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrationQuestionOptionEventForeignKeyName,
  eventRegistrationQuestionOwnerUniqueConstraintName,
  eventRegistrationQuestions,
  eventRegistrations,
  templateRegistrationQuestions,
} from './index';

type Table = Parameters<typeof getTableConfig>[0];

const expectForeignKey = ({
  columns,
  foreignColumns,
  foreignTable,
  name,
  onDelete,
  table,
}: {
  columns: readonly string[];
  foreignColumns: readonly string[];
  foreignTable: Table;
  name: string;
  onDelete: 'cascade';
  table: Table;
}) => {
  const constraint = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name,
  );

  expect(constraint).toBeDefined();
  expect(constraint?.reference().columns.map((column) => column.name)).toEqual(
    columns,
  );
  expect(
    constraint?.reference().foreignColumns.map((column) => column.name),
  ).toEqual(foreignColumns);
  expect(constraint?.reference().foreignTable).toBe(foreignTable);
  expect(constraint?.onDelete).toBe(onDelete);
};

const expectUniqueConstraint = ({
  columns,
  name,
  table,
}: {
  columns: readonly string[];
  name: string;
  table: Table;
}) => {
  const constraint = getTableConfig(table).uniqueConstraints.find(
    (candidate) => candidate.getName() === name,
  );

  expect(constraint).toBeDefined();
  expect(constraint?.columns.map((column) => column.name)).toEqual(columns);
};

describe('registration question answer integrity', () => {
  it('bounds question and answer text in fresh-schema storage', () => {
    for (const table of [
      eventRegistrationQuestions,
      templateRegistrationQuestions,
    ]) {
      const columns = getTableConfig(table).columns;
      expect(
        columns.find((column) => column.name === 'title')?.getSQLType(),
      ).toBe(`varchar(${MAX_REGISTRATION_QUESTION_TITLE_LENGTH})`);
      expect(
        columns.find((column) => column.name === 'description')?.getSQLType(),
      ).toBe(`varchar(${MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH})`);
    }

    const answerColumn = getTableConfig(
      eventRegistrationQuestionAnswers,
    ).columns.find((column) => column.name === 'answer');
    expect(answerColumn?.getSQLType()).toBe(
      `varchar(${MAX_REGISTRATION_ANSWER_LENGTH})`,
    );
  });

  it('binds each question to one event registration option', () => {
    expectForeignKey({
      columns: ['registrationOptionId', 'eventId'],
      foreignColumns: ['id', 'eventId'],
      foreignTable: eventRegistrationOptions,
      name: eventRegistrationQuestionOptionEventForeignKeyName,
      onDelete: 'cascade',
      table: eventRegistrationQuestions,
    });
    expectUniqueConstraint({
      columns: ['id', 'eventId', 'registrationOptionId'],
      name: eventRegistrationQuestionOwnerUniqueConstraintName,
      table: eventRegistrationQuestions,
    });
  });

  it('binds each answer to one question and registration owner tuple', () => {
    const config = getTableConfig(eventRegistrationQuestionAnswers);

    expect(
      config.foreignKeys.map((foreignKey) => foreignKey.getName()),
    ).toEqual(
      expect.arrayContaining([
        eventRegistrationAnswerQuestionOwnerForeignKeyName,
        eventRegistrationAnswerRegistrationOwnerForeignKeyName,
      ]),
    );
    expect(config.foreignKeys).toHaveLength(2);
    expectForeignKey({
      columns: ['questionId', 'eventId', 'registrationOptionId'],
      foreignColumns: ['id', 'eventId', 'registrationOptionId'],
      foreignTable: eventRegistrationQuestions,
      name: eventRegistrationAnswerQuestionOwnerForeignKeyName,
      onDelete: 'cascade',
      table: eventRegistrationQuestionAnswers,
    });
    expectForeignKey({
      columns: [
        'registrationId',
        'eventId',
        'registrationOptionId',
        'tenantId',
      ],
      foreignColumns: ['id', 'eventId', 'registrationOptionId', 'tenantId'],
      foreignTable: eventRegistrations,
      name: eventRegistrationAnswerRegistrationOwnerForeignKeyName,
      onDelete: 'cascade',
      table: eventRegistrationQuestionAnswers,
    });
    expectUniqueConstraint({
      columns: ['registrationId', 'questionId'],
      name: eventRegistrationAnswerRegistrationQuestionUniqueConstraintName,
      table: eventRegistrationQuestionAnswers,
    });
  });

  it('requires the complete answer owner scope at insert time', () => {
    const insert = {
      answer: 'Vegetarian meal',
      eventId: 'event-1',
      questionId: 'question-1',
      registrationId: 'registration-1',
      registrationOptionId: 'option-1',
      tenantId: 'tenant-1',
    } satisfies typeof eventRegistrationQuestionAnswers.$inferInsert;

    expect(insert).toMatchObject({
      eventId: 'event-1',
      registrationOptionId: 'option-1',
      tenantId: 'tenant-1',
    });
  });
});
