import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { DateTime } from 'luxon';

import * as schema from '../src/db/schema';
import { getId } from './get-id';

export const addEvents = async (
  database: NeonHttpDatabase<typeof schema>,
  templates: { id: string; tenantId: string; title: string }[],
) => {
  const hikeTemplate = templates.find(
    (template) => template.title === 'Hörnle hike',
  );
  if (!hikeTemplate) {
    throw new Error('Hörnle hike template not found');
  }
  const hikeEvent = await database
    .insert(schema.eventInstances)
    .values([
      {
        description: 'Hörnle hike description',
        end: DateTime.local().plus({ days: 1, hours: 6 }).toJSDate(),
        icon: 'alps',
        id: getId(),
        start: DateTime.local().plus({ days: 1, hours: 1 }).toJSDate(),
        templateId: hikeTemplate.id,
        tenantId: hikeTemplate.tenantId,
        title: 'Hörnle hike',
      },
    ])
    .returning()
    .then((results) => results[0]);

  await database.insert(schema.eventRegistrationOptions).values([
    {
      closeRegistrationTime: DateTime.local()
        .plus({ days: 1, hours: 1 })
        .toJSDate(),
      description: 'Hike to the Hörnle',
      eventId: hikeEvent.id,
      isPaid: true,
      openRegistrationTime: DateTime.local()
        .plus({ days: 1, hours: 1 })
        .toJSDate(),
      organizingRegistration: true,
      price: 0,
      registeredDescription: 'You are registered',
      registrationMode: 'fcfs',
      spots: 20,
      title: 'Participant registration',
    },
    {
      closeRegistrationTime: DateTime.local()
        .plus({ days: 1, hours: 1 })
        .toJSDate(),
      description: 'Hike to the Hörnle',
      eventId: hikeEvent.id,
      isPaid: false,
      openRegistrationTime: DateTime.local()
        .plus({ days: 1, hours: 1 })
        .toJSDate(),
      organizingRegistration: true,
      price: 0,
      registeredDescription: 'You are registered',
      registrationMode: 'fcfs',
      spots: 20,
      title: 'Organizer registration',
    },
  ]);

  return [hikeEvent];
};
