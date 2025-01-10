import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { DateTime } from 'luxon';

import * as schema from '../src/db/schema';
import { getId } from './get-id';

export const addEvents = (
  database: NeonHttpDatabase<typeof schema>,
  templates: { id: string; tenantId: string; title: string }[],
) => {
  const hikeTemplate = templates.find(
    (template) => template.title === 'Hörnle hike',
  );
  if (!hikeTemplate) {
    throw new Error('Hörnle hike template not found');
  }
  return database
    .insert(schema.eventInstances)
    .values([
      {
        description: 'Hörnle hike description',
        icon: 'alps',
        id: getId(),
        startTime: DateTime.local().plus({ days: 1, hours: 1 }).toJSDate(),
        templateId: hikeTemplate.id,
        tenantId: hikeTemplate.tenantId,
        title: 'Hörnle hike',
      },
    ])
    .returning();
};
