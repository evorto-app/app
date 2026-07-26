import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { EventListingAudience } from '../src/shared/event-listing-audience';
import type { SupportedTenantCurrency } from '../src/types/custom/tenant';

import { randEmail, randFirstName, randLastName } from '@ngneat/falso';
import consola from 'consola';

import type { SeedProfile, SeedScenarioEvents } from './add-events';
import type { SeedTemplateKey } from './add-templates';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { addEvents } from './add-events';
import { addFinanceReceipts } from './add-finance-receipts';
import { addIcons } from './add-icons';
import { addRegistrations } from './add-registrations';
import { addExampleUsers, addRoles, addUsersToRoles } from './add-roles';
import { addTaxRates } from './add-tax-rates';
import { addTemplateCategories } from './add-template-categories';
import { addTemplates } from './add-templates';
import { createTenant, type CreateSeedTenantInput } from './create-tenant';
import { getSeedDate } from './seed-clock';
import { requireSeedRoles } from './seed-requirements';
import { usersToAuthenticate } from './user-data';

const resolveStripeSeedAccountId = (
  profile: SeedProfile,
  explicitValue?: string,
): string | undefined => {
  if (explicitValue && explicitValue.trim().length > 0) {
    return explicitValue;
  }

  const fromEnvironment = process.env['STRIPE_TEST_ACCOUNT_ID']?.trim();
  if (fromEnvironment && fromEnvironment.length > 0) {
    return fromEnvironment;
  }

  if (profile === 'docs' || profile === 'test') {
    throw new Error(
      'Missing STRIPE_TEST_ACCOUNT_ID for deterministic paid seed scenarios',
    );
  }

  return undefined;
};

export interface SeedTenantOptions {
  currency: SupportedTenantCurrency;
  domain: string;
  ensureUsers?: boolean;
  includeExampleUsers?: boolean;
  includeRegistrations?: boolean;
  logSeedMap?: boolean;
  name: string;
  profile?: SeedProfile;
  runId?: string;
  seedDate?: Date;
  stripeAccountId?: string;
}

export interface SeedTenantResult {
  events: {
    id: string;
    registrationOptions: {
      checkedInSpots: number;
      closeRegistrationTime: Date;
      confirmedSpots: number;
      id: string;
      isPaid: boolean;
      openRegistrationTime: Date;
      organizingRegistration: boolean;
      price: number;
      roleIds: string[];
      spots: number;
      stripeTaxRateId: null | string;
      title: string;
      waitlistSpots: number;
    }[];
    listingAudience: EventListingAudience;
    start: Date;
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW';
    tenantId: string;
    title: string;
  }[];
  registrations: {
    eventId: string;
    id: string;
    registrationOptionId: string;
    status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
    tenantId: string;
    userId: string;
  }[];
  roles: {
    defaultOrganizerRole: boolean;
    defaultUserRole: boolean;
    id: string;
    name: string;
  }[];
  scenario: {
    events: SeedScenarioEvents;
  };
  templateCategories: { id: string; tenantId: string; title: string }[];
  templates: {
    addOns: {
      id: string;
      isPaid: boolean;
      registrationOptionIds: string[];
      title: string;
    }[];
    description: string;
    icon: string;
    id: string;
    questions: {
      id: string;
      registrationOptionId: string;
      registrationOptionKind: 'organizer' | 'participant';
      required: boolean;
      title: string;
    }[];
    seedKey: SeedTemplateKey;
    tenantId: string;
    title: string;
  }[];
  tenant: {
    currency: SupportedTenantCurrency;
    domain: string;
    id: string;
    name: string;
    stripeAccountId: null | string;
  };
}

export const seedBaseUsers = async (
  database: NodePgDatabase<typeof relations>,
) => {
  const values = usersToAuthenticate
    .filter((data) => data.addToDb)
    .map((data) => ({
      auth0Id: data.authId,
      communicationEmail: randEmail(),
      email: data.email,
      firstName: randFirstName(),
      id: data.id,
      lastName: randLastName(),
    }));

  if (values.length === 0) {
    consola.info('No base users configured to seed');
    return;
  }

  await database.insert(schema.users).values(values).onConflictDoNothing();
  consola.success(`Seeded ${values.length} base users (skipping existing)`);
};

export async function seedTenant(
  database: NodePgDatabase<typeof relations>,
  {
    currency,
    domain,
    ensureUsers = false,
    includeExampleUsers = false,
    includeRegistrations,
    logSeedMap = false,
    name,
    profile = 'demo',
    runId,
    seedDate,
    stripeAccountId,
  }: SeedTenantOptions,
): Promise<SeedTenantResult> {
  if (ensureUsers) {
    await seedBaseUsers(database);
  }

  const resolvedSeedDate = seedDate ?? getSeedDate();
  const resolvedStripeAccountId = resolveStripeSeedAccountId(
    profile,
    stripeAccountId,
  );

  const tenantInput: CreateSeedTenantInput = {
    currency,
    domain,
    name,
    ...(resolvedStripeAccountId && {
      stripeAccountId: resolvedStripeAccountId,
    }),
  };

  const tenant = await createTenant(database, tenantInput);

  await addTaxRates(database, tenant);
  const icons = await addIcons(database, tenant);
  const roles = await addRoles(database, tenant);
  const { adminRole } = requireSeedRoles(roles);
  await addUsersToRoles(
    database,
    usersToAuthenticate
      .filter((data) => data.addToTenant && data.addToDb)
      .flatMap((data) =>
        roles
          .filter((role) => {
            if (data.roles === 'none') return false;
            if (data.roles === 'profile' || data.roles === 'user')
              return role.defaultUserRole;
            if (data.roles === 'organizer')
              return role.defaultUserRole || role.defaultOrganizerRole;
            if (data.roles === 'admin')
              return (
                role.defaultUserRole ||
                role.id === adminRole.id ||
                role.name === 'Section member'
              );
            return false;
          })
          .map((role) => ({ roleId: role.id, userId: data.id })),
      ),
    tenant,
  );

  if (includeExampleUsers) {
    await addExampleUsers(database, roles, tenant);
  }

  const templateCategories = await addTemplateCategories(
    database,
    tenant,
    icons,
  );
  const templates = await addTemplates(database, templateCategories, roles);
  const effectiveIncludeRegistrations =
    includeRegistrations ?? profile !== 'docs';
  const seededEvents = await addEvents(
    database,
    templates,
    roles,
    resolvedSeedDate,
    profile,
  );
  const registrations = (
    effectiveIncludeRegistrations
      ? await addRegistrations(database, {
          currency: tenant.currency,
          events: seededEvents.events,
          seedDate: resolvedSeedDate,
          tenantId: tenant.id,
        })
      : []
  ).map((registration) => {
    if (!registration.id) {
      throw new Error('Seeded registration is missing an id');
    }
    return {
      eventId: registration.eventId,
      id: registration.id,
      registrationOptionId: registration.registrationOptionId,
      status: registration.status,
      tenantId: registration.tenantId,
      userId: registration.userId,
    };
  });
  await addFinanceReceipts(database, {
    currency: tenant.currency,
    eventIds: seededEvents.events.map((event) => event.id),
    tenantId: tenant.id,
  });
  const refreshedEvents = await database.query.eventInstances.findMany({
    orderBy: { start: 'asc' },
    where: { tenantId: tenant.id },
    with: {
      registrationOptions: true,
    },
  });

  if (logSeedMap) {
    const map = {
      categories: templateCategories.map((c) => c.title).slice(0, 6),
      exampleEvents: seededEvents.events.slice(0, 6).map((event) => ({
        paid: event.registrationOptions.some((option) => option.isPaid),
        title: event.title,
      })),
      runId,
      scenario: seededEvents.scenario.events,
      tenantDomain: tenant.domain,
    } as const;
    consola.info(`[seed-map] ${JSON.stringify(map)}`);
  }

  return {
    events: refreshedEvents.map((event) => ({
      id: event.id,
      listingAudience: event.listingAudience,
      registrationOptions: event.registrationOptions
        .toSorted(
          (a, b) =>
            Number(a.organizingRegistration) -
              Number(b.organizingRegistration) || a.id.localeCompare(b.id),
        )
        .map((option) => ({
          checkedInSpots: option.checkedInSpots,
          closeRegistrationTime: option.closeRegistrationTime,
          confirmedSpots: option.confirmedSpots,
          id: option.id,
          isPaid: option.isPaid,
          openRegistrationTime: option.openRegistrationTime,
          organizingRegistration: option.organizingRegistration,
          price: option.price,
          roleIds: option.roleIds ?? [],
          spots: option.spots,
          stripeTaxRateId: option.stripeTaxRateId,
          title: option.title,
          waitlistSpots: option.waitlistSpots,
        })),
      start: event.start,
      status: event.status,
      tenantId: event.tenantId,
      title: event.title,
    })),
    registrations,
    roles,
    scenario: seededEvents.scenario,
    templateCategories,
    templates: templates.map((t) => ({
      addOns: t.addOns,
      description: t.description,
      icon: t.icon.iconName,
      id: t.id,
      questions: t.questions,
      seedKey: t.seedKey,
      tenantId: t.tenantId,
      title: t.title,
    })),
    tenant: {
      currency: tenant.currency,
      domain: tenant.domain,
      id: tenant.id,
      name: tenant.name,
      stripeAccountId: tenant.stripeAccountId,
    },
  } satisfies SeedTenantResult;
}
