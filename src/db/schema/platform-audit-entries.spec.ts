import { describe, expect, it } from '@effect/vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { platformAuditEntries } from './platform-audit-entries';

describe('platform audit schema', () => {
  it('defines audit record constraints and lookup indexes without lifecycle columns', () => {
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
      {
        columns: ['created_at', 'id'],
        name: 'platform_audit_created_id_idx',
      },
    ]);
    const paginationIndex = tableConfig.indexes.find(
      (candidate) => candidate.config.name === 'platform_audit_created_id_idx',
    );
    expect(
      paginationIndex?.config.columns.map((column) => ({
        name: column.name,
        order: column.indexConfig.order,
      })),
    ).toEqual([
      { name: 'created_at', order: 'desc' },
      { name: 'id', order: 'asc' },
    ]);
    expect(tableConfig.columns.map((column) => column.name)).not.toContain(
      'deleted_at',
    );
  });
});
