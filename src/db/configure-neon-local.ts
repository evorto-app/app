import { neonConfig } from '@neondatabase/serverless';

let neonLocalConfigured = false;
const isBunRuntime = (globalThis as { Bun?: unknown }).Bun !== undefined;

const localHosts = new Set(['127.0.0.1', 'db', 'localhost']);

const shouldConfigureNeonLocal = (
  databaseUrl: string,
  forceNeonLocalProxy: boolean,
): undefined | URL => {
  try {
    const url = new URL(databaseUrl);
    if (forceNeonLocalProxy || localHosts.has(url.hostname)) {
      return url;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

export const configureNeonLocalProxy = (
  databaseUrl: string,
  input: NodeJS.ProcessEnv = process.env,
): void => {
  if (neonLocalConfigured) return;

  // Bun's ws behavior can be flaky with Neon pooled connections; prefer fetch transport.
  if (isBunRuntime) {
    neonConfig.poolQueryViaFetch = true;
  }

  const forceNeonLocalProxy = input['NEON_LOCAL_PROXY'] === 'true';
  const databaseUrlObject = shouldConfigureNeonLocal(
    databaseUrl,
    forceNeonLocalProxy,
  );

  if (!databaseUrlObject) return;

  const host = databaseUrlObject.hostname;
  const port = databaseUrlObject.port || '5432';

  neonConfig.fetchEndpoint = `http://${host}:${port}/sql`;
  neonConfig.wsProxy = `${host}:${port}/v2`;
  neonConfig.poolQueryViaFetch = true;
  neonConfig.useSecureWebSocket = false;

  neonLocalConfigured = true;
};
