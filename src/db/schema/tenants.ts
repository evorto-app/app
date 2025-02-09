import { pgEnum, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { createId } from '../create-id';

export const applicationThemes = pgEnum('application_theme', ['evorto', 'esn']);

export const currencyEnum = pgEnum('currency', ['EUR', 'CZK', 'AUD']);

export const localeEnum = pgEnum('locale', ['en-AU', 'en-GB', 'en-US']);

export const timezoneEnum = pgEnum('timezone', [
  'Europe/Prague',
  'Europe/Berlin',
  'Australia/Brisbane',
]);

export const tenants = pgTable('tenants', {
  createdAt: timestamp().notNull().defaultNow(),
  currency: currencyEnum().notNull().default('EUR'),
  domain: text().unique().notNull(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  locale: localeEnum().notNull().default('en-GB'),
  name: varchar().notNull(),
  seoDescription: text(),
  seoTitle: text(),
  stripeAccountId: varchar(),
  theme: applicationThemes().notNull().default('evorto'),
  timezone: timezoneEnum().notNull().default('Europe/Berlin'),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
