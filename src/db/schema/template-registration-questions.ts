import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventTemplates } from './event-templates';
import { templateRegistrationOptions } from './template-registration-options';

export const templateRegistrationQuestions = pgTable(
  'template_registration_questions',
  {
    createdAt: timestamp().notNull().defaultNow(),
    description: text(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    registrationOptionId: varchar({ length: 20 })
      .notNull()
      .references(() => templateRegistrationOptions.id),
    required: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    templateId: varchar({ length: 20 })
      .notNull()
      .references(() => eventTemplates.id),
    title: text().notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);
