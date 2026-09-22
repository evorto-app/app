import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';

import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import type { TenantRolePermission } from '../../../src/shared/permissions/permissions';

export type PermissionDiff = {
  roleName: string | string[];
  add?: TenantRolePermission[];
  remove?: TenantRolePermission[];
};

export async function applyPermissionDiff(
  database: NodePgDatabase<typeof relations>,
  tenant: { id: string },
  diff: PermissionDiff,
): Promise<void> {
  await database.transaction(async (transaction) => {
    const rolesToUpdate: (typeof schema.roles.$inferSelect)[] = [];
    for (const roleName of [diff.roleName].flat()) {
      const rows = await transaction
        .select()
        .from(schema.roles)
        .where(
          and(
            eq(schema.roles.tenantId, tenant.id),
            eq(schema.roles.name, roleName),
          ),
        )
        .limit(1);
      const role = rows[0];
      if (!role) throw new Error(`Role not found: ${roleName}`);
      rolesToUpdate.push(role);
    }

    for (const role of rolesToUpdate) {
      const current = new Set<TenantRolePermission>(role.permissions);
      for (const p of diff.add ?? []) current.add(p);
      for (const p of diff.remove ?? []) current.delete(p);
      const next = Array.from(current);
      await transaction
        .update(schema.roles)
        .set({ permissions: next })
        .where(
          and(
            eq(schema.roles.id, role.id),
            eq(schema.roles.tenantId, tenant.id),
          ),
        );
    }
  });
}
