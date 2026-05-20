import { pgTable, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventRegistrationQuestions } from './event-registration-questions';
import { eventRegistrations } from './event-registrations';

export const eventRegistrationQuestionAnswers = pgTable(
  'event_registration_question_answers',
  {
    answer: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    questionId: varchar({ length: 20 })
      .notNull()
      .references(() => eventRegistrationQuestions.id, { onDelete: 'cascade' }),
    registrationId: varchar({ length: 20 })
      .notNull()
      .references(() => eventRegistrations.id, { onDelete: 'cascade' }),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    uniqueRegistrationQuestionAnswer: unique().on(
      table.registrationId,
      table.questionId,
    ),
  }),
);
