import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import consola from 'consola';
import { DateTime } from 'luxon';

import type { SeedTemplate } from './add-templates';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { getId } from './get-id';
import { getSeedDate } from './seed-clock';
import { usersToAuthenticate } from './user-data';

const fallbackId = usersToAuthenticate[0].id;
const adminUser =
  usersToAuthenticate.find((user) => user.roles === 'admin')?.id ?? fallbackId;
const organizerUser =
  usersToAuthenticate.find((user) => user.roles === 'organizer')?.id ??
  fallbackId;

export interface AddEventsResult {
  events: Awaited<ReturnType<typeof loadCreatedEvents>>;
  scenario: {
    events: SeedScenarioEvents;
  };
}

export type SeedProfile = 'demo' | 'docs' | 'test';

export interface SeedScenarioEvents {
  closedReg: SeedScenarioOptionHandle;
  draft: { eventId: string };
  freeOpen: SeedScenarioOptionHandle;
  paidOpen: SeedScenarioOptionHandle;
  past: { eventId: string };
}

interface ScenarioCandidates {
  closedReg?: SeedScenarioOptionHandle;
  draft?: { eventId: string };
  open?: SeedScenarioOptionHandle;
  past?: { eventId: string };
}

interface SeedScenarioOptionHandle {
  eventId: string;
  optionId: string;
}

interface TaxRateSelection {
  defaultRateId: null | string;
  vat7Id: null | string;
  vat19Id: null | string;
}

interface RedistributableEvent {
  end: Date;
  id: string;
  start: Date;
  status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
  title: string;
}

interface RedistributableRegistrationOption {
  closeRegistrationTime: Date;
  eventId: string;
  openRegistrationTime: Date;
}

type TenantStripeTaxRate = InferSelectModel<typeof schema.tenantStripeTaxRates>;
const demoTemplateLimits = {
  'city-tour': 2,
  'city-trip': 2,
  'example-config': 2,
  hike: 3,
  sports: 1,
  'weekend-trip': 2,
} satisfies Record<SeedTemplate['seedKey'], number>;

const resolveTaxRateSelection = (
  taxRates: TenantStripeTaxRate[],
): TaxRateSelection => {
  const vat19 = taxRates.find((rate) => rate.percentage === '19');
  const vat7 = taxRates.find((rate) => rate.percentage === '7');
  const defaultRate = vat19 ?? vat7 ?? taxRates[0];
  return {
    defaultRateId: defaultRate?.stripeTaxRateId ?? null,
    vat7Id: vat7?.stripeTaxRateId ?? null,
    vat19Id: vat19?.stripeTaxRateId ?? null,
  };
};

const fetchTenantTaxRates = async (
  database: NodePgDatabase<Record<string, never>, typeof relations>,
  tenantId: string,
): Promise<TenantStripeTaxRate[]> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.query.tenantStripeTaxRates.findMany({
        where: { tenantId },
      });
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  return [];
};

const computeEventClock = (
  templateId: string,
  index: number,
): { hour: number; minute: number } => {
  const hash = [...templateId].reduce(
    (accumulator, character) =>
      (accumulator + (character.codePointAt(0) ?? 0)) % 10_000,
    0,
  );

  return {
    hour: 9 + ((hash + index * 3) % 10),
    minute: ((hash + index * 11) % 4) * 15,
  };
};

const compareSeedEvents = (
  eventA: RedistributableEvent,
  eventB: RedistributableEvent,
) =>
  eventA.start.getTime() - eventB.start.getTime() ||
  eventA.title.localeCompare(eventB.title) ||
  eventA.id.localeCompare(eventB.id);

const buildShiftedStart = (
  seedNow: DateTime,
  originalStart: Date,
  dayOffset: number,
) => {
  const originalDateTime = DateTime.fromJSDate(originalStart, {
    zone: 'utc',
  });

  return seedNow
    .plus({ days: dayOffset })
    .set({
      hour: originalDateTime.hour,
      millisecond: 0,
      minute: originalDateTime.minute,
      second: 0,
    })
    .toJSDate();
};

const applyEventSchedule = <
  TEvent extends RedistributableEvent,
  TRegistrationOption extends RedistributableRegistrationOption,
>(
  events: readonly TEvent[],
  registrationOptionsByEventId: ReadonlyMap<string, TRegistrationOption[]>,
  seedNow: DateTime,
  resolveDayOffset: (index: number) => number,
) => {
  const scheduledEvents = [...events].sort(compareSeedEvents);

  for (const [index, event] of scheduledEvents.entries()) {
    const shiftedStart = buildShiftedStart(
      seedNow,
      event.start,
      resolveDayOffset(index),
    );
    const shiftedStartDateTime = DateTime.fromJSDate(shiftedStart, {
      zone: 'utc',
    });

    event.start = shiftedStart;
    event.end = shiftedStartDateTime.plus({ hours: 6 }).toJSDate();

    for (const option of registrationOptionsByEventId.get(event.id) ?? []) {
      option.openRegistrationTime = shiftedStartDateTime
        .minus({ days: 14 })
        .toJSDate();
      option.closeRegistrationTime = shiftedStartDateTime
        .minus({ hours: 2 })
        .toJSDate();
    }
  }
};

export const redistributeDemoEventTimeline = <
  TEvent extends RedistributableEvent,
  TRegistrationOption extends RedistributableRegistrationOption,
>(
  events: readonly TEvent[],
  registrationOptions: readonly TRegistrationOption[],
  seedNow: DateTime,
) => {
  const redistributedEvents = events.map((event) => ({ ...event }));
  const redistributedRegistrationOptions = registrationOptions.map((option) => ({
    ...option,
  }));
  const registrationOptionsByEventId = new Map<string, TRegistrationOption[]>();

  for (const option of redistributedRegistrationOptions) {
    const eventOptions = registrationOptionsByEventId.get(option.eventId) ?? [];
    eventOptions.push(option);
    registrationOptionsByEventId.set(option.eventId, eventOptions);
  }

  const approvedPast = redistributedEvents.filter(
    (event) =>
      event.status === 'APPROVED' && event.start.getTime() < seedNow.toMillis(),
  );
  const approvedUpcoming = redistributedEvents.filter(
    (event) =>
      event.status === 'APPROVED' && event.start.getTime() >= seedNow.toMillis(),
  );
  const draft = redistributedEvents.filter((event) => event.status === 'DRAFT');
  const pendingReview = redistributedEvents.filter(
    (event) => event.status === 'PENDING_REVIEW',
  );

  applyEventSchedule(
    approvedPast,
    registrationOptionsByEventId,
    seedNow,
    (index) =>
      [
        -1,
        -1,
        -2,
        -2,
        -3,
        -3,
        -4,
        -5,
        -6,
        -7,
        -8,
        -10,
      ][index] ?? -(12 + (index - 12) * 2),
  );
  applyEventSchedule(
    approvedUpcoming,
    registrationOptionsByEventId,
    seedNow,
    (index) => [2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 7][index] ?? 8 + index - 12,
  );
  applyEventSchedule(
    pendingReview,
    registrationOptionsByEventId,
    seedNow,
    (index) =>
      [4, 4, 5, 5, 6, 7, 8, 10, 12, 14, 16, 18][index] ??
      20 + (index - 12) * 2,
  );
  applyEventSchedule(
    draft,
    registrationOptionsByEventId,
    seedNow,
    (index) => 8 + index * 2,
  );

  return {
    events: redistributedEvents,
    registrationOptions: redistributedRegistrationOptions,
  };
};

const pickTemplateSet = (
  templates: SeedTemplate[],
  profile: SeedProfile,
  seedKey: SeedTemplate['seedKey'],
) => {
  const matchingTemplates = templates.filter((template) => template.seedKey === seedKey);
  if (matchingTemplates.length === 0) {
    throw new Error(`No templates found for seed key "${seedKey}"`);
  }

  if (profile === 'demo') {
    return matchingTemplates.slice(0, demoTemplateLimits[seedKey]);
  }

  return matchingTemplates.slice(0, 1);
};

const createEvents = (
  templates: SeedTemplate[],
  defaultUserRoles: { id: string }[],
  defaultOrganizerRoles: { id: string }[],
  seedNow: DateTime,
  taxRateSelection: TaxRateSelection,
  options: {
    paid: boolean;
    profile: SeedProfile;
  },
): {
  events: InferInsertModel<typeof schema.eventInstances>[];
  registrationOptions: InferInsertModel<
    typeof schema.eventRegistrationOptions
  >[];
  scenario: ScenarioCandidates;
} => {
  const events: InferInsertModel<typeof schema.eventInstances>[] = [];
  const registrationOptions: InferInsertModel<
    typeof schema.eventRegistrationOptions
  >[] = [];
  const scenario: ScenarioCandidates = {};

  const eventsPerTemplate = options.profile === 'demo' ? 4 : 3;
  const participantTaxRateId = options.paid
    ? (taxRateSelection.vat19Id ?? taxRateSelection.defaultRateId)
    : null;
  const organizerTaxRateId = options.paid
    ? (taxRateSelection.vat7Id ?? taxRateSelection.defaultRateId)
    : null;

  for (const [templateIndex, template] of templates.entries()) {
    for (let index = 0; index < eventsPerTemplate; index += 1) {
      const eventClock = computeEventClock(template.id, index);
      let eventStart: Date;
      let status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW';
      let unlisted: boolean;
      let creatorId: string;

      switch (index) {
      case 0: {
        eventStart = seedNow
          .plus({ days: 7 })
          .set({
            hour: eventClock.hour,
            millisecond: 0,
            minute: eventClock.minute,
            second: 0,
          })
          .toJSDate();
        status = 'APPROVED';
        unlisted = false;
        creatorId = organizerUser;
      
      break;
      }
      case 1: {
        eventStart = seedNow
          .minus({ days: 3 })
          .set({
            hour: eventClock.hour,
            millisecond: 0,
            minute: eventClock.minute,
            second: 0,
          })
          .toJSDate();
        status = 'APPROVED';
        unlisted = false;
        creatorId = organizerUser;
      
      break;
      }
      case 2: {
        eventStart = seedNow
          .plus({ days: 21 })
          .set({
            hour: eventClock.hour,
            millisecond: 0,
            minute: eventClock.minute,
            second: 0,
          })
          .toJSDate();
        status = 'DRAFT';
        unlisted = true;
        creatorId = organizerUser;
      
      break;
      }
      default: {
        eventStart = seedNow
          .plus({ days: 35 + templateIndex })
          .set({
            hour: eventClock.hour,
            millisecond: 0,
            minute: eventClock.minute,
            second: 0,
          })
          .toJSDate();
        status = 'PENDING_REVIEW';
        unlisted = false;
        creatorId = adminUser;
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

      const registrationAnchor = DateTime.fromJSDate(eventStart);
      const openRegistrationTime = registrationAnchor
        .minus({ days: 14 })
        .toJSDate();
      const closeRegistrationTime = registrationAnchor
        .minus({ hours: 2 })
        .toJSDate();

      const participantOptionId = getId();
      const organizerOptionId = getId();

      registrationOptions.push(
        {
          closeRegistrationTime,
          description: `${template.title} registration ${index + 1}`,
          eventId,
          id: participantOptionId,
          isPaid: options.paid,
          openRegistrationTime,
          organizingRegistration: false,
          price: options.paid ? 100 * 25 : 0,
          registeredDescription: 'You are registered',
          registrationMode: 'fcfs',
          roleIds: defaultUserRoles.map((role) => role.id),
          spots: 15,
          stripeTaxRateId: participantTaxRateId,
          title: 'Participant registration',
        },
        {
          closeRegistrationTime,
          description: `${template.title} registration ${index + 1}`,
          eventId,
          id: organizerOptionId,
          isPaid: options.paid,
          openRegistrationTime,
          organizingRegistration: true,
          price: options.paid ? 100 * 10 : 0,
          registeredDescription: 'You are registered',
          registrationMode: 'fcfs',
          roleIds: defaultOrganizerRoles.map((role) => role.id),
          spots: 3,
          stripeTaxRateId: organizerTaxRateId,
          title: 'Organizer registration',
        },
      );

      if (templateIndex !== 0) {
        continue;
      }

      if (index === 0 && !scenario.open) {
        scenario.open = {
          eventId,
          optionId: participantOptionId,
        };
      }

      if (index === 1) {
        if (!scenario.closedReg) {
          scenario.closedReg = {
            eventId,
            optionId: participantOptionId,
          };
        }
        if (!scenario.past) {
          scenario.past = { eventId };
        }
      }

      if (index === 2 && !scenario.draft) {
        scenario.draft = { eventId };
      }
    }
  }

  return { events, registrationOptions, scenario };
};

const requireScenarioOption = (
  scenario: null | ScenarioCandidates,
  key: keyof Pick<ScenarioCandidates, 'closedReg' | 'open'>,
): SeedScenarioOptionHandle => {
  const value = scenario?.[key];
  if (!value) {
    throw new Error(`Missing seed scenario option handle "${key}"`);
  }

  return value;
};

const requireScenarioEvent = (
  scenario: null | ScenarioCandidates,
  key: keyof Pick<ScenarioCandidates, 'draft' | 'past'>,
): { eventId: string } => {
  const value = scenario?.[key];
  if (!value) {
    throw new Error(`Missing seed scenario event handle "${key}"`);
  }

  return value;
};

const loadCreatedEvents = async (
  database: NodePgDatabase<Record<string, never>, typeof relations>,
  tenantId: string,
) => {
  return database.query.eventInstances.findMany({
    orderBy: {
      start: 'asc',
    },
    where: { tenantId },
    with: {
      registrationOptions: true,
    },
  });
};

export const addEvents = async (
  database: NodePgDatabase<Record<string, never>, typeof relations>,
  templates: SeedTemplate[],
  roles: {
    defaultOrganizerRole: boolean;
    defaultUserRole: boolean;
    id: string;
    name: string;
  }[],
  seedDate?: Date,
  profile: SeedProfile = 'demo',
): Promise<AddEventsResult> => {
  if (templates.length === 0) {
    throw new Error('No templates found for event creation');
  }

  const defaultUserRoles = roles.filter((role) => role.defaultUserRole);
  const defaultOrganizerRoles = roles.filter(
    (role) => role.defaultOrganizerRole,
  );

  const seedNow = DateTime.fromJSDate(seedDate ?? getSeedDate(), {
    zone: 'utc',
  });
  const taxRates = await fetchTenantTaxRates(database, templates[0].tenantId);
  const taxRateSelection = resolveTaxRateSelection(taxRates);

  const hikeEvents = createEvents(
    pickTemplateSet(templates, profile, 'hike'),
    defaultUserRoles,
    defaultOrganizerRoles,
    seedNow,
    taxRateSelection,
    { paid: false, profile },
  );
  const cityToursEvents = createEvents(
    pickTemplateSet(templates, profile, 'city-tour'),
    defaultUserRoles,
    defaultOrganizerRoles,
    seedNow,
    taxRateSelection,
    { paid: false, profile },
  );
  const cityTripsEvents = createEvents(
    pickTemplateSet(templates, profile, 'city-trip'),
    defaultUserRoles,
    defaultOrganizerRoles,
    seedNow,
    taxRateSelection,
    { paid: false, profile },
  );
  const weekendTripsEvents = createEvents(
    pickTemplateSet(templates, profile, 'weekend-trip'),
    defaultUserRoles,
    defaultOrganizerRoles,
    seedNow,
    taxRateSelection,
    { paid: false, profile },
  );
  const exampleConfigEvents = createEvents(
    pickTemplateSet(templates, profile, 'example-config'),
    defaultUserRoles,
    defaultOrganizerRoles,
    seedNow,
    taxRateSelection,
    { paid: false, profile },
  );
  const sportsEvents = createEvents(
    pickTemplateSet(templates, profile, 'sports'),
    defaultUserRoles,
    defaultOrganizerRoles,
    seedNow,
    taxRateSelection,
    { paid: true, profile },
  );

  const eventGroups = [
    hikeEvents,
    cityToursEvents,
    cityTripsEvents,
    weekendTripsEvents,
    exampleConfigEvents,
    sportsEvents,
  ];
  let allEvents = eventGroups.flatMap((group) => group.events);
  let allRegistrationOptions = eventGroups.flatMap(
    (group) => group.registrationOptions,
  );

  if (profile === 'demo') {
    const redistributed = redistributeDemoEventTimeline(
      allEvents,
      allRegistrationOptions,
      seedNow,
    );
    allEvents = redistributed.events;
    allRegistrationOptions = redistributed.registrationOptions;
  }

  consola.start(`Inserting ${allEvents.length} events`);
  const insertStart = Date.now();
  await database.insert(schema.eventInstances).values(allEvents);
  consola.success(`Events inserted in ${Date.now() - insertStart}ms`);

  await database
    .insert(schema.eventRegistrationOptions)
    .values(allRegistrationOptions);
  consola.success(
    `Inserted ${allRegistrationOptions.length} event registration options`,
  );

  try {
    const paidParticipantOptions = allRegistrationOptions.filter(
      (
        option,
      ): option is typeof option & {
        id: string;
      } =>
        option.isPaid && !option.organizingRegistration && typeof option.id === 'string',
    );
    if (paidParticipantOptions.length > 0) {
      await database.insert(schema.eventRegistrationOptionDiscounts).values(
        paidParticipantOptions.map((option) => ({
          discountedPrice: Math.max(0, (option.price ?? 0) - 500),
          discountType: 'esnCard' as const,
          registrationOptionId: option.id,
        })),
      );
    }
  } catch (error) {
    consola.warn('Failed to seed event discounts', error);
  }

  const createdEvents = await loadCreatedEvents(database, templates[0].tenantId);
  consola.success(`Loaded ${createdEvents.length} created events`);

  const freeScenarioSource =
    hikeEvents.scenario.open && hikeEvents.scenario.closedReg
      ? hikeEvents.scenario
      : cityToursEvents.scenario.open && cityToursEvents.scenario.closedReg
        ? cityToursEvents.scenario
        : cityTripsEvents.scenario.open && cityTripsEvents.scenario.closedReg
          ? cityTripsEvents.scenario
          : weekendTripsEvents.scenario.open && weekendTripsEvents.scenario.closedReg
            ? weekendTripsEvents.scenario
            : exampleConfigEvents.scenario;

  const paidScenarioSource =
    sportsEvents.scenario.open && sportsEvents.scenario.closedReg
      ? sportsEvents.scenario
      : null;

  return {
    events: createdEvents,
    scenario: {
      events: {
        closedReg: requireScenarioOption(freeScenarioSource, 'closedReg'),
        draft: requireScenarioEvent(freeScenarioSource, 'draft'),
        freeOpen: requireScenarioOption(freeScenarioSource, 'open'),
        paidOpen: requireScenarioOption(paidScenarioSource, 'open'),
        past: requireScenarioEvent(freeScenarioSource, 'past'),
      },
    },
  };
};
