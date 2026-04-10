import type { InferInsertModel } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

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
import { createTenant } from './create-tenant';
import { getSeedDate } from './seed-clock';
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
  domain?: string;
  ensureUsers?: boolean;
  includeExampleUsers?: boolean;
  includeRegistrations?: boolean;
  logSeedMap?: boolean;
  name?: string;
  profile?: SeedProfile;
  runId?: string;
  seedDate?: Date;
  stripeAccountId?: string;
}

export interface SeedTenantResult {
  events: {
    id: string;
    registrationOptions: {
      closeRegistrationTime: Date;
      id: string;
      isPaid: boolean;
      openRegistrationTime: Date;
      price: number;
      roleIds: string[];
      spots: number;
      title: string;
    }[];
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
    tenantId: string;
    title: string;
    unlisted: boolean;
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
    description: string;
    icon: string;
    id: string;
    seedKey: SeedTemplateKey;
    tenantId: string;
    title: string;
  }[];
  tenant: { domain: string; id: string; name: string };
}

export const seedBaseUsers = async (
  database: NodePgDatabase<Record<string, never>, typeof relations>,
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
  database: NodePgDatabase<Record<string, never>, typeof relations>,
  {
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

  const resolvedDomain = domain ?? (runId ? `e2e-${runId}` : undefined);
  const resolvedName = name ?? (runId ? `E2E ${runId}` : undefined);

  const resolvedSeedDate = seedDate ?? getSeedDate();
  const resolvedStripeAccountId = resolveStripeSeedAccountId(
    profile,
    stripeAccountId,
  );

  const tenantInput: Partial<InferInsertModel<typeof schema.tenants>> = {
    ...(resolvedStripeAccountId
      ? { stripeAccountId: resolvedStripeAccountId }
      : {}),
  };
  if (typeof resolvedDomain === 'string') {
    tenantInput.domain = resolvedDomain;
  }
  if (typeof resolvedName === 'string') {
    tenantInput.name = resolvedName;
  }

  const tenant = await createTenant(database, tenantInput);

  await addTaxRates(database, tenant);
  const icons = await addIcons(database, tenant);
  const roles = await addRoles(database, tenant);
  await addUsersToRoles(
    database,
    usersToAuthenticate
      .filter((data) => data.addToTenant && data.addToDb)
      .flatMap((data) =>
        roles
          .filter((role) => {
            if (data.roles === 'none') return false;
            if (data.roles === 'all') return true;
            if (data.roles === 'user') return role.defaultUserRole;
            if (data.roles === 'organizer')
              return role.defaultUserRole || role.defaultOrganizerRole;
            if (data.roles === 'admin')
              return (
                role.defaultUserRole ||
                role.name === 'Admin' ||
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
      ? await addRegistrations(database, seededEvents.events, resolvedSeedDate)
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
    eventIds: seededEvents.events.map((event) => event.id),
    tenantId: tenant.id,
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
    events: seededEvents.events.map((event) => ({
      id: event.id,
      registrationOptions: event.registrationOptions.map((option) => ({
        closeRegistrationTime: option.closeRegistrationTime,
        id: option.id,
        isPaid: option.isPaid,
        openRegistrationTime: option.openRegistrationTime,
        price: option.price,
        roleIds: option.roleIds ?? [],
        spots: option.spots,
        title: option.title,
      })),
      status: event.status,
      tenantId: event.tenantId,
      title: event.title,
      unlisted: event.unlisted,
    })),
    registrations,
    roles,
    scenario: seededEvents.scenario,
    templateCategories,
    templates: templates.map((t) => ({
      description: t.description,
      icon: t.icon.iconName,
      id: t.id,
      seedKey: t.seedKey,
      tenantId: t.tenantId,
      title: t.title,
    })),
    tenant: { domain: tenant.domain, id: tenant.id, name: tenant.name },
  } satisfies SeedTenantResult;
}
