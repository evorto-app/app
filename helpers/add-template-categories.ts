import { NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '../src/db/schema';
import { getId } from './get-id';

export const addTemplateCategories = (
  database: NeonHttpDatabase<typeof schema>,
  tenant: { id: string },
) => {
  return database
    .insert(schema.eventTemplateCategories)
    .values([
      {
        icon: 'city',
        id: getId(),
        tenantId: tenant.id,
        title: 'City tours',
      },
      {
        description: 'Hiking tours in the alps',
        icon: 'mountain',
        id: getId(),
        tenantId: tenant.id,
        title: 'Hikes',
      },
      {
        description: 'Trips to cities close by',
        icon: 'bus',
        id: getId(),
        tenantId: tenant.id,
        title: 'City Trips',
      },
      {
        icon: 'running',
        id: getId(),
        tenantId: tenant.id,
        title: 'Sports',
      },
      {
        description: 'Trips over the weekend',
        icon: 'suitcase',
        id: getId(),
        tenantId: tenant.id,
        title: 'Weekend Trips',
      },
      {
        description: 'Collection of example configurations',
        icon: 'user-manual',
        id: getId(),
        tenantId: tenant.id,
        title: 'Example configurations',
      },
    ])
    .returning();
};
