import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventTemplates } from './event-templates';
import { registrationModes } from './global-enums';
import { templateEventAddons } from './template-event-addons';

export const templateRegistrationOptions = pgTable(
  'template_registration_options',
  {
    cancellationDeadlineHoursBeforeStart: integer(
      'cancellation_deadline_hours_before_start',
    ),
    closeRegistrationOffset: integer().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    description: text(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    isPaid: boolean().notNull(),
    openRegistrationOffset: integer().notNull(),
    organizingRegistration: boolean().notNull(),
    price: integer().notNull(),
    refundFeesOnCancellation: boolean('refund_fees_on_cancellation'),
    registeredDescription: text(),
    registrationMode: registrationModes().notNull().default('fcfs'),
    roleIds: varchar({ length: 20 }).array().notNull().default([]),
    spots: integer().notNull(),
    stripeTaxRateId: varchar(),
    templateId: varchar({ length: 20 })
      .notNull()
      .references(() => eventTemplates.id),
    title: text().notNull(),
    transferDeadlineHoursBeforeStart: integer(
      'transfer_deadline_hours_before_start',
    ),
    untouchedSinceMigration: boolean().notNull().default(false),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    cancellationDeadlineHoursNonnegative: check(
      'template_registration_options_cancellation_deadline_hours_nonnegative',
      sql`${table.cancellationDeadlineHoursBeforeStart} IS NULL OR ${table.cancellationDeadlineHoursBeforeStart} >= 0`,
    ),
    transferDeadlineHoursNonnegative: check(
      'template_registration_options_transfer_deadline_hours_nonnegative',
      sql`${table.transferDeadlineHoursBeforeStart} IS NULL OR ${table.transferDeadlineHoursBeforeStart} >= 0`,
    ),
    uniqueIdTemplateId: unique().on(table.id, table.templateId),
  }),
);

export const addonToTemplateRegistrationOptions = pgTable(
  'addon_to_template_registration_options',
  {
    addonId: varchar({ length: 20 }).notNull(),
    includedQuantity: integer('included_quantity').notNull().default(0),
    optionalPurchaseQuantity: integer('optional_purchase_quantity')
      .notNull()
      .default(0),
    registrationOptionId: varchar({ length: 20 }).notNull(),
    templateId: varchar({ length: 20 })
      .notNull()
      .references(() => eventTemplates.id, { onDelete: 'cascade' }),
  },
  (table) => [
    check(
      'addon_to_template_options_included_nonnegative',
      sql`${table.includedQuantity} >= 0`,
    ),
    check(
      'addon_to_template_options_optional_nonnegative',
      sql`${table.optionalPurchaseQuantity} >= 0`,
    ),
    check(
      'addon_to_template_options_quantity_present',
      sql`${table.includedQuantity} + ${table.optionalPurchaseQuantity} > 0`,
    ),
    foreignKey({
      columns: [table.addonId, table.templateId],
      foreignColumns: [templateEventAddons.id, templateEventAddons.templateId],
      name: 'addon_to_template_options_addon_template_fk',
    }).onDelete('cascade'),
    index('addon_to_template_options_option_idx').on(
      table.registrationOptionId,
    ),
    foreignKey({
      columns: [table.registrationOptionId, table.templateId],
      foreignColumns: [
        templateRegistrationOptions.id,
        templateRegistrationOptions.templateId,
      ],
      name: 'addon_to_template_options_option_template_fk',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.addonId, table.registrationOptionId],
    }),
  ],
);
