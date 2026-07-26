import type { IconValue } from '@shared/types/icon';

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { EventLocationType } from '../../types/location';
import { eventTemplates } from './event-templates';
import { eventListingAudience } from './global-enums';
import { modelOfTenant } from './model';
import { users } from './users';

export const eventReviewStatus = pgEnum('event_review_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
]);

export const eventTenantIdentityUniqueConstraintName =
  'event_instances_id_tenant_unique';
export const eventTemplateTenantForeignKeyName =
  'event_instances_template_tenant_fk';
export const eventTimeOrderCheckName = 'event_instances_time_order';
export const eventReviewLifecycleCheckName = 'event_instances_review_lifecycle';

export const eventInstances = pgTable(
  'event_instances',
  {
    ...modelOfTenant,
    creatorId: varchar({ length: 20 })
      .notNull()
      .references(() => users.id),
    description: text().notNull(),
    end: timestamp().notNull(),
    icon: jsonb('icon').$type<IconValue>().notNull(),
    listingAudience: eventListingAudience().notNull(),
    location: jsonb('location').$type<EventLocationType>(),
    reviewedAt: timestamp(),
    reviewedBy: varchar({ length: 20 }).references(() => users.id),
    simpleModeEnabled: boolean().notNull().default(true),
    start: timestamp().notNull(),
    status: eventReviewStatus().notNull().default('DRAFT'),
    statusComment: text(),
    templateId: varchar({ length: 20 })
      .notNull()
      .references(() => eventTemplates.id),
    title: text().notNull(),
  },
  (table) => [
    check(eventTimeOrderCheckName, sql`${table.start} < ${table.end}`),
    check(
      eventReviewLifecycleCheckName,
      sql`(
        (${table.status} = 'PENDING_REVIEW' AND ${table.reviewedAt} IS NULL AND ${table.reviewedBy} IS NULL AND ${table.statusComment} IS NULL)
        OR
        (${table.status} = 'APPROVED' AND ${table.reviewedAt} IS NOT NULL)
        OR
        (${table.status} = 'DRAFT' AND (
          (${table.reviewedAt} IS NULL AND ${table.reviewedBy} IS NULL AND ${table.statusComment} IS NULL)
          OR
          (${table.reviewedAt} IS NOT NULL AND ${table.statusComment} IS NOT NULL AND length(trim(${table.statusComment})) > 0)
        ))
      )`,
    ),
    foreignKey({
      columns: [table.templateId, table.tenantId],
      foreignColumns: [eventTemplates.id, eventTemplates.tenantId],
      name: eventTemplateTenantForeignKeyName,
    }),
    unique(eventTenantIdentityUniqueConstraintName).on(
      table.id,
      table.tenantId,
    ),
  ],
);
