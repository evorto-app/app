import { NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '../src/db/schema';
import { getId } from './get-id';

export const addTemplates = async (
  database: NeonHttpDatabase<typeof schema>,
  categories: { id: string; tenantId: string; title: string }[],
) => {
  const hikingCategory = categories.find(
    (category) => category.title === 'Hikes',
  );
  if (!hikingCategory) {
    throw new Error('Hiking category not found');
  }

  const template = await database
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
    .returning()
    .then((results) => results[0]);

  if (!template) {
    throw new Error('Failed to create template');
  }

  await database.insert(schema.templateRegistrationOptions).values([
    {
      closeRegistrationOffset: 1,
      description: 'Organizer registration',
      isPaid: false,
      openRegistrationOffset: 168,
      organizingRegistration: true,
      price: 0,
      registrationMode: 'fcfs',
      spots: 1,
      templateId: template.id,
      title: 'Organizer',
    },
    {
      closeRegistrationOffset: 1,
      description: 'Participant registration',
      isPaid: false,
      openRegistrationOffset: 168,
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      spots: 20,
      templateId: template.id,
      title: 'Participant',
    },
  ]);

  return [template];
};
