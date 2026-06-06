interface RouteProbeOptions {
  fetchImplementation?: typeof fetch;
  writeError?: (message: string) => void;
  writeOutput?: (message: string) => void;
}

const defaultRoutePath = '/legal/terms';
const timeoutMs = 5000;

const normalizeProbeUrl = (
  baseUrl: string | undefined,
  routePath: string,
): undefined | URL => {
  if (!baseUrl?.trim()) {
    return undefined;
  }

  try {
    return new URL(routePath, baseUrl);
  } catch {
    return undefined;
  }
};

const isConnectionUnavailable = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('ECONNREFUSED') ||
    message.includes('Connection refused') ||
    message.includes('fetch failed')
  );
};

export const runLocalAppRouteProbe = async (
  options: RouteProbeOptions = {},
): Promise<boolean> => {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const writeError = options.writeError ?? console.error;
  const writeOutput = options.writeOutput ?? console.log;
  const probeUrl = normalizeProbeUrl(
    process.env['BASE_URL'],
    process.env['APP_ROUTE_PROBE_PATH']?.trim() || defaultRoutePath,
  );

  if (!probeUrl) {
    writeOutput('BASE_URL is missing or invalid; skipping app route probe.');
    return true;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImplementation(probeUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    if (response.ok) {
      writeOutput(`App route probe passed: ${probeUrl.toString()}`);
      return true;
    }

    writeError(
      `App route probe failed: ${probeUrl.toString()} returned HTTP ${response.status}. Run bun run docker:check to confirm whether another Evorto stack owns the selected port before using this app for Browser evidence.`,
    );
    return false;
  } catch (error) {
    if (isConnectionUnavailable(error)) {
      writeOutput(
        `No app currently serves ${probeUrl.toString()}; skipping app route probe.`,
      );
      return true;
    }

    writeError(
      `App route probe failed: ${probeUrl.toString()} could not be checked (${error instanceof Error ? error.message : String(error)}).`,
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

if (import.meta.main) {
  const passed = await runLocalAppRouteProbe();
  if (!passed) {
    process.exitCode = 1;
  }
}
