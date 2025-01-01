import { test as base } from '@playwright/test';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '../../src/db/schema';

interface BaseFixtures {
  database: NeonHttpDatabase<typeof schema>;
}

export const test = base.extend<BaseFixtures>({
  database: async ({}, use) => {
    const database = drizzle(process.env['DATABASE_URL']!, {
      schema,
    });
    await use(database);
  },
  page: async ({ page }, use) => {
    page.on('pageerror', (error) => {
      throw error;
    });
    await use(page);
  },
});
