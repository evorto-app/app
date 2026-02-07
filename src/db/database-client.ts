import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import { getDatabaseEnvironment } from '../server/config/environment';
import { configureNeonLocalProxy } from './configure-neon-local';
import { relations } from './relations';

const { DATABASE_URL: databaseUrl } = getDatabaseEnvironment();
configureNeonLocalProxy(databaseUrl);
const isBunRuntime = (globalThis as { Bun?: unknown }).Bun !== undefined;
const useNeonLocalProxy = (() => {
  if (process.env['NEON_LOCAL_PROXY'] === 'true') {
    return true;
  }

  try {
    const hostname = new URL(databaseUrl).hostname;
    return (
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === 'db'
    );
  } catch {
    return false;
  }
})();
const shouldProvideWebSocket = !isBunRuntime && !useNeonLocalProxy;

export const database = drizzle({
  connection: databaseUrl,
  relations,
  ...(shouldProvideWebSocket ? { ws: ws } : {}),
});
