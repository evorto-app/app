import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import * as schema from './schema';

export const database = drizzle({
  connection: process.env['DATABASE_URL']!,
  schema,
  ws: ws,
});
