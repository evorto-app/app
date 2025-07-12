import { drizzle } from 'drizzle-orm/neon-serverless';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

import { relations } from './relations';

// Configure neon-local for serverless driver when using local database
if (process.env['DATABASE_URL']?.includes('localhost:5432')) {
  neonConfig.fetchEndpoint = 'http://localhost:5432/sql';
}

export const database = drizzle({
  connection: process.env['DATABASE_URL']!,
  relations,
  ws: ws,
});
