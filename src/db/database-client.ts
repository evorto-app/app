import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import { relations } from './relations';

export const database = drizzle({
  connection: process.env['DATABASE_URL']!,
  relations,

  ws: ws,
});
