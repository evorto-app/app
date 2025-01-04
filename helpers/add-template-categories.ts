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
        icon: '',
        id: getId(),
        tenantId: tenant.id,
        title: 'City tours',
      },
    ])
    .returning();
};
