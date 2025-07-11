import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import { databaseLocal } from './database-client-local';
import * as schema from './schema';

// Use local database if NODE_ENV is development and DATABASE_URL_LOCAL is set
const useLocalDatabase = process.env['NODE_ENV'] === 'development' && 
  (process.env['DATABASE_URL_LOCAL'] || process.env['USE_LOCAL_DATABASE'] === 'true');

export const database = useLocalDatabase
  ? databaseLocal
  : drizzle({
      connection: process.env['DATABASE_URL']!,
      schema,
      ws: ws,
    });
