import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import ws from 'ws';

import { relations } from './relations';

// Configure neon-local for serverless driver when using local database
if (process.env['DATABASE_URL']?.includes('db:5432')) {
  neonConfig.fetchEndpoint = 'http://db:5432/sql';
}
if (process.env['DATABASE_URL']?.includes('localhost:5432')) {
  neonConfig.fetchEndpoint = 'http://localhost:5432/sql';
}

const sql = neon(process.env['DATABASE_URL']!);

export const database = drizzle({
  client: sql,
  relations,
  // ws: ws,
});
