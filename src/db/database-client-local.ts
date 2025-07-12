import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

import * as schema from './schema';

// Configure Neon Local endpoint
neonConfig.fetchEndpoint = 'http://localhost:5432/sql';

// Create a local Neon connection using the serverless driver
const sql = neon(process.env['DATABASE_URL_LOCAL'] || 'postgres://neon:npg@localhost:5432/neondb');

export const databaseLocal = drizzle(sql, { schema });