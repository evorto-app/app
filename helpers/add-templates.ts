import consola from 'consola';
import { InferInsertModel } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { getId } from './get-id';
import {
  requireSeedFixture,
  requireSeedRoles,
  requireSeedStripeTaxRates,
} from './seed-requirements';
import { getCityTourTemplates } from './templates/city-tour-templates';
import { getCityTripTemplates } from './templates/city-trip-templates';
import { getExampleConfigTemplates } from './templates/example-config-templates';
import { getHikingTemplates } from './templates/hiking-templates';
import { getSportsTemplates } from './templates/sports-templates';
import { getWeekendTripTemplates } from './templates/weekend-trip-templates';

export interface SeedTemplate {
  addOns: SeedTemplateAddon[];
  description: string;
  icon: { iconColor: number; iconName: string };
  id: string;
  questions: SeedTemplateQuestion[];
  seedKey: SeedTemplateKey;
  tenantId: string;
  title: string;
}

export interface SeedTemplateAddon {
  id: string;
  isPaid: boolean;
  registrationOptionIds: string[];
  title: string;
}

export interface SeedTemplateQuestion {
  id: string;
  registrationOptionKind: 'organizer' | 'participant';
  registrationOptionId: string;
  required: boolean;
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
  database: NodePgDatabase<typeof relations>,
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
  const { vat7, vat19 } = requireSeedStripeTaxRates(taxRates);
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
    (category) => category.title === 'Example setups',
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

  const { defaultOrganizerRoles, defaultUserRoles } = requireSeedRoles(roles);

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
    // Example setup templates
    ...getExampleConfigTemplates(exampleConfigsCategory).map((template) => ({
      ...template,
      icon: createIconObject(template.icon),
      seedKey: 'example-config' as const,
    })),
  ];

  const createdFreeTemplatesRaw = await database
    .insert(schema.eventTemplates)
    .values(freeTemplates.map(({ seedKey: _seedKey, ...template }) => template))
    .returning();
  consola.success(`Inserted ${createdFreeTemplatesRaw.length} free templates`);

  if (createdFreeTemplatesRaw.length !== freeTemplates.length) {
    throw new Error(
      `Expected ${freeTemplates.length} created free templates, received ${createdFreeTemplatesRaw.length}`,
    );
  }

  const freeTemplateSeedKeyById = new Map(
    freeTemplates.map((template) => [template.id, template.seedKey]),
  );
  const createdFreeTemplates = createdFreeTemplatesRaw.map((template) => ({
    ...template,
    seedKey: requireSeedFixture(
      freeTemplateSeedKeyById.get(template.id),
      `seed key for free template ${template.id}`,
    ),
  }));

  const registrationOptionsToAdd: InferInsertModel<
    typeof schema.templateRegistrationOptions
  >[] = createdFreeTemplates
    .flatMap((template) => [
      {
        closeRegistrationOffset: 1,
        description: 'Help organize this event.',
        isPaid: false,
        openRegistrationOffset: 168,
        organizingRegistration: true,
        price: 0,
        registrationMode: 'fcfs' as const,
        roleIds: defaultOrganizerRoles.map((role) => role.id),
        spots: 1,
        templateId: template.id,
        title: 'Organizer sign-up',
      },
      {
        closeRegistrationOffset: 1,
        description: 'Attend this event.',
        isPaid: false,
        openRegistrationOffset: 168,
        organizingRegistration: false,
        price: 0,
        registrationMode: 'fcfs' as const,
        roleIds: defaultUserRoles.map((role) => role.id),
        spots: 20,
        templateId: template.id,
        title: 'Attendee sign-up',
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
    .values(paidTemplates.map(({ seedKey: _seedKey, ...template }) => template))
    .returning();
  consola.success(`Inserted ${createdPaidTemplatesRaw.length} paid templates`);

  if (createdPaidTemplatesRaw.length !== paidTemplates.length) {
    throw new Error(
      `Expected ${paidTemplates.length} created paid templates, received ${createdPaidTemplatesRaw.length}`,
    );
  }

  const paidTemplateSeedKeyById = new Map(
    paidTemplates.map((template) => [template.id, template.seedKey]),
  );
  const createdPaidTemplates = createdPaidTemplatesRaw.map((template) => ({
    ...template,
    seedKey: requireSeedFixture(
      paidTemplateSeedKeyById.get(template.id),
      `seed key for paid template ${template.id}`,
    ),
  }));

  const paidOptionValues: InferInsertModel<
    typeof schema.templateRegistrationOptions
  >[] = createdPaidTemplates
    .flatMap((template) => [
      {
        closeRegistrationOffset: 1,
        description: 'Help organize this event.',
        isPaid: true,
        openRegistrationOffset: 168,
        organizingRegistration: true,
        price: 100 * 10,
        registrationMode: 'fcfs' as const,
        roleIds: defaultOrganizerRoles.map((role) => role.id),
        spots: 1,
        stripeTaxRateId: vat7.stripeTaxRateId,
        templateId: template.id,
        title: 'Organizer sign-up',
      },
      {
        closeRegistrationOffset: 1,
        description: 'Attend this event.',
        isPaid: true,
        openRegistrationOffset: 168,
        organizingRegistration: false,
        price: 100 * 25,
        registrationMode: 'fcfs' as const,
        roleIds: defaultUserRoles.map((role) => role.id),
        spots: 20,
        stripeTaxRateId: vat19.stripeTaxRateId,
        templateId: template.id,
        title: 'Attendee sign-up',
      },
    ])
    .map((registrationOption) => ({ ...registrationOption, id: getId() }));
  await database
    .insert(schema.templateRegistrationOptions)
    .values(paidOptionValues);
  consola.success(
    `Inserted ${paidOptionValues.length} paid template registration options`,
  );

  const registrationOptionByTemplateId = new Map(
    [...registrationOptionsToAdd, ...paidOptionValues]
      .filter((option) => !option.organizingRegistration)
      .map((option) => [option.templateId, option]),
  );
  const organizerRegistrationOptionByTemplateId = new Map(
    [...registrationOptionsToAdd, ...paidOptionValues]
      .filter((option) => option.organizingRegistration)
      .map((option) => [option.templateId, option]),
  );
  const createdTemplates = [...createdFreeTemplates, ...createdPaidTemplates];
  const addonTemplateCandidates = [
    {
      description: 'Reusable reminder for a simple packed lunch add-on.',
      isPaid: false,
      price: 0,
      seedKey: 'hike' as const,
      stripeTaxRateId: null,
      title: 'Packed lunch',
      totalAvailableQuantity: 30,
    },
    {
      description: 'Reusable paid equipment rental add-on for sports events.',
      isPaid: true,
      price: 100 * 5,
      seedKey: 'sports' as const,
      stripeTaxRateId: vat19.stripeTaxRateId,
      title: 'Equipment rental',
      totalAvailableQuantity: 15,
    },
  ];
  const addonValues = addonTemplateCandidates.map((candidate) => {
    const template = requireSeedFixture(
      createdTemplates.find(
        (createdTemplate) => createdTemplate.seedKey === candidate.seedKey,
      ),
      `${candidate.title} template with seed key ${candidate.seedKey}`,
    );
    requireSeedFixture(
      registrationOptionByTemplateId.get(template.id),
      `participant registration option for ${candidate.title}`,
    );

    return {
      allowMultiple: false,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      description: candidate.description,
      id: getId(),
      isPaid: candidate.isPaid,
      maxQuantityPerUser: 1,
      price: candidate.price,
      stripeTaxRateId: candidate.stripeTaxRateId,
      templateId: template.id,
      title: candidate.title,
      totalAvailableQuantity: candidate.totalAvailableQuantity,
    } satisfies InferInsertModel<typeof schema.templateEventAddons>;
  });
  const addonRegistrationOptionValues = addonValues.map((addon) => {
    const registrationOptionId = requireSeedFixture(
      registrationOptionByTemplateId.get(addon.templateId)?.id,
      `participant registration option attachment for ${addon.title}`,
    );

    return {
      addonId: addon.id,
      includedQuantity: 0,
      optionalPurchaseQuantity: 1,
      registrationOptionId,
      templateId: addon.templateId,
    } satisfies InferInsertModel<
      typeof schema.addonToTemplateRegistrationOptions
    >;
  });
  await database.insert(schema.templateEventAddons).values(addonValues);
  await database
    .insert(schema.addonToTemplateRegistrationOptions)
    .values(addonRegistrationOptionValues);
  consola.success(`Inserted ${addonValues.length} template add-ons`);

  const questionTemplateCandidates = [
    {
      description: 'Helps organizers prepare the right pace and route notes.',
      registrationOptionKind: 'participant' as const,
      required: true,
      seedKey: 'hike' as const,
      title: 'Do you have any hiking experience we should know about?',
    },
    {
      description: 'Collects organizer logistics input before the event.',
      registrationOptionKind: 'organizer' as const,
      required: false,
      seedKey: 'weekend-trip' as const,
      title: 'Which organizer task would you prefer to help with?',
    },
  ];
  const questionKindById = new Map<string, 'organizer' | 'participant'>();
  const questionValues = questionTemplateCandidates.map((candidate) => {
    const template = requireSeedFixture(
      createdTemplates.find(
        (createdTemplate) => createdTemplate.seedKey === candidate.seedKey,
      ),
      `${candidate.title} template with seed key ${candidate.seedKey}`,
    );

    const registrationOption =
      candidate.registrationOptionKind === 'organizer'
        ? organizerRegistrationOptionByTemplateId.get(template.id)
        : registrationOptionByTemplateId.get(template.id);
    const registrationOptionId = requireSeedFixture(
      registrationOption?.id,
      `${candidate.registrationOptionKind} registration option for ${candidate.title}`,
    );

    const id = getId();
    questionKindById.set(id, candidate.registrationOptionKind);

    return {
      description: candidate.description,
      id,
      registrationOptionId,
      required: candidate.required,
      sortOrder: 0,
      templateId: template.id,
      title: candidate.title,
    } satisfies InferInsertModel<typeof schema.templateRegistrationQuestions>;
  });
  await database
    .insert(schema.templateRegistrationQuestions)
    .values(questionValues);
  consola.success(`Inserted ${questionValues.length} template questions`);

  const addonByTemplateId = new Map<string, SeedTemplateAddon[]>();
  for (const addon of addonValues) {
    const attachedOptionIds = addonRegistrationOptionValues
      .filter((attachment) => attachment.addonId === addon.id)
      .map((attachment) => attachment.registrationOptionId);
    const existing = addonByTemplateId.get(addon.templateId) ?? [];
    existing.push({
      id: addon.id,
      isPaid: addon.isPaid,
      registrationOptionIds: attachedOptionIds,
      title: addon.title,
    });
    addonByTemplateId.set(addon.templateId, existing);
  }

  const questionByTemplateId = new Map<string, SeedTemplateQuestion[]>();
  for (const question of questionValues) {
    const existing = questionByTemplateId.get(question.templateId) ?? [];
    existing.push({
      id: question.id,
      registrationOptionKind: requireSeedFixture(
        questionKindById.get(question.id),
        `registration option kind for question ${question.id}`,
      ),
      registrationOptionId: question.registrationOptionId,
      required: question.required,
      title: question.title,
    });
    questionByTemplateId.set(question.templateId, existing);
  }

  return [...createdFreeTemplates, ...createdPaidTemplates].map((template) => {
    const seededTemplate = {
      addOns: addonByTemplateId.get(template.id) ?? [],
      description: template.description,
      icon: template.icon,
      id: template.id,
      questions: questionByTemplateId.get(template.id) ?? [],
      seedKey: template.seedKey,
      tenantId: template.tenantId,
      title: template.title,
    } satisfies SeedTemplate;

    return seededTemplate;
  });
};
