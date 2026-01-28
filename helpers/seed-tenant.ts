import { randEmail, randFirstName, randLastName } from '@ngneat/falso';
import consola from 'consola';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { addEvents } from './add-events';
import { addIcons } from './add-icons';
import { addRegistrations } from './add-registrations';
import {
  addExampleUsers,
  addRoles,
  addUsersToRoles,
} from './add-roles';
import { addTaxRates } from './add-tax-rates';
import { addTemplateCategories } from './add-template-categories';
import { addTemplates } from './add-templates';
import { createTenant } from './create-tenant';
import { usersToAuthenticate } from './user-data';

const defaultStripeAccountId = 'acct_1Qs6S5PPcz51fqyK';

export interface SeedTenantOptions {
  domain?: string;
  ensureUsers?: boolean;
  includeExampleUsers?: boolean;
  includeRegistrations?: boolean;
  logSeedMap?: boolean;
  name?: string;
  runId?: string;
  stripeAccountId?: string;
}

export interface SeedTenantResult {
  tenant: { id: string; domain: string; name: string };
  roles: { id: string; name: string; defaultUserRole: boolean; defaultOrganizerRole: boolean }[];
  templateCategories: { id: string; tenantId: string; title: string }[];
  templates: { id: string; tenantId: string; title: string; description: string; icon: string }[];
  events: {
    id: string;
    tenantId: string;
    title: string;
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
    unlisted: boolean;
    registrationOptions: {
      id: string;
      title: string;
      isPaid: boolean;
      openRegistrationTime: Date;
      closeRegistrationTime: Date;
      price: number;
      roleIds: string[];
      spots: number;
    }[];
  }[];
  registrations: {
    eventId: string;
    id: string;
    registrationOptionId: string;
    status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
    tenantId: string;
    userId: string;
  }[];
}

export const seedBaseUsers = async (
  database: NeonDatabase<Record<string, never>, typeof relations>,
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

  await database
    .insert(schema.users)
    .values(values)
    .onConflictDoNothing();
  consola.success(`Seeded ${values.length} base users (skipping existing)`);
};

export async function seedTenant(
  database: NeonDatabase<Record<string, never>, typeof relations>,
  {
    domain,
    ensureUsers = false,
    includeExampleUsers = false,
    includeRegistrations = true,
    logSeedMap = false,
    name,
    runId,
    stripeAccountId = defaultStripeAccountId,
  }: SeedTenantOptions,
): Promise<SeedTenantResult> {
  if (ensureUsers) {
    await seedBaseUsers(database);
  }

  const resolvedDomain = domain ?? (runId ? `e2e-${runId}` : undefined);
  const resolvedName = name ?? (runId ? `E2E ${runId}` : undefined);

  const tenant = await createTenant(database, {
    domain: resolvedDomain,
    name: resolvedName,
    stripeAccountId,
  });

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
              return role.defaultUserRole || role.name === 'Admin';
            return false;
          })
          .map((role) => ({ roleId: role.id, userId: data.id })),
      ),
    tenant,
  );

  if (includeExampleUsers) {
    await addExampleUsers(database, roles, tenant);
  }

  const templateCategories = await addTemplateCategories(database, tenant, icons);
  const templates = await addTemplates(database, templateCategories, roles);
  const events = await addEvents(database, templates, roles);
  const registrations = includeRegistrations
    ? await addRegistrations(database, events)
    : [];

  if (logSeedMap) {
    const map = {
      runId,
      tenantDomain: tenant.domain,
      categories: templateCategories.map((c) => c.title).slice(0, 6),
      exampleEvents: events.slice(0, 6).map((e) => ({
        title: e.title,
        paid: e.registrationOptions.some((o) => o.isPaid),
      })),
    } as const;
    consola.info(`[seed-map] ${JSON.stringify(map)}`);
  }

  return {
    tenant: { id: tenant.id, domain: tenant.domain, name: tenant.name },
    roles,
    templateCategories,
    templates: templates.map((t) => ({
      description: t.description,
      icon: t.icon.iconName,
      id: t.id,
      tenantId: t.tenantId,
      title: t.title,
    })),
    events: events.map((e) => ({
      id: e.id,
      tenantId: e.tenantId,
      registrationOptions: e.registrationOptions.map((o) => ({
        closeRegistrationTime: o.closeRegistrationTime,
        id: o.id,
        isPaid: o.isPaid,
        openRegistrationTime: o.openRegistrationTime,
        price: o.price,
        roleIds: o.roleIds ?? [],
        spots: o.spots,
        title: o.title,
      })),
      status: e.status,
      title: e.title,
      unlisted: e.unlisted,
    })),
    registrations,
  } satisfies SeedTenantResult;
}
