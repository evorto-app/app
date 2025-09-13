import { InferInsertModel } from 'drizzle-orm';
import consola from 'consola';
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
    icon: { iconColor: number; iconName: string };
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

  const hikeEvents = await createEvents(
    database,
    hikeTemplates,
    defaultUserRoles,
    defaultOrganizerRoles,
  );
  const cityToursEvents = await createEvents(
    database,
    cityToursTemplates,
    defaultUserRoles,
    defaultOrganizerRoles,
  );
  const cityTripsEvents = await createEvents(
    database,
    cityTripsTemplates,
    defaultUserRoles,
    defaultOrganizerRoles,
  );
  const sportsEvents = await createEvents(
    database,
    sportsTemplates,
    defaultUserRoles,
    defaultOrganizerRoles,
    true,
  );
  const weekendTripsEvents = await createEvents(
    database,
    weekendTripsTemplates,
    defaultUserRoles,
    defaultOrganizerRoles,
  );
  const exampleConfigsEvents = await createEvents(
    database,
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

  consola.start(`Inserting ${allEvents.length} events`);
  const t0 = Date.now();
  await database.insert(schema.eventInstances).values(allEvents);
  consola.success(`Events inserted in ${Date.now() - t0}ms`);
  await database
    .insert(schema.eventRegistrationOptions)
    .values(allRegistrationOptions);
  consola.success(`Inserted ${allRegistrationOptions.length} event registration options`);

  // Seed discounts for paid participant registration options (ESN card)
  try {
    const paidOptions = allRegistrationOptions.filter(
      (opt) => opt.isPaid && !opt.organizingRegistration,
    );
    if (paidOptions.length > 0) {
      await database
        .insert(schema.eventRegistrationOptionDiscounts)
        .values(
          paidOptions.map((opt) => ({
            discountedPrice: Math.max(0, (opt.price ?? 0) - 500), // simple discount of 5€
            discountType: 'esnCard' as const,
            registrationOptionId: opt.id,
          })),
        );
    }
  } catch (error) {
    console.warn('Failed to seed event discounts', error);
  }
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
  consola.success(`Loaded ${createdEvents.length} created events`);
  return createdEvents;
};

const createEvents = async (
  database: NeonDatabase<Record<string, never>, typeof relations>,
  templates: {
    description: string;
    icon: { iconColor: number; iconName: string };
    id: string;
    tenantId: string;
    title: string;
  }[],
  defaultUserRoles: { id: string }[],
  defaultOrganizerRoles: { id: string }[],
  paid = false,
 ): Promise<{
  events: InferInsertModel<typeof schema.eventInstances>[];
  registrationOptions: InferInsertModel<typeof schema.eventRegistrationOptions>[];
 }> => {
  const events: InferInsertModel<typeof schema.eventInstances>[] = [];
  const registrationOptions: InferInsertModel<
    typeof schema.eventRegistrationOptions
  >[] = [];

  // Use a fixed number of events per template type
  // This ensures a consistent number of events are created
  const eventsPerTemplate = 3;

  for (const template of templates) {
    // Choose tax rates per tenant
    const taxRates = (database as any).query.tenantStripeTaxRates
      ? await (database as any).query.tenantStripeTaxRates.findMany({
          where: { tenantId: template.tenantId },
        })
      : [];
    const vat19 = taxRates.find((r: any) => r.percentage === '19');
    const vat7 = taxRates.find((r: any) => r.percentage === '7');
    const defaultRate = vat19 ?? vat7 ?? taxRates[0];
    for (let index = 0; index < eventsPerTemplate; index++) {
      // Create events relative to the current date
      // Some in the past, some in the present, some in the future
      let eventStart: Date;
      let status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW';
      let unlisted: boolean;
      let creatorId: string;

      // Deterministic assignment based on index
      if (index === 0) {
        // First event should be a future event so it's visible in the UI
        // This ensures events like "Hörnle hike 1" are visible
        eventStart = DateTime.now()
          .plus({ days: 5 + index * 2 })
          .toJSDate();
        status = 'APPROVED';
        unlisted = false;
        creatorId = organizerUser;
      } else if (index === 1) {
        // Current/upcoming event
        eventStart = DateTime.now()
          .plus({ days: 7 + index * 3 })
          .toJSDate();
        status = 'APPROVED';
        unlisted = false;
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
          unlisted = true;
          creatorId = organizerUser;
        } else if (index % 3 === 1) {
          status = 'PENDING_REVIEW';
          unlisted = false;
          // Use adminUser for some events
          creatorId = adminUser;
        } else {
          status = 'APPROVED';
          unlisted = false;
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
        unlisted,
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
          stripeTaxRateId: paid
            ? (vat19 ?? defaultRate)?.stripeTaxRateId ?? null
            : null,
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
          stripeTaxRateId: paid
            ? (vat7 ?? defaultRate)?.stripeTaxRateId ?? null
            : null,
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
