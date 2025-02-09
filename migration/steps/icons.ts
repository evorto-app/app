import consola from 'consola';
import { InferSelectModel } from 'drizzle-orm';

import * as oldSchema from '../../old/drizzle';
import { database } from '../../src/db';
import * as schema from '../../src/db/schema';

export const maybeInsertIcons = async (
  tenantId: string,
  ...icons: string[]
) => {
  return database
    .insert(schema.icons)
    .values(
      icons.map((icon) => {
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
        return {
          commonName: icon,
          friendlyName,
          tenantId,
        };
      }),
    )
    .onConflictDoNothing();
};
