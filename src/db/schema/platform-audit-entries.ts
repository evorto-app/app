import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import {
  type PlatformAuditSnapshot,
  type PlatformTenantAuditAction,
  platformTenantAuditActions,
} from '../../shared/platform-audit';
import { createId } from '../create-id';

export const platformAuditAction = pgEnum(
  'platform_audit_action',
  platformTenantAuditActions,
);

export const platformAuditEntries = pgTable(
  'platform_audit_entries',
  {
    action: platformAuditAction().$type<PlatformTenantAuditAction>().notNull(),
    actorEmail: text('actor_email'),
    actorId: text('actor_id').notNull(),
    after: jsonb('after').$type<null | PlatformAuditSnapshot>(),
    before: jsonb('before').$type<null | PlatformAuditSnapshot>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    reason: text().notNull(),
    // Deliberately not a foreign key: an audit entry must survive removal of
    // the tenant record it identifies.
    targetTenantId: varchar('target_tenant_id', { length: 20 }).notNull(),
  },
  (table) => [
    check(
      'platform_audit_reason_nonempty_check',
      sql`length(trim(${table.reason})) BETWEEN 1 AND 500`,
    ),
    check(
      'platform_audit_snapshot_transition_check',
      sql`${table.before} IS NOT NULL OR ${table.after} IS NOT NULL`,
    ),
    index('platform_audit_target_created_idx').on(
      table.targetTenantId,
      table.createdAt,
    ),
    index('platform_audit_actor_created_idx').on(
      table.actorId,
      table.createdAt,
    ),
  ],
);
