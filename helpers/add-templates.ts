import { NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '../src/db/schema';
import { getId } from './get-id';

export const addTemplates = (
  database: NeonHttpDatabase<typeof schema>,
  categories: { id: string; tenantId: string; title: string }[],
) => {
  const hikingCategory = categories.find(
    (category) => category.title === 'Hikes',
  );
  if (!hikingCategory) {
    throw new Error('Hiking category not found');
  }
  return database
    .insert(schema.eventTemplates)
    .values([
      {
        categoryId: hikingCategory.id,
        description: 'Hike to the Hörnle',
        icon: 'alps',
        id: getId(),
        tenantId: hikingCategory.tenantId,
        title: 'Hörnle hike',
      },
    ])
    .returning();
};
