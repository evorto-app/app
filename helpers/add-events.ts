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
const regularUser =
  usersToAuthenticate.find((user) => user.roles === 'user')?.id ?? fallbackId;

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

  // Use a fixed number of events per template type
  // This ensures a consistent number of events are created
  const eventsPerTemplate = 3;

  for (const template of templates) {
    for (let index = 0; index < eventsPerTemplate; index++) {
      // Create events relative to the current date
      // Some in the past, some in the present, some in the future
      let eventStart: Date;
      let status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW';
      let visibility: 'HIDDEN' | 'PRIVATE' | 'PUBLIC';
      let creatorId: string;

      // Deterministic assignment based on index
      if (index === 0) {
        // First event should be a future event so it's visible in the UI
        // This ensures events like "Hörnle hike 1" are visible
        eventStart = DateTime.now()
          .plus({ days: 5 + index * 2 })
          .toJSDate();
        status = 'APPROVED';
        visibility = 'PUBLIC';
        creatorId = organizerUser;
      } else if (index === 1) {
        // Current/upcoming event
        eventStart = DateTime.now()
          .plus({ days: 7 + index * 3 })
          .toJSDate();
        status = 'APPROVED';
        visibility = 'PUBLIC';
        // Use organizerUser for current/upcoming events
        // Association members create and run events
        creatorId = organizerUser;
      } else {
        // Future event
        eventStart = DateTime.now()
          .plus({ days: 30 + index * 10 })
          .toJSDate();

        // Mix of statuses for future events
        if (index % 3 === 0) {
          status = 'DRAFT';
          visibility = 'HIDDEN';
          creatorId = organizerUser;
        } else if (index % 3 === 1) {
          status = 'PENDING_REVIEW';
          visibility = 'PRIVATE';
          // Use adminUser for some events
          creatorId = adminUser;
        } else {
          status = 'APPROVED';
          visibility = 'PUBLIC';
          // Use organizerUser for approved events
          creatorId = organizerUser;
        }
      }

      const eventId = getId();
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

      // Registration options are also deterministic
      // For registration times, ensure:
      // - openRegistrationTime is always in the past (5 days before now)
      // - closeRegistrationTime is always in the future (30 days from now)
      // This ensures events are always available for registration in tests
      const openRegistrationTime = DateTime.now().minus({ days: 5 }).toJSDate();
      const closeRegistrationTime = DateTime.now()
        .plus({ days: 30 })
        .toJSDate();

      registrationOptions.push(
        {
          closeRegistrationTime,
          description: `${template.title} registration ${index + 1}`,
          eventId: eventId,
          id: getId(),
          isPaid: paid,
          openRegistrationTime,
          organizingRegistration: false,
          price: paid ? 100 * 25 : 0,
          registeredDescription: 'You are registered',
          registrationMode: 'fcfs',
          roleIds: defaultUserRoles.map((role) => role.id),
          spots: 15, // Participants get more spots
          title: 'Participant registration',
        },
        {
          closeRegistrationTime,
          description: `${template.title} registration ${index + 1}`,
          eventId: eventId,
          id: getId(),
          isPaid: paid,
          openRegistrationTime,
          organizingRegistration: true,
          price: paid ? 100 * 10 : 0,
          registeredDescription: 'You are registered',
          registrationMode: 'fcfs',
          roleIds: defaultOrganizerRoles.map((role) => role.id),
          spots: 3, // Organizers get fewer spots
          title: 'Organizer registration',
        },
      );
    }
  }

  return { events, registrationOptions };
};
