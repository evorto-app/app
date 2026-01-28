import { randFirstName, randLastName } from '@ngneat/falso';
import { init } from '@paralleldrive/cuid2';
import { test as base } from '@playwright/test';
import { ManagementClient } from 'auth0';
import { drizzle, NeonDatabase } from 'drizzle-orm/neon-serverless';
import fs from 'node:fs';
import path from 'node:path';
import ws from 'ws';

import { seedFalsoForScope } from '../../helpers/seed-falso';
import { relations } from '../../src/db/relations';

const dedupeLength = 4;
const createDedupeId = init({ length: dedupeLength });

const auth0 = new ManagementClient({
  clientId: process.env['AUTH0_MANAGEMENT_CLIENT_ID']!,
  clientSecret: process.env['AUTH0_MANAGEMENT_CLIENT_SECRET']!,
  domain: 'tumi-dev.eu.auth0.com',
});

interface BaseFixtures {
  database: NeonDatabase<Record<string, never>, typeof relations>;
  falsoSeed: string;
  newUser: {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
  };
  tenantDomain?: string;
}

export const test = base.extend<BaseFixtures>({
  falsoSeed: [
    async ({}, use, testInfo) => {
      const scope = [
        testInfo.project.name,
        testInfo.file,
        ...testInfo.titlePath(),
      ].join(':');
      const seed = seedFalsoForScope(scope);
      await use(seed);
    },
    { auto: true },
  ],
  tenantDomain: async ({}, use) => {
    try {
      const runtimePath = path.resolve('.e2e-runtime.json');
      if (fs.existsSync(runtimePath)) {
        const raw = fs.readFileSync(runtimePath, 'utf-8');
        const data = JSON.parse(raw) as { tenantDomain?: string };
        await use(data.tenantDomain);
        return;
      }
    } catch {}
    await use(process.env['TENANT_DOMAIN']);
  },
  database: async ({}, use) => {
    const database = drizzle({
      connection: process.env['DATABASE_URL']!,
      relations,
      ws: ws,
    });
    await use(database);
  },
  newUser: async ({}, use) => {
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
    await auth0.users.delete({ id: user.data.user_id });
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
});
