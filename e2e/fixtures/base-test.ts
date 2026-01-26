import { randFirstName, randLastName } from '@ngneat/falso';
import { init } from '@paralleldrive/cuid2';
import { test as base } from '@playwright/test';
import { ManagementClient } from 'auth0';
import { drizzle, NeonDatabase } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import { relations } from '../../src/db/relations';

const dedupeLength = 4;
const createDedupeId = init({ length: dedupeLength });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const auth0 = new ManagementClient({
  clientId: process.env['AUTH0_MANAGEMENT_CLIENT_ID']!,
  clientSecret: process.env['AUTH0_MANAGEMENT_CLIENT_SECRET']!,
  domain: 'tumi-dev.eu.auth0.com',
});

interface BaseFixtures {
  database: NeonDatabase<Record<string, never>, typeof relations>;
  newUser: {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
  };
}

export const test = base.extend<BaseFixtures>({
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
    const directId = isRecord(user) ? user['user_id'] : undefined;
    const data = isRecord(user) ? user['data'] : undefined;
    const dataId = isRecord(data) ? data['user_id'] : undefined;
    const userId =
      typeof directId === 'string'
        ? directId
        : directId instanceof String
          ? directId.toString()
          : typeof dataId === 'string'
            ? dataId
            : dataId instanceof String
              ? dataId.toString()
              : undefined;
    await use({ email, firstName, lastName, password });
    if (typeof userId === 'string' && userId.includes('|')) {
      try {
        await auth0.users.delete({ id: userId });
      } catch (error) {
        console.warn('Auth0 cleanup failed for test user:', error);
      }
    }
  },
  page: async ({ page }, use) => {
    page.on('pageerror', (error) => {
      const url = page.url();
      if (url && url.includes('localhost')) {
        throw error;
      } else {
        console.warn('Page error occurred but not throwing (non-localhost environment):', error);
      }
    });
    await use(page);
  },
  // tenantDomain: async ({}, use) => {
  //   try {
  //     const runtimePath = path.resolve('.e2e-runtime.json');
  //     if (fs.existsSync(runtimePath)) {
  //       const raw = fs.readFileSync(runtimePath, 'utf8');
  //       const data = JSON.parse(raw) as { tenantDomain?: string };
  //       await use(data.tenantDomain);
  //       return;
  //     }
  //   } catch {}
  //   await use(process.env['TENANT_DOMAIN']);
  // },
});
