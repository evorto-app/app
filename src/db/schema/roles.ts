import {
  boolean,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { tenants } from './tenants';

export const roles = pgTable('roles', {
  createdAt: timestamp().notNull().defaultNow(),
  defaultOrganizerRole: boolean().notNull().default(false),
  defaultUserRole: boolean().notNull().default(false),
  description: text(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  name: text().notNull(),

  // Admin permissions
  permissionAdminAnalytics: boolean().notNull().default(false),
  permissionAdminBilling: boolean().notNull().default(false),
  permissionAdminRoles: boolean().notNull().default(false),
  permissionAdminSettings: boolean().notNull().default(false),

  // Event permissions
  permissionEventCreate: boolean().notNull().default(false),
  permissionEventDelete: boolean().notNull().default(false),
  permissionEventEdit: boolean().notNull().default(false),
  permissionEventRegistrationManage: boolean().notNull().default(false),
  permissionEventView: boolean().notNull().default(false),

  // Template permissions
  permissionTemplateCreate: boolean().notNull().default(false),
  permissionTemplateDelete: boolean().notNull().default(false),
  permissionTemplateEdit: boolean().notNull().default(false),
  permissionTemplateView: boolean().notNull().default(false),

  // User permissions
  permissionUserCreate: boolean().notNull().default(false),
  permissionUserDelete: boolean().notNull().default(false),
  permissionUserEdit: boolean().notNull().default(false),
  permissionUserView: boolean().notNull().default(false),

  tenantId: varchar({ length: 20 })
    .notNull()
    .references(() => tenants.id),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
