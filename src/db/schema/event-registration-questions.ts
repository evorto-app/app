import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';
import { templateRegistrationQuestions } from './template-registration-questions';

export const eventRegistrationQuestionOwnerUniqueConstraintName =
  'event_registration_questions_id_event_option_unique';

export const eventRegistrationQuestions = pgTable(
  'event_registration_questions',
  {
    createdAt: timestamp().notNull().defaultNow(),
    description: text(),
    eventId: varchar({ length: 20 })
      .notNull()
      .references(() => eventInstances.id, { onDelete: 'cascade' }),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    registrationOptionId: varchar({ length: 20 })
      .notNull()
      .references(() => eventRegistrationOptions.id, {
        onDelete: 'cascade',
      }),
    required: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    sourceTemplateQuestionId: varchar({ length: 20 }).references(
      () => templateRegistrationQuestions.id,
      { onDelete: 'set null' },
    ),
    title: text().notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    byEventId: index().on(table.eventId),
    byRegistrationOptionId: index().on(table.registrationOptionId),
    bySourceTemplateQuestionId: index().on(table.sourceTemplateQuestionId),
    ownerIdentity: unique(
      eventRegistrationQuestionOwnerUniqueConstraintName,
    ).on(table.id, table.eventId, table.registrationOptionId),
  }),
);
