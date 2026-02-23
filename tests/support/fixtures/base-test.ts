import { randFirstName, randLastName } from '@ngneat/falso';
import { init } from '@paralleldrive/cuid2';
import { test as base } from '@playwright/test';
import { ManagementClient } from 'auth0';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

import { getSeedDate } from '../../../helpers/seed-clock';
import { seedFalsoForScope } from '../../../helpers/seed-falso';
import { relations } from '../../../src/db/relations';
import {
  getAuth0ManagementEnvironment,
  validatePlaywrightEnvironment,
} from '../config/environment';

const dedupeLength = 4;
const createDedupeId = init({ length: dedupeLength });
const environment = validatePlaywrightEnvironment();
const databaseUrl = environment.DATABASE_URL;
const databaseConnectionUrl = new URL(databaseUrl);
const databaseHost = databaseConnectionUrl.hostname;
const isLocalDatabaseHost =
  databaseHost === 'localhost' || databaseHost === '127.0.0.1';
if (isLocalDatabaseHost) {
  databaseConnectionUrl.searchParams.set('sslmode', 'disable');
}
const resolvedDatabaseUrl = databaseConnectionUrl.toString();

interface BaseFixtures {
  database: NodePgDatabase<Record<string, never>, typeof relations>;
  falsoSeed: string;
  newUser: {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
  };
  seedDate: Date;
  tenantDomain?: string;
}

export const test = base.extend<BaseFixtures>({
  database: async ({}, use) => {
    const pool = new Pool({
      connectionString: resolvedDatabaseUrl,
    });
    const database = drizzle({
      client: pool,
      relations,
    });
    try {
      await use(database);
    } finally {
      await pool.end();
    }
  },
  falsoSeed: [
    async ({ seedDate }, use, testInfo) => {
      const scope = [
        testInfo.project.name,
        testInfo.file,
        ...testInfo.titlePath,
        `retry:${testInfo.retry}`,
      ].join(':');
      const seed = seedFalsoForScope(scope, seedDate);
      await use(seed);
    },
    { auto: true },
  ],
  newUser: async ({}, use) => {
    const auth0Environment = getAuth0ManagementEnvironment();
    const auth0 = new ManagementClient({
      clientId: auth0Environment.AUTH0_MANAGEMENT_CLIENT_ID,
      clientSecret: auth0Environment.AUTH0_MANAGEMENT_CLIENT_SECRET,
      domain: 'tumi-dev.eu.auth0.com',
    });
    const email = `test-${createDedupeId()}@evorto.app`;
    const password = `notsecure-${createDedupeId()}1!`;
    const firstName = randFirstName();
    const lastName = randLastName();

    const user = await auth0.users.create({
      connection: 'Username-Password-Authentication',
      email,
      email_verified: true,
      family_name: lastName,
      given_name: firstName,
      password,
      user_metadata: {
        localTest: true,
      },
    });

    await use({ email, firstName, lastName, password });

    // v5: non-paginated responses return data directly; delete accepts the user id string
    if (user.user_id) {
      await auth0.users.delete(user.user_id);
    }
  },
  page: async ({ page, tenantDomain }, use) => {
    if (tenantDomain) {
      try {
        await page.context().addCookies([
          {
            domain: 'localhost',
            expires: -1,
            name: 'evorto-tenant',
            path: '/',
            value: tenantDomain,
          },
        ]);
      } catch {}
    }
    page.on('pageerror', (error) => {
      const url = page.url();
      if (url && url.includes('localhost')) {
        throw error;
      } else {
        console.warn(
          'Page error occurred but not throwing (non-localhost environment):',
          error,
        );
      }
    });
    await use(page);
  },
  seedDate: [
    async ({}, use) => {
      await use(getSeedDate());
    },
    { auto: true },
  ],
  tenantDomain: async ({}, use) => {
    try {
      const runtimePath = path.resolve('.e2e-runtime.json');
      if (fs.existsSync(runtimePath)) {
        const raw = fs.readFileSync(runtimePath, 'utf8');
        const data = JSON.parse(raw) as { tenantDomain?: string };
        await use(data.tenantDomain);
        return;
      }
    } catch {}
    await use(environment.TENANT_DOMAIN);
  },
});
