import { spawnSync } from 'node:child_process';

interface CommandResult {
  status: null | number;
  stderr: string;
  stdout: string;
}

interface RouteProbeOptions {
  fetchImplementation?: typeof fetch;
  runCommand?: (
    command: string,
    commandArguments: readonly string[],
  ) => CommandResult;
  writeError?: (message: string) => void;
  writeOutput?: (message: string) => void;
}

const defaultRoutePath = '/legal/terms';
const timeoutMs = 5000;
const localProbeHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const publishedPortExpression =
  /(?:^|[,\s])(?:0\.0\.0\.0|\[::\]|127\.0\.0\.1|\[::1\]|\*)?:(\d+)->/gu;

const defaultRunCommand = (
  command: string,
  commandArguments: readonly string[],
): CommandResult => {
  const result = spawnSync(command, [...commandArguments], {
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
};

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

const extractPublishedHostPorts = (ports: unknown): readonly string[] => {
  if (typeof ports !== 'string') {
    return [];
  }

  return [...ports.matchAll(publishedPortExpression)].map((match) => match[1]);
};

const findOtherEvortoComposePortOwners = (
  probeUrl: URL,
  runCommand: (
    command: string,
    commandArguments: readonly string[],
  ) => CommandResult,
): readonly { name: string; project: string }[] => {
  if (!localProbeHosts.has(probeUrl.hostname)) {
    return [];
  }

  const probePort =
    probeUrl.port || (probeUrl.protocol === 'https:' ? '443' : '80');
  const composeProjectName = process.env['COMPOSE_PROJECT_NAME']?.trim();
  const result = runCommand('docker', [
    'ps',
    '--format',
    '{{json .}}',
    '--filter',
    'label=com.docker.compose.project',
  ]);

  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as {
          Labels?: unknown;
          Names?: unknown;
          Ports?: unknown;
        };
        const labels = String(parsed.Labels ?? '');
        const project = /(?:^|,)com\.docker\.compose\.project=([^,]+)/u.exec(
          labels,
        )?.[1];

        if (
          !project ||
          project === composeProjectName ||
          !project.startsWith('evorto-') ||
          !extractPublishedHostPorts(parsed.Ports).includes(probePort)
        ) {
          return [];
        }

        return [
          {
            name: String(parsed.Names ?? '').trim() || '<unnamed>',
            project,
          },
        ];
      } catch {
        return [];
      }
    });
};

export const runLocalAppRouteProbe = async (
  options: RouteProbeOptions = {},
): Promise<boolean> => {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const runCommand = options.runCommand ?? defaultRunCommand;
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

  const otherPortOwners = findOtherEvortoComposePortOwners(
    probeUrl,
    runCommand,
  );
  if (otherPortOwners.length > 0) {
    writeOutput(
      [
        `Skipping app route probe for ${probeUrl.toString()} because another Evorto Compose project is publishing that port.`,
        ...otherPortOwners.map(
          ({ name, project }) =>
            `${name} from Compose project ${project}; stop it only if it is not active: COMPOSE_PROJECT_NAME=${project} docker compose down`,
        ),
      ].join('\n'),
    );
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
