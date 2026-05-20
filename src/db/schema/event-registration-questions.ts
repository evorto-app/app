import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';
import { templateRegistrationQuestions } from './template-registration-questions';

export const eventRegistrationQuestions = pgTable(
  'event_registration_questions',
  {
    createdAt: timestamp().notNull().defaultNow(),
    description: text(),
    eventId: varchar({ length: 20 })
      .notNull()
      .references(() => eventInstances.id),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    registrationOptionId: varchar({ length: 20 })
      .notNull()
      .references(() => eventRegistrationOptions.id),
    required: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    sourceTemplateQuestionId: varchar({ length: 20 }).references(
      () => templateRegistrationQuestions.id,
    ),
    title: text().notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);
