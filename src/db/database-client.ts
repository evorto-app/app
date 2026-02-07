import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import { getDatabaseEnvironment } from '../server/config/environment';
import { configureNeonLocalProxy } from './configure-neon-local';
import { relations } from './relations';

const { DATABASE_URL: databaseUrl } = getDatabaseEnvironment();
configureNeonLocalProxy(databaseUrl);
const isBunRuntime =
  (globalThis as { Bun?: unknown }).Bun !== undefined;

export const database = drizzle({
  connection: databaseUrl,
  relations,
  ...(isBunRuntime ? {} : { ws: ws }),
});
