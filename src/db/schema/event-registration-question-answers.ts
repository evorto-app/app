import {
  foreignKey,
  index,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { MAX_REGISTRATION_ANSWER_LENGTH } from '../../shared/registration-question-limits';
import { createId } from '../create-id';
import { eventRegistrationQuestions } from './event-registration-questions';
import { eventRegistrations } from './event-registrations';

export const eventRegistrationAnswerQuestionOwnerForeignKeyName =
  'event_registration_answers_question_owner_fk';
export const eventRegistrationAnswerRegistrationOwnerForeignKeyName =
  'event_registration_answers_registration_owner_fk';
export const eventRegistrationAnswerRegistrationQuestionUniqueConstraintName =
  'event_registration_answers_registration_question_unique';

export const eventRegistrationQuestionAnswers = pgTable(
  'event_registration_question_answers',
  {
    answer: varchar({ length: MAX_REGISTRATION_ANSWER_LENGTH }).notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    eventId: varchar({ length: 20 }).notNull(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    questionId: varchar({ length: 20 }).notNull(),
    registrationId: varchar({ length: 20 }).notNull(),
    registrationOptionId: varchar({ length: 20 }).notNull(),
    tenantId: varchar({ length: 20 }).notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    byQuestionId: index().on(table.questionId),
    questionOwner: foreignKey({
      columns: [table.questionId, table.eventId, table.registrationOptionId],
      foreignColumns: [
        eventRegistrationQuestions.id,
        eventRegistrationQuestions.eventId,
        eventRegistrationQuestions.registrationOptionId,
      ],
      name: eventRegistrationAnswerQuestionOwnerForeignKeyName,
    }).onDelete('cascade'),
    registrationOwner: foreignKey({
      columns: [
        table.registrationId,
        table.eventId,
        table.registrationOptionId,
        table.tenantId,
      ],
      foreignColumns: [
        eventRegistrations.id,
        eventRegistrations.eventId,
        eventRegistrations.registrationOptionId,
        eventRegistrations.tenantId,
      ],
      name: eventRegistrationAnswerRegistrationOwnerForeignKeyName,
    }).onDelete('cascade'),
    uniqueRegistrationQuestionAnswer: unique(
      eventRegistrationAnswerRegistrationQuestionUniqueConstraintName,
    ).on(table.registrationId, table.questionId),
  }),
);
