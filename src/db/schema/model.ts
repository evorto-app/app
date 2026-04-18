import { timestamp, varchar } from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { tenants } from './tenants';

export const modelBasics = {
  createdAt: timestamp().notNull().defaultNow(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const modelOfTenant = {
  ...modelBasics,
  tenantId: varchar({ length: 20 })
    .notNull()
    .references(() => tenants.id),
};
