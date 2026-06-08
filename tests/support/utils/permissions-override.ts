import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';

import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import { Permission } from '../../../src/shared/permissions/permissions';

export type PermissionDiff = {
  roleName: string | string[];
  add?: Permission[];
  remove?: Permission[];
};

export async function applyPermissionDiff(
  database: NodePgDatabase<typeof relations>,
  tenant: { id: string },
  diff: PermissionDiff,
): Promise<void> {
  const rolesToUpdate: (typeof schema.roles.$inferSelect)[] = [];
  for (const roleName of [diff.roleName].flat()) {
    const rows = await database
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
    const current = new Set<Permission>(role.permissions);
    for (const p of diff.add ?? []) current.add(p);
    for (const p of diff.remove ?? []) current.delete(p);
    const next = Array.from(current);
    await database
      .update(schema.roles)
      .set({ permissions: next })
      .where(
        and(eq(schema.roles.id, role.id), eq(schema.roles.tenantId, tenant.id)),
      );
  }
}
