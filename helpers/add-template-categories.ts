import { NeonDatabase } from 'drizzle-orm/neon-serverless';
import consola from 'consola';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { getId } from './get-id';

export const addTemplateCategories = async (
  database: NeonDatabase<Record<string, never>, typeof relations>,
  tenant: { id: string },
  iconsParameter?: {
    commonName: string;
    id: string;
    sourceColor: null | number;
  }[],
) => {
  const icons =
    iconsParameter ?? (await database.query.icons.findMany({ where: { tenantId: tenant.id } }));

  const createIconObject = (iconName: string) => {
    const icon = icons.find((icon) => icon.commonName === iconName);
    if (!icon) {
      throw new Error(`Icon with commonName "${iconName}" not found`);
    }
    return {
      iconColor: icon.sourceColor ?? 0,
      iconName: icon.commonName,
    };
  };

  const inserted = await database
    .insert(schema.eventTemplateCategories)
    .values([
      {
        icon: createIconObject('city'),
        id: getId(),
        tenantId: tenant.id,
        title: 'City tours',
      },
      {
        description: 'Hiking tours in the alps',
        icon: createIconObject('mountain'),
        id: getId(),
        tenantId: tenant.id,
        title: 'Hikes',
      },
      {
        description: 'Trips to cities close by',
        icon: createIconObject('bus'),
        id: getId(),
        tenantId: tenant.id,
        title: 'City Trips',
      },
      {
        icon: createIconObject('running'),
        id: getId(),
        tenantId: tenant.id,
        title: 'Sports',
      },
      {
        description: 'Trips over the weekend',
        icon: createIconObject('suitcase'),
        id: getId(),
        tenantId: tenant.id,
        title: 'Weekend Trips',
      },
      {
        description: 'Collection of example configurations',
        icon: createIconObject('user-manual'),
        id: getId(),
        tenantId: tenant.id,
        title: 'Example configurations',
      },
    ])
    .returning();
  consola.success(`Inserted ${inserted.length} template categories for tenant ${tenant.id}`);
  return inserted;
};
