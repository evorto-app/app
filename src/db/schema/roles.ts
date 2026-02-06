import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';

import { Permission } from '../../shared/permissions/permissions';
import { modelOfTenant } from './model';

export const roles = pgTable(
  'roles',
  {
    ...modelOfTenant,
    collapseMembersInHup: boolean().notNull().default(true),
    defaultOrganizerRole: boolean().notNull().default(false),
    defaultUserRole: boolean().notNull().default(false),
    description: text(),
    displayInHub: boolean().notNull().default(false),
    name: text().notNull(),
    permissions: jsonb().$type<Permission[]>().notNull().default([]),
    showInHub: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(2_147_483_647),
  },
  (t) => [unique().on(t.tenantId, t.name)],
);
