import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import * as schema from '../old/drizzle';

export const oldDatabase = drizzle({
  connection: process.env['NEON_PROD_CONNECTION']!,
  schema,
  ws: ws,
});
