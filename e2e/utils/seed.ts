import { randEmail, randFirstName, randLastName } from '@ngneat/falso';
import consola from 'consola';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { relations } from '../../src/db/relations';
import * as schema from '../../src/db/schema';
import { addEvents } from '../../helpers/add-events';
import { addIcons } from '../../helpers/add-icons';
import { addRegistrations } from '../../helpers/add-registrations';
import { addRoles, addUsersToRoles } from '../../helpers/add-roles';
import { addTaxRates } from '../../helpers/add-tax-rates';
import { addTemplateCategories } from '../../helpers/add-template-categories';
import { addTemplates } from '../../helpers/add-templates';
import { addDiscountCards } from '../../helpers/add-discount-cards';
import { addDiscountProviders } from '../../helpers/add-discount-providers';
import { createTenant } from '../../helpers/create-tenant';
import { getSeedContext } from '../../helpers/seed-context';
import { usersToAuthenticate } from '../../helpers/user-data';
import { users } from '../../src/db/schema';

export interface SeedOptions {
  runId: string;
  domain?: string;
}

export interface SeedResult {
  tenant: { id: string; domain: string; name: string };
  roles: { id: string; name: string; defaultUserRole: boolean; defaultOrganizerRole: boolean }[];
  templateCategories: { id: string; tenantId: string; title: string }[];
  templates: { id: string; tenantId: string; title: string; description: string; icon: string }[];
  events: {
    id: string;
    title: string;
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
    unlisted: boolean;
    registrationOptions: {
      id: string;
      title: string;
      isPaid: boolean;
      openRegistrationTime: Date;
      closeRegistrationTime: Date;
    }[];
  }[];
}

export async function seedBaseline(
  database: NeonDatabase<Record<string, never>, typeof relations>,
  { runId, domain }: SeedOptions,
): Promise<SeedResult> {
  const { baseDate, seed } = getSeedContext();
  consola.info(`Seeding baseline with seed "${seed}"`);
  // Ensure base users exist BEFORE creating tenant (createTenant links users to tenant)
  await database
    .insert(users)
    .values(
      usersToAuthenticate
        .filter((data) => data.addToDb)
        .map((data) => ({
          auth0Id: data.authId,
          communicationEmail: randEmail(),
          email: data.email,
          firstName: randFirstName(),
          id: data.id,
          lastName: randLastName(),
        })),
    )
    .execute();

  const tenant = await createTenant(database, {
    domain: domain ?? `e2e-${runId}`,
    name: `E2E ${runId}`,
    stripeAccountId: 'acct_1Qs6S5PPcz51fqyK',
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
            if (data.roles === 'admin') return role.defaultUserRole || role.name === 'Admin';
            return false;
          })
          .map((role) => ({ roleId: role.id, userId: data.id })),
      ),
    tenant,
  );

  const templateCategories = await addTemplateCategories(database, tenant, icons);
  const templates = await addTemplates(database, templateCategories, roles);
  const events = await addEvents(database, templates, roles, { baseDate });
  await addRegistrations(database, events, { baseDate });

  // Add discount functionality for testing
  await addDiscountProviders(database, tenant.id);
  await addDiscountCards(database, tenant.id, baseDate);

  // Build a compact, deterministic map for quick debugging
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
      registrationOptions: e.registrationOptions.map((o) => ({
        closeRegistrationTime: o.closeRegistrationTime,
        id: o.id,
        isPaid: o.isPaid,
        openRegistrationTime: o.openRegistrationTime,
        title: o.title,
      })),
      status: e.status,
      title: e.title,
      unlisted: e.unlisted,
    })),
  } satisfies SeedResult;
}
