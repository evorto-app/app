import { pgEnum, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { createId } from '../create-id';

export const currencyEnum = pgEnum('currency', ['EUR', 'CZK', 'AUD']);

export const tenants = pgTable('tenants', {
  createdAt: timestamp().notNull().defaultNow(),
  currency: currencyEnum().notNull().default('EUR'),
  domain: text().unique().notNull(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  name: text().notNull(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
