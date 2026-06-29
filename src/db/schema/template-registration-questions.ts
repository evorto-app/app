import {
  boolean,
  foreignKey,
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
      .references(() => templateRegistrationOptions.id, {
        onDelete: 'cascade',
      }),
    required: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    templateId: varchar({ length: 20 })
      .notNull()
      .references(() => eventTemplates.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    optionBelongsToTemplate: foreignKey({
      columns: [table.registrationOptionId, table.templateId],
      foreignColumns: [
        templateRegistrationOptions.id,
        templateRegistrationOptions.templateId,
      ],
      name: 'template_registration_questions_option_template_fk',
    }).onDelete('cascade'),
  }),
);
