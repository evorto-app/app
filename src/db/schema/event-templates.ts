import type { IconValue } from '@shared/types/icon';

import {
  boolean,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { EventLocationType } from '../../types/location';
import { createId } from '../create-id';
import { eventTemplateCategories } from './event-template-categories';
import { tenants } from './tenants';

export const eventTemplateCategoryTenantForeignKeyName =
  'event_templates_category_tenant_fk';
export const eventTemplateTenantIdentityUniqueConstraintName =
  'event_templates_id_tenant_unique';

export const eventTemplates = pgTable(
  'event_templates',
  {
    categoryId: varchar({ length: 20 })
      .notNull()
      .references(() => eventTemplateCategories.id),
    createdAt: timestamp().notNull().defaultNow(),
    description: text().notNull(),
    icon: jsonb('icon').$type<IconValue>().notNull(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    location: jsonb('location').$type<EventLocationType>(),
    planningTips: text(),
    simpleModeEnabled: boolean().notNull().default(true),
    tenantId: varchar({ length: 20 })
      .notNull()
      .references(() => tenants.id),
    title: text().notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.categoryId, table.tenantId],
      foreignColumns: [
        eventTemplateCategories.id,
        eventTemplateCategories.tenantId,
      ],
      name: eventTemplateCategoryTenantForeignKeyName,
    }),
    unique(eventTemplateTenantIdentityUniqueConstraintName).on(
      table.id,
      table.tenantId,
    ),
  ],
);
