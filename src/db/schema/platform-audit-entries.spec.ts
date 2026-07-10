import { describe, expect, it } from '@effect/vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { platformAuditEntries } from './platform-audit-entries';

describe('platform audit schema', () => {
  it('defines append-oriented audit constraints and lookup indexes', () => {
    const tableConfig = getTableConfig(platformAuditEntries);

    expect(tableConfig.columns.map((column) => column.name)).not.toContain(
      'updated_at',
    );
    expect(
      tableConfig.checks.map((constraint) => constraint.name).toSorted(),
    ).toEqual([
      'platform_audit_reason_nonempty_check',
      'platform_audit_snapshot_transition_check',
    ]);
    expect(
      tableConfig.indexes.map((candidate) => ({
        columns: candidate.config.columns.map((column) => column.name),
        name: candidate.config.name,
      })),
    ).toEqual([
      {
        columns: ['target_tenant_id', 'created_at'],
        name: 'platform_audit_target_created_idx',
      },
      {
        columns: ['actor_id', 'created_at'],
        name: 'platform_audit_actor_created_idx',
      },
    ]);
    expect(tableConfig.columns.map((column) => column.name)).not.toContain(
      'deleted_at',
    );
  });
});
