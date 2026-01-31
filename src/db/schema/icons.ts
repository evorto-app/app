import {
  bigint,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { tenants } from './tenants';

export const icons = pgTable(
  'icons',
  {
    commonName: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    friendlyName: text().notNull(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    sourceColor: bigint({ mode: 'number' }),
    tenantId: varchar({ length: 20 })
      .notNull()
      .references(() => tenants.id),
  },
  (t) => [unique().on(t.commonName, t.tenantId)],
);
