import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import { relations } from './relations';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

export const database = drizzle({
  connection: databaseUrl,
  relations,
  ws: ws,
});
