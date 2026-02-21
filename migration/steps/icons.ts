import { database } from '../../src/db';
import * as schema from '../../src/db/schema';
import { computeIconSourceColor } from '../../src/server/utils/icon-color';

export const maybeInsertIcons = async (
  tenantId: string,
  ...icons: string[]
) => {
  const values = await Promise.all(
    icons.map(async (icon) => {
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
      const sourceColor = await computeIconSourceColor(icon);
      return {
        commonName: icon,
        friendlyName,
        sourceColor,
        tenantId,
      } as const;
    }),
  );
  return database.insert(schema.icons).values(values).onConflictDoNothing();
};
