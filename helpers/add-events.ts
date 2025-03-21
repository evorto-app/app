import { randChanceBoolean, randNumber, randSoonDate } from '@ngneat/falso';
import consola from 'consola';
import { InferInsertModel } from 'drizzle-orm';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { DateTime } from 'luxon';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { getId } from './get-id';
import { usersToAuthenticate } from './user-data';

const fallbackId = usersToAuthenticate[0].id;
const adminUser =
  usersToAuthenticate.find((user) => user.roles === 'admin')?.id ?? fallbackId;
const demoUser =
  usersToAuthenticate.find((user) => user.roles === 'all')?.id ?? fallbackId;
const organizerUser =
  usersToAuthenticate.find((user) => user.roles === 'organizer')?.id ??
  fallbackId;

export const addEvents = async (
  database: NeonDatabase<Record<string, never>, typeof relations>,
  templates: {
    description: string;
    icon: string;
    id: string;
    tenantId: string;
    title: string;
  }[],
  roles: {
    defaultOrganizerRole: boolean;
    defaultUserRole: boolean;
    id: string;
    name: string;
  }[],
) => {
  consola.debug('template count: ', templates.length);

  const hikeTemplates = templates.filter((template) =>
    template.title.includes('hike'),
  );
  const cityToursTemplates = templates.filter((template) =>
    template.title.includes('City Tour'),
  );
  const cityTripsTemplates = templates.filter((template) =>
    template.title.includes('Trip'),
  );
  const sportsTemplates = templates.filter(
    (template) =>
      template.title.includes('Match') ||
      template.title.includes('Game') ||
      template.title.includes('Tournament'),
  );
  const weekendTripsTemplates = templates.filter((template) =>
    template.title.includes('Trip'),
  );
  const exampleConfigsTemplates = templates.filter((template) =>
    template.title.includes('Example'),
  );

  if (
    hikeTemplates.length === 0 ||
    cityToursTemplates.length === 0 ||
    cityTripsTemplates.length === 0 ||
    sportsTemplates.length === 0 ||
    weekendTripsTemplates.length === 0 ||
    exampleConfigsTemplates.length === 0
  ) {
    throw new Error('One or more templates not found');
  }

  const defaultUserRoles = roles.filter((role) => role.defaultUserRole);
  const defaultOrganizerRoles = roles.filter(
    (role) => role.defaultOrganizerRole,
  );

  const hikeEvents = createEvents(
    hikeTemplates,
    defaultUserRoles,
    defaultOrganizerRoles,
  );
  const cityToursEvents = createEvents(
    cityToursTemplates,
    defaultUserRoles,
    defaultOrganizerRoles,
  );
  const cityTripsEvents = createEvents(
    cityTripsTemplates,
    defaultUserRoles,
    defaultOrganizerRoles,
  );
  const sportsEvents = createEvents(
    sportsTemplates,
    defaultUserRoles,
    defaultOrganizerRoles,
    true,
  );
  const weekendTripsEvents = createEvents(
    weekendTripsTemplates,
    defaultUserRoles,
    defaultOrganizerRoles,
  );
  const exampleConfigsEvents = createEvents(
    exampleConfigsTemplates,
    defaultUserRoles,
    defaultOrganizerRoles,
  );

  const allEvents = [
    ...hikeEvents.events,
    ...cityToursEvents.events,
    ...cityTripsEvents.events,
    ...sportsEvents.events,
    ...weekendTripsEvents.events,
    ...exampleConfigsEvents.events,
  ];

  const allRegistrationOptions = [
    ...hikeEvents.registrationOptions,
    ...cityToursEvents.registrationOptions,
    ...cityTripsEvents.registrationOptions,
    ...sportsEvents.registrationOptions,
    ...weekendTripsEvents.registrationOptions,
    ...exampleConfigsEvents.registrationOptions,
  ];

  await database.insert(schema.eventInstances).values(allEvents);
  await database
    .insert(schema.eventRegistrationOptions)
    .values(allRegistrationOptions);
  const createdEvents = await database.query.eventInstances.findMany({
    orderBy: {
      start: 'asc',
    },
    where: {
      tenantId: templates[0].tenantId,
    },
    with: {
      registrationOptions: true,
    },
  });
  consola.debug('Created Event count:', createdEvents.length);
  return createdEvents;
};

const createEvents = (
  templates: {
    description: string;
    icon: string;
    id: string;
    tenantId: string;
    title: string;
  }[],
  defaultUserRoles: { id: string }[],
  defaultOrganizerRoles: { id: string }[],
  paid = false,
) => {
  const events: InferInsertModel<typeof schema.eventInstances>[] = [];
  const registrationOptions: InferInsertModel<
    typeof schema.eventRegistrationOptions
  >[] = [];

  for (const template of templates) {
    const eventCount = randNumber({ max: 10, min: 1 });
    for (let index = 0; index < eventCount; index++) {
      const eventStart = randSoonDate({
        days: (index + 1) * randNumber({ max: 20, min: 1 }),
      });
      const eventId = getId();
      const status = (
        randChanceBoolean({ chanceTrue: 0.8 })
          ? 'APPROVED'
          : randChanceBoolean({ chanceTrue: 0.8 })
            ? 'DRAFT'
            : 'PENDING_REVIEW'
      ) as 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW';
      const visibility = (
        randChanceBoolean({ chanceTrue: 0.8 })
          ? 'PUBLIC'
          : randChanceBoolean({ chanceTrue: 0.8 })
            ? 'HIDDEN'
            : 'PRIVATE'
      ) as 'HIDDEN' | 'PRIVATE' | 'PUBLIC';
      const creatorId = randChanceBoolean({ chanceTrue: 0.8 })
        ? organizerUser
        : randChanceBoolean({ chanceTrue: 0.8 })
          ? demoUser
          : adminUser;
      const event = {
        creatorId,
        description: template.description,
        end: DateTime.fromJSDate(eventStart).plus({ hours: 6 }).toJSDate(),
        icon: template.icon,
        id: eventId,
        start: eventStart,
        status,
        templateId: template.id,
        tenantId: template.tenantId,
        title: `${template.title} ${index + 1}`,
        visibility,
      };
      events.push(event);

      registrationOptions.push(
        {
          closeRegistrationTime: DateTime.fromJSDate(eventStart)
            .minus({ hours: 1 })
            .toJSDate(),
          description: `${template.title} registration ${index + 1}`,
          eventId: eventId,
          id: getId(),
          isPaid: paid,
          openRegistrationTime: DateTime.fromJSDate(eventStart)
            .minus({ days: 5 })
            .toJSDate(),
          organizingRegistration: true,
          price: paid ? 100 * 25 : 0,
          registeredDescription: 'You are registered',
          registrationMode: 'fcfs',
          roleIds: defaultUserRoles.map((role) => role.id),
          spots: 20,
          title: 'Participant registration',
        },
        {
          closeRegistrationTime: DateTime.fromJSDate(eventStart)
            .minus({ hours: 1 })
            .toJSDate(),
          description: `${template.title} registration ${index + 1}`,
          eventId: eventId,
          id: getId(),
          isPaid: paid,
          openRegistrationTime: DateTime.fromJSDate(eventStart)
            .minus({ days: 5 })
            .toJSDate(),
          organizingRegistration: true,
          price: paid ? 100 * 10 : 0,
          registeredDescription: 'You are registered',
          registrationMode: 'fcfs',
          roleIds: defaultOrganizerRoles.map((role) => role.id),
          spots: 20,
          title: 'Organizer registration',
        },
      );
    }
  }

  return { events, registrationOptions };
};
