import { randFirstName, randLastName } from '@ngneat/falso';
import { init } from '@paralleldrive/cuid2';
import { test as base } from '@playwright/test';
import { ManagementClient } from 'auth0';
import { createNodePgPoolConfig } from '@db/pg-connection-config';
import { relations } from '@db/relations';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigError, ConfigProvider, Effect, Option } from 'effect';
import fs from 'node:fs';
import { DateTime } from 'luxon';
import path from 'node:path';
import { Pool } from 'pg';

import { getSeedDate } from '../../../helpers/seed-clock';
import { seedFalsoForScope } from '../../../helpers/seed-falso';
import { formatConfigError } from '../../../src/server/config/config-error';
import {
  auth0ManagementEnvironment,
  playwrightEnvironmentConfig,
} from '../config/environment';

const dedupeLength = 4;
const createDedupeId = init({ length: dedupeLength });
const runtimeConfigProvider = ConfigProvider.fromEnv();
const environment = Effect.runSync(
  playwrightEnvironmentConfig.pipe(
    Effect.withConfigProvider(runtimeConfigProvider),
    Effect.mapError(
      (error: ConfigError.ConfigError) =>
        new Error(
          `Invalid Playwright e2e configuration:\n${formatConfigError(error)}`,
        ),
    ),
  ),
);
const auth0Environment = Effect.runSync(
  auth0ManagementEnvironment.pipe(
    Effect.withConfigProvider(runtimeConfigProvider),
    Effect.mapError(
      (error: ConfigError.ConfigError) =>
        new Error(
          `Invalid e2e auth configuration:\n${formatConfigError(error)}`,
        ),
    ),
  ),
);
process.env['E2E_NOW_ISO'] ??= environment.E2E_NOW_ISO;
process.env['E2E_SEED_KEY'] ??= environment.E2E_SEED_KEY;
const databaseUrl = environment.DATABASE_URL;

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
  testClock: DateTime;
  tenantDomain?: string;
}

export const test = base.extend<BaseFixtures>({
  database: async ({}, use) => {
    const pool = new Pool(
      createNodePgPoolConfig({
        databaseUrl,
        neonLocalProxy: environment.NEON_LOCAL_PROXY,
      }),
    );
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
  page: async ({ page, tenantDomain, testClock }, use) => {
    const fixedNow = testClock.toMillis();
    await page.addInitScript((value) => {
      const hostname = globalThis.location?.hostname ?? '';
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        return;
      }
      const realDate = Date;
      class FixedDate extends realDate {
        constructor(...args: [] | ConstructorParameters<typeof realDate>) {
          if (args.length === 0) {
            super(value);
            return;
          }
          super(...args);
        }

        static override now() {
          return value;
        }
      }

      FixedDate.parse = realDate.parse;
      FixedDate.UTC = realDate.UTC;
      // @ts-expect-error Browser runtime override for deterministic tests.
      globalThis.Date = FixedDate;
    }, fixedNow);

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
    await use(Option.getOrUndefined(environment.TENANT_DOMAIN));
  },
  testClock: [
    async ({ seedDate }, use) => {
      await use(
        DateTime.fromJSDate(seedDate, { zone: 'utc' }).plus({ hours: 12 }),
      );
    },
    { auto: true },
  ],
});
