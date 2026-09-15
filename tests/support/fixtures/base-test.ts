import { randFirstName, randLastName } from '@ngneat/falso';
import { init } from '@paralleldrive/cuid2';
import { test as base } from '@playwright/test';
import { ManagementClient } from 'auth0';
import { createNodePgPoolConfig } from '@db/pg-connection-config';
import { relations } from '@db/relations';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Option } from 'effect';
import fs from 'node:fs';
import { DateTime } from 'luxon';
import path from 'node:path';
import { Pool } from 'pg';

import { resolveLocalHostDatabaseEnvironment } from '../../../helpers/local-database-preflight';
import { getSeedDate } from '../../../helpers/seed-clock';
import { seedFalsoForScope } from '../../../helpers/seed-falso';
import { formatConfigError } from '../../../src/server/config/config-error';
import { requirePlatformAdministratorClaim } from '../auth0/platform-administrator-claim-fixture';
import { readProtectedEnvironmentValue } from '../protected-values';
import {
  auth0ManagementEnvironment,
  playwrightEnvironmentConfig,
} from '../config/environment';
import { runDatabaseCleanups } from '../utils/database-cleanup';
import {
  routeLocalTenantRequests,
  closeTenantRequestPages,
} from '../utils/tenant-request-routing';
import { withProtectedValueCaptureOptions } from '../utils/fill-protected-value';

const dedupeLength = 4;
const createDedupeId = init({ length: dedupeLength });
const runtimeConfigProvider = ConfigProvider.fromEnv();
const environment = Effect.runSync(
  playwrightEnvironmentConfig.pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, runtimeConfigProvider),
    Effect.mapError(
      (error) =>
        new Error(
          `Invalid Playwright e2e configuration:\n${formatConfigError(error)}`,
        ),
    ),
  ),
);
const readAuth0ManagementEnvironment = () =>
  Effect.runSync(
    auth0ManagementEnvironment.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        runtimeConfigProvider,
      ),
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid e2e auth configuration:\n${formatConfigError(error)}`,
          ),
      ),
    ),
  );
const createAuth0ManagementClient = () => {
  const auth0Environment = readAuth0ManagementEnvironment();
  return new ManagementClient({
    clientId: auth0Environment.AUTH0_MANAGEMENT_CLIENT_ID,
    clientSecret: auth0Environment.AUTH0_MANAGEMENT_CLIENT_SECRET,
    domain: new URL(environment.ISSUER_BASE_URL).hostname,
  });
};
process.env['E2E_NOW_ISO'] ??= environment.E2E_NOW_ISO;
process.env['E2E_SEED_KEY'] ??= environment.E2E_SEED_KEY;

interface BaseFixtures {
  database: NodePgDatabase<typeof relations>;
  databaseCleanups: Array<() => Promise<void>>;
  requirePlatformAdministratorClaim: (auth0Id: string) => Promise<void>;
  falsoSeed: string;
  newUser: {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
  };
  registerDatabaseCleanup: (
    cleanup: (database: NodePgDatabase<typeof relations>) => Promise<void>,
  ) => void;
  protectedValueCapturePolicy: void;
  seedDate: Date;
  testClock: DateTime;
  tenantDomain?: string;
}

export const test = base.extend<BaseFixtures>({
  database: [
    async ({ databaseCleanups }, use) => {
      const { databaseUrl } = resolveLocalHostDatabaseEnvironment({
        ...process.env,
        DATABASE_URL: environment.DATABASE_URL,
      });
      const pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
      const database = drizzle({
        client: pool,
        relations,
      });
      try {
        await use(database);
      } finally {
        await runDatabaseCleanups(databaseCleanups, () => pool.end());
      }
    },
    { timeout: 60_000 },
  ],
  databaseCleanups: async ({}, use) => {
    await use([]);
  },
  requirePlatformAdministratorClaim: async ({}, use) => {
    await use(async (auth0Id) => {
      const auth0 = createAuth0ManagementClient();
      await requirePlatformAdministratorClaim({
        readAppMetadata: async () => {
          const user = await auth0.users.get(auth0Id);
          return user.app_metadata;
        },
      });
    });
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
    const auth0 = createAuth0ManagementClient();
    const email = `test-${createDedupeId()}@evorto.app`;
    const password = readProtectedEnvironmentValue(
      'E2E_TRANSIENT_AUTH0_USER_PASSWORD',
    );
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
  page: [
    async ({ page, tenantDomain, testClock }, use) => {
      const fixedNow = testClock.toMillis();
      await page.addInitScript((value) => {
        const hostname = globalThis.location?.hostname ?? '';
        if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
          return;
        }
        const realDate = Date;
        const startedAt = performance.now();
        const currentTime = () =>
          Math.floor(value + (performance.now() - startedAt));
        class FixedDate extends realDate {
          constructor(...args: [] | ConstructorParameters<typeof realDate>) {
            if (args.length === 0) {
              super(currentTime());
              return;
            }
            super(...args);
          }

          static override now() {
            return currentTime();
          }
        }

        FixedDate.parse = realDate.parse;
        FixedDate.UTC = realDate.UTC;
        // @ts-expect-error Browser runtime override for deterministic tests.
        globalThis.Date = FixedDate;
      }, fixedNow);

      if (tenantDomain) {
        await routeLocalTenantRequests({
          baseUrl: environment.BASE_URL,
          context: page.context(),
          tenantDomain,
        });
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
      try {
        await use(page);
      } finally {
        await closeTenantRequestPages(page.context());
      }
    },
    { scope: 'test', timeout: 60_000 },
  ],
  protectedValueCapturePolicy: [
    async ({ contextOptions, screenshot, trace, video }, use) => {
      await withProtectedValueCaptureOptions(
        {
          contextOptions,
          screenshot,
          trace,
          video,
        },
        () => use(),
      );
    },
    { auto: true },
  ],
  registerDatabaseCleanup: async ({ database, databaseCleanups }, use) => {
    await use((cleanup) => databaseCleanups.push(() => cleanup(database)));
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
