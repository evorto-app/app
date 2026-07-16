import type { ScriptDatabaseClient } from '../../src/db/database-client';
import * as schema from '../../src/db/schema';
import {
  computeIconSourceColor,
  type IconSourceColorResult,
} from '../../src/server/utils/icon-color';

export const requireVerifiedIconSourceColor = (
  icon: string,
  result: IconSourceColorResult,
): number | undefined => {
  if (result._tag === 'success') return result.sourceColor;
  if (result._tag === 'busy') {
    throw new Error(`Icon source is busy while verifying "${icon}".`);
  }
  throw new Error(`Icon "${icon}" could not be verified (${result.reason}).`);
};

export const maybeInsertIcons = async (
  database: ScriptDatabaseClient,
  tenantId: string,
  ...icons: string[]
) => {
  if (icons.length === 0) return [];

  const values: (typeof schema.icons.$inferInsert)[] = [];
  for (const icon of new Set(icons)) {
    const [name, set] = icon.split(':');
    let friendlyName = name;
    if (!name) {
      throw new Error('Invalid icon name');
    }
    if (set?.includes('-')) {
      const setParts = set.split('-');
      for (const part of setParts) {
        friendlyName = friendlyName.replaceAll(part, '');
      }
    }
    friendlyName = friendlyName.replaceAll('-', ' ').trim();
    // Capitalize first letter of each word
    friendlyName = friendlyName
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    const sourceColorResult = await computeIconSourceColor(icon);
    values.push({
      commonName: icon,
      friendlyName,
      sourceColor: requireVerifiedIconSourceColor(icon, sourceColorResult),
      tenantId,
    });
  }
  return database.insert(schema.icons).values(values).onConflictDoNothing();
};
