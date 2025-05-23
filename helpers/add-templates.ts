import { InferInsertModel } from 'drizzle-orm';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { getId } from './get-id';
import { getCityTourTemplates } from './templates/city-tour-templates';
import { getCityTripTemplates } from './templates/city-trip-templates';
import { getExampleConfigTemplates } from './templates/example-config-templates';
import { getHikingTemplates } from './templates/hiking-templates';
import { getSportsTemplates } from './templates/sports-templates';
import { getWeekendTripTemplates } from './templates/weekend-trip-templates';

export const addTemplates = async (
  database: NeonDatabase<Record<string, never>, typeof relations>,
  categories: { id: string; tenantId: string; title: string }[],
  roles: {
    defaultOrganizerRole: boolean;
    defaultUserRole: boolean;
    id: string;
    name: string;
  }[],
) => {
  const hikingCategory = categories.find(
    (category) => category.title === 'Hikes',
  );
  const cityToursCategory = categories.find(
    (category) => category.title === 'City tours',
  );
  const cityTripsCategory = categories.find(
    (category) => category.title === 'City Trips',
  );
  const sportsCategory = categories.find(
    (category) => category.title === 'Sports',
  );
  const weekendTripsCategory = categories.find(
    (category) => category.title === 'Weekend Trips',
  );
  const exampleConfigsCategory = categories.find(
    (category) => category.title === 'Example configurations',
  );

  if (
    !hikingCategory ||
    !cityToursCategory ||
    !cityTripsCategory ||
    !sportsCategory ||
    !weekendTripsCategory ||
    !exampleConfigsCategory
  ) {
    throw new Error('One or more categories not found');
  }

  const defaultUserRoles = roles.filter((role) => role.defaultUserRole);
  const defaultOrganizerRoles = roles.filter(
    (role) => role.defaultOrganizerRole,
  );

  const freeTemplates = [
    // Hiking freeTemplates
    ...getHikingTemplates(hikingCategory),
    // City tours freeTemplates
    ...getCityTourTemplates(cityToursCategory),
    // City trips freeTemplates
    ...getCityTripTemplates(cityTripsCategory),
    // Weekend trips freeTemplates
    ...getWeekendTripTemplates(weekendTripsCategory),
    // Example configurations freeTemplates
    ...getExampleConfigTemplates(exampleConfigsCategory),
  ];

  const createdFreeTemplates = await database
    .insert(schema.eventTemplates)
    .values(freeTemplates)
    .returning();

  if (!createdFreeTemplates) {
    throw new Error('Failed to create freeTemplates');
  }

  const registrationOptionsToAdd: InferInsertModel<
    typeof schema.templateRegistrationOptions
  >[] = createdFreeTemplates
    .flatMap((template) => [
      {
        closeRegistrationOffset: 1,
        description: 'Organizer registration',
        isPaid: false,
        openRegistrationOffset: 168,
        organizingRegistration: true,
        price: 0,
        registrationMode: 'fcfs' as const,
        roleIds: defaultOrganizerRoles.map((role) => role.id),
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
        registrationMode: 'fcfs' as const,
        roleIds: defaultUserRoles.map((role) => role.id),
        spots: 20,
        templateId: template.id,
        title: 'Participant',
      },
    ])
    .map((registrationOption) => ({ ...registrationOption, id: getId() }));

  await database
    .insert(schema.templateRegistrationOptions)
    .values(registrationOptionsToAdd);

  const paidTemplates = [
    // Sports freeTemplates
    ...getSportsTemplates(sportsCategory),
  ];

  const createdPaidTemplates = await database
    .insert(schema.eventTemplates)
    .values(paidTemplates)
    .returning();

  if (!createdPaidTemplates) {
    throw new Error('Failed to create paidTemplates');
  }

  await database.insert(schema.templateRegistrationOptions).values(
    createdPaidTemplates
      .flatMap((template) => [
        {
          closeRegistrationOffset: 1,
          description: 'Organizer registration',
          isPaid: true,
          openRegistrationOffset: 168,
          organizingRegistration: true,
          price: 100 * 10,
          registrationMode: 'fcfs' as const,
          roleIds: defaultOrganizerRoles.map((role) => role.id),
          spots: 1,
          templateId: template.id,
          title: 'Organizer',
        },
        {
          closeRegistrationOffset: 1,
          description: 'Participant registration',
          isPaid: true,
          openRegistrationOffset: 168,
          organizingRegistration: false,
          price: 100 * 25,
          registrationMode: 'fcfs' as const,
          roleIds: defaultUserRoles.map((role) => role.id),
          spots: 20,
          templateId: template.id,
          title: 'Participant',
        },
      ])
      .map((registrationOption) => ({ ...registrationOption, id: getId() })),
  );

  return [...createdFreeTemplates, ...createdPaidTemplates];
};
