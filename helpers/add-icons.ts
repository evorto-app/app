import { NeonDatabase } from 'drizzle-orm/neon-serverless';
import consola from 'consola';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { computeIconSourceColor } from '../src/server/utils/icon-color';
import { getId } from './get-id';

export const addIcons = async (
  database: NeonDatabase<Record<string, never>, typeof relations>,
  tenant: { id: string },
) => {
  const seed = [
    { commonName: 'alps', friendlyName: 'Alps' },
    { commonName: 'valley:color', friendlyName: 'Valley' },
    { commonName: 'football2', friendlyName: 'Football' },
    { commonName: 'basketball', friendlyName: 'Basketball' },
    { commonName: 'volleyball:color', friendlyName: 'Volleyball' },
    { commonName: 'mountain', friendlyName: 'Mountain' },
    { commonName: 'beach', friendlyName: 'Beach' },
    { commonName: 'bus', friendlyName: 'Bus' },
    { commonName: 'city', friendlyName: 'City' },
    { commonName: 'beer', friendlyName: 'Beer' },
    { commonName: 'lake', friendlyName: 'Lake' },
    { commonName: 'village', friendlyName: 'Village' },
    { commonName: 'running', friendlyName: 'Running' },
    { commonName: 'suitcase', friendlyName: 'Suitcase' },
    { commonName: 'santa', friendlyName: 'Santa' },
    { commonName: 'munich-cathedral:color', friendlyName: 'Munich Cathedral' },
    { commonName: 'brandenburg-gate:color', friendlyName: 'Brandenburg Gate' },
    { commonName: 'bicycle', friendlyName: 'Bicycle' },
    { commonName: 'sled:color', friendlyName: 'Sled' },
    { commonName: 'user-manual', friendlyName: 'User Manual' },
    { commonName: 'discount--v1', friendlyName: 'Discount' },
    { commonName: 'ticket--v1', friendlyName: 'Ticket' },
    { commonName: 'easy', friendlyName: 'Easy' },
    { commonName: 'group-background-selected', friendlyName: 'Group Background Selected' },
    {
      commonName:
        'external-canyon-landscape-vitaliy-gorbachev-flat-vitaly-gorbachev-1:external-vitaliy-gorbachev-flat-vitaly-gorbachev',
      friendlyName: 'Canyon Landscape',
    },
  ];
  const values = await Promise.all(
    seed.map(async (icon) => {
      const t0 = Date.now();
      const sourceColor = await computeIconSourceColor(icon.commonName);
      consola.debug(`Computed color for ${icon.commonName} in ${Date.now() - t0}ms`);
      return {
        commonName: icon.commonName,
        friendlyName: icon.friendlyName,
        id: getId(),
        sourceColor,
        tenantId: tenant.id,
      } as const;
    }),
  );
  const inserted = await database.insert(schema.icons).values(values).returning();
  consola.success(`Inserted ${inserted.length} icons`);
  return inserted;
};
