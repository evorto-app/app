import { NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '../src/db/schema';
import { getId } from './get-id';

export const addTemplates = (
  database: NeonHttpDatabase<typeof schema>,
  category: { id: string; tenantId: string },
) => {
  return database
    .insert(schema.eventTemplates)
    .values([
      {
        categoryId: category.id,
        description: 'City tours description',
        icon: '',
        id: getId(),
        tenantId: category.tenantId,
        title: 'Hörnle hike',
      },
    ])
    .returning();
};
