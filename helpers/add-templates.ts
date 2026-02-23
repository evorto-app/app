import consola from 'consola';
import { InferInsertModel } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { getId } from './get-id';
import { getCityTourTemplates } from './templates/city-tour-templates';
import { getCityTripTemplates } from './templates/city-trip-templates';
import { getExampleConfigTemplates } from './templates/example-config-templates';
import { getHikingTemplates } from './templates/hiking-templates';
import { getSportsTemplates } from './templates/sports-templates';
import { getWeekendTripTemplates } from './templates/weekend-trip-templates';

export interface SeedTemplate {
  description: string;
  icon: { iconColor: number; iconName: string };
  id: string;
  seedKey: SeedTemplateKey;
  tenantId: string;
  title: string;
}

export type SeedTemplateKey =
  | 'city-tour'
  | 'city-trip'
  | 'example-config'
  | 'hike'
  | 'sports'
  | 'weekend-trip';

export const addTemplates = async (
  database: NodePgDatabase<Record<string, never>, typeof relations>,
  categories: { id: string; tenantId: string; title: string }[],
  roles: {
    defaultOrganizerRole: boolean;
    defaultUserRole: boolean;
    id: string;
    name: string;
  }[],
) => {
  const tenantId = categories[0]?.tenantId;
  if (!tenantId) {
    throw new Error('Cannot determine tenantId from categories');
  }
  const icons = await database.query.icons.findMany({ where: { tenantId } });
  consola.info(
    `Using ${icons.length} icons for templates (tenant ${tenantId})`,
  );
  const taxRates = await database.query.tenantStripeTaxRates.findMany({
    where: { tenantId },
  });
  consola.info(`Found ${taxRates.length} imported Stripe tax rates`);
  const vat19 = taxRates.find((r) => r.percentage === '19');
  const vat7 = taxRates.find((r) => r.percentage === '7');
  const defaultRate = vat19 ?? vat7 ?? taxRates[0];
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

  const createIconObject = (iconName: string) => {
    const icon = icons.find((index) => index.commonName === iconName);
    if (!icon) {
      throw new Error(`Icon with commonName "${iconName}" not found`);
    }
    return {
      iconColor: icon.sourceColor ?? 0,
      iconName: icon.commonName,
    };
  };

  const freeTemplates = [
    // Hiking freeTemplates
    ...getHikingTemplates(hikingCategory).map((template) => ({
      ...template,
      icon: createIconObject(template.icon),
      seedKey: 'hike' as const,
    })),
    // City tours freeTemplates
    ...getCityTourTemplates(cityToursCategory).map((template) => ({
      ...template,
      icon: createIconObject(template.icon),
      seedKey: 'city-tour' as const,
    })),
    // City trips freeTemplates
    ...getCityTripTemplates(cityTripsCategory).map((template) => ({
      ...template,
      icon: createIconObject(template.icon),
      seedKey: 'city-trip' as const,
    })),
    // Weekend trips freeTemplates
    ...getWeekendTripTemplates(weekendTripsCategory).map((template) => ({
      ...template,
      icon: createIconObject(template.icon),
      seedKey: 'weekend-trip' as const,
    })),
    // Example configurations freeTemplates
    ...getExampleConfigTemplates(exampleConfigsCategory).map((template) => ({
      ...template,
      icon: createIconObject(template.icon),
      seedKey: 'example-config' as const,
    })),
  ];

  const createdFreeTemplatesRaw = await database
    .insert(schema.eventTemplates)
    .values(
      freeTemplates.map(({ seedKey: _seedKey, ...template }) => template),
    )
    .returning();
  consola.success(`Inserted ${createdFreeTemplatesRaw.length} free templates`);

  if (!createdFreeTemplatesRaw) {
    throw new Error('Failed to create freeTemplates');
  }

  const createdFreeTemplates = createdFreeTemplatesRaw.map((template, index) => {
    const freeTemplate = freeTemplates[index];
    if (!freeTemplate) {
      throw new Error('Free template seed metadata is missing');
    }

    return {
      ...template,
      seedKey: freeTemplate.seedKey,
    };
  });

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
  consola.success(
    `Inserted ${registrationOptionsToAdd.length} free template registration options`,
  );

  const paidTemplates =
    // Sports freeTemplates
    getSportsTemplates(sportsCategory).map((template) => ({
      ...template,
      icon: createIconObject(template.icon),
      seedKey: 'sports' as const,
    }));
  const createdPaidTemplatesRaw = await database
    .insert(schema.eventTemplates)
    .values(
      paidTemplates.map(({ seedKey: _seedKey, ...template }) => template),
    )
    .returning();
  consola.success(`Inserted ${createdPaidTemplatesRaw.length} paid templates`);

  if (!createdPaidTemplatesRaw) {
    throw new Error('Failed to create paidTemplates');
  }

  const createdPaidTemplates = createdPaidTemplatesRaw.map((template, index) => {
    const paidTemplate = paidTemplates[index];
    if (!paidTemplate) {
      throw new Error('Paid template seed metadata is missing');
    }

    return {
      ...template,
      seedKey: paidTemplate.seedKey,
    };
  });

  const paidOptionValues: InferInsertModel<
    typeof schema.templateRegistrationOptions
  >[] = createdPaidTemplates
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
        stripeTaxRateId: (vat7 ?? defaultRate)?.stripeTaxRateId ?? null,
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
        stripeTaxRateId: (vat19 ?? defaultRate)?.stripeTaxRateId ?? null,
        templateId: template.id,
        title: 'Participant',
      },
    ])
    .map((registrationOption) => ({ ...registrationOption, id: getId() }));
  await database
    .insert(schema.templateRegistrationOptions)
    .values(paidOptionValues);
  consola.success(
    `Inserted ${paidOptionValues.length} paid template registration options`,
  );

  return [...createdFreeTemplates, ...createdPaidTemplates].map((template) => {
    const seededTemplate = {
      description: template.description,
      icon: template.icon,
      id: template.id,
      seedKey: template.seedKey,
      tenantId: template.tenantId,
      title: template.title,
    } satisfies SeedTemplate;

    return seededTemplate;
  });
};
