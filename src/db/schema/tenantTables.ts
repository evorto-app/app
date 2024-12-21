import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const currencyEnum = pgEnum('currency', ['EUR', 'CZK']);

export const tenants = pgTable('tenants', {
  id: uuid().defaultRandom().primaryKey(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  name: text().notNull(),
  slug: text().unique().notNull(),
  currency: currencyEnum().notNull().default('EUR'),
});
