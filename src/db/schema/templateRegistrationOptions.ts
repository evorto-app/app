import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { registrationModes } from './globalEnums';
import { eventTemplates } from './eventTemplates';
import { roles } from './roles';
import { templateEventAddons } from './templateEventAddons';

export const templateRegistrationOptions = pgTable(
  'template_registration_options',
  {
    id: uuid().defaultRandom().primaryKey(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    title: text().notNull(),
    description: text(),
    spots: integer().notNull(),
    organizingRegistration: boolean().notNull(),
    registeredDescription: text(),
    isPaid: boolean().notNull(),
    price: integer().notNull(),
    openRegistrationOffset: integer().notNull(),
    closeRegistrationOffset: integer().notNull(),
    registrationMode: registrationModes().notNull(),
    templateId: uuid()
      .notNull()
      .references(() => eventTemplates.id),
  },
);

export const roleToTemplateRegistrationOptions = pgTable(
  'role_to_template_registration_options',
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
    registrationOptionId: uuid()
      .notNull()
      .references(() => templateRegistrationOptions.id),
  },
  (table) => ({
    unique: unique().on(table.roleId, table.registrationOptionId),
  }),
);

export const addonToTemplateRegistrationOptions = pgTable(
  'addon_to_template_registration_options',
  {
    addonId: uuid()
      .notNull()
      .references(() => templateEventAddons.id),
    registrationOptionId: uuid()
      .notNull()
      .references(() => templateRegistrationOptions.id),
    quantity: integer().notNull(),
  },
  (table) => ({
    unique: unique().on(table.addonId, table.registrationOptionId),
  }),
);
