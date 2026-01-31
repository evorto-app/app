import { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { and, eq } from 'drizzle-orm';

import { relations } from '../../src/db/relations';
import * as schema from '../../src/db/schema';
import { Permission } from '../../src/shared/permissions/permissions';

export type PermissionDiff = {
  roleName: string;
  add?: Permission[];
  remove?: Permission[];
};

export async function applyPermissionDiff(
  database: NeonDatabase<Record<string, never>, typeof relations>,
  tenant: { id: string },
  diff: PermissionDiff,
): Promise<void> {
  const rows = await database
    .select()
    .from(schema.roles)
    .where(
      and(
        eq(schema.roles.tenantId, tenant.id),
        eq(schema.roles.name, diff.roleName),
      ),
    )
    .limit(1);
  const role = rows[0];
  if (!role) throw new Error(`Role not found: ${diff.roleName}`);
  const current = new Set<Permission>(role.permissions as Permission[]);
  for (const p of diff.add ?? []) current.add(p);
  for (const p of diff.remove ?? []) current.delete(p);
  const next = Array.from(current);
  await database
    .update(schema.roles)
    .set({ permissions: next as any })
    .where(
      and(eq(schema.roles.id, role.id), eq(schema.roles.tenantId, tenant.id)),
    );
}
