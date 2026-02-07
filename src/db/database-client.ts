import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import { getDatabaseEnvironment } from '../server/config/environment';
import { relations } from './relations';

const { DATABASE_URL: databaseUrl } = getDatabaseEnvironment();

export const database = drizzle({
  connection: databaseUrl,
  relations,
  ws: ws,
});
