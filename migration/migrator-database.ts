import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import { relations } from '../old/drizzle';

export const oldDatabase = drizzle({
  connection: process.env['NEON_PROD_CONNECTION']!,
  relations,
  ws: ws,
});
