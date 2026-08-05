import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import {
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
} from '../../shared/registration-question-limits';
import { createId } from '../create-id';
import { eventRegistrationOptions } from './event-registration-options';
import { templateRegistrationQuestions } from './template-registration-questions';

export const eventRegistrationQuestionOwnerUniqueConstraintName =
  'event_registration_questions_id_event_option_unique';
export const eventRegistrationQuestionOptionEventForeignKeyName =
  'event_registration_questions_option_event_fk';

export const eventRegistrationQuestions = pgTable(
  'event_registration_questions',
  {
    createdAt: timestamp().notNull().defaultNow(),
    description: varchar({
      length: MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
    }),
    eventId: varchar({ length: 20 }).notNull(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    registrationOptionId: varchar({ length: 20 }).notNull(),
    required: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    sourceTemplateQuestionId: varchar({ length: 20 }).references(
      () => templateRegistrationQuestions.id,
      { onDelete: 'set null' },
    ),
    title: varchar({
      length: MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
    }).notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    byEventId: index().on(table.eventId),
    byRegistrationOptionId: index().on(table.registrationOptionId),
    bySourceTemplateQuestionId: index().on(table.sourceTemplateQuestionId),
    optionEvent: foreignKey({
      columns: [table.registrationOptionId, table.eventId],
      foreignColumns: [
        eventRegistrationOptions.id,
        eventRegistrationOptions.eventId,
      ],
      name: eventRegistrationQuestionOptionEventForeignKeyName,
    }).onDelete('cascade'),
    ownerIdentity: unique(
      eventRegistrationQuestionOwnerUniqueConstraintName,
    ).on(table.id, table.eventId, table.registrationOptionId),
  }),
);
