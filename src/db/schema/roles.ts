import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';

import { TenantRolePermission } from '../../shared/permissions/permissions';
import { modelOfTenant } from './model';

export const roleTenantIdentityUniqueConstraintName = 'roles_id_tenant_unique';

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
    permissions: jsonb().$type<TenantRolePermission[]>().notNull().default([]),
    sortOrder: integer().notNull().default(2_147_483_647),
  },
  (table) => [
    unique(roleTenantIdentityUniqueConstraintName).on(table.id, table.tenantId),
    unique().on(table.tenantId, table.name),
  ],
);
