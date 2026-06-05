import { spawn } from 'node:child_process';

export interface ComposeContainer {
  Health?: unknown;
  Name?: unknown;
  Service?: unknown;
  State?: unknown;
  Status?: unknown;
}

export interface DockerPsContainer {
  Names?: unknown;
  State?: unknown;
  Status?: unknown;
}

interface CommandResult {
  status: null | number;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

const commandTimeoutMs = 15_000;
const staleStates = new Set(['created', 'dead', 'removing']);

export const isCleanupTarget = ({
  health,
  state,
  status,
}: {
  health?: unknown;
  state?: unknown;
  status?: unknown;
}) => {
  const normalizedHealth = String(health ?? '').toLowerCase();
  const normalizedState = String(state ?? '').toLowerCase();
  const normalizedStatus = String(status ?? '').toLowerCase();

  return (
    staleStates.has(normalizedState) ||
    normalizedHealth === 'unhealthy' ||
    normalizedStatus.includes('unhealthy')
  );
};

const runCommand = (
  command: string,
  commandArguments: readonly string[],
): Promise<CommandResult> =>
  new Promise((resolve) => {
    const child = spawn(command, [...commandArguments], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;

    const finish = (status: null | number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        status,
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        timedOut,
      });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 1000).unref();
    }, commandTimeoutMs);
    timeout.unref();

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', () => finish(null));
    child.on('close', (status) => finish(status));
  });

export const parseComposeContainers = (
  source: string,
): readonly ComposeContainer[] => {
  const trimmedSource = source.trim();
  if (!trimmedSource) return [];

  try {
    const parsed = JSON.parse(trimmedSource) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as ComposeContainer[];
    }

    return typeof parsed === 'object' && parsed !== null
      ? [parsed as ComposeContainer]
      : [];
  } catch {
    return trimmedSource
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as ComposeContainer];
        } catch {
          return [];
        }
      });
  }
};

export const staleContainerNames = (containers: readonly ComposeContainer[]) =>
  containers.flatMap((container) => {
    const name = String(container.Name ?? '').trim();

    return isCleanupTarget({
      health: container.Health,
      state: container.State,
      status: container.Status,
    }) && name
      ? [name]
      : [];
  });

export const parseDockerPsContainers = (
  source: string,
): readonly DockerPsContainer[] =>
  source
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as DockerPsContainer];
      } catch {
        return [];
      }
    });

export const staleDockerPsContainerNames = (
  containers: readonly DockerPsContainer[],
) =>
  containers.flatMap((container) => {
    const name = String(container.Names ?? '').trim();

    return isCleanupTarget({
      state: container.State,
      status: container.Status,
    }) && name
      ? [name]
      : [];
  });

export const uniqueContainerNames = (containerNames: readonly string[]) => [
  ...new Set(containerNames),
];

const commandFailureReason = (result: CommandResult) =>
  result.timedOut
    ? `timed out after ${commandTimeoutMs / 1000}s`
    : result.stderr.trim() || result.stdout.trim();

const readContainerNamesFromDockerPs = async () => {
  const composeProjectName = process.env['COMPOSE_PROJECT_NAME']?.trim();

  if (!composeProjectName) {
    throw new Error(
      'COMPOSE_PROJECT_NAME is required when Docker Compose project inspection is unavailable.',
    );
  }

  const dockerPsResult = await runCommand('docker', [
    'ps',
    '-a',
    '--filter',
    `label=com.docker.compose.project=${composeProjectName}`,
    '--format',
    '{{json .}}',
  ]);

  if (dockerPsResult.status !== 0) {
    throw new Error(
      `Unable to inspect Docker Compose project containers through docker ps: ${commandFailureReason(dockerPsResult)}`,
    );
  }

  return staleDockerPsContainerNames(
    parseDockerPsContainers(dockerPsResult.stdout),
  );
};

const main = async () => {
  const inspectResult = await runCommand('docker', [
    'compose',
    'ps',
    '--all',
    '--format',
    'json',
  ]);

  const containerNames = uniqueContainerNames(
    inspectResult.status === 0
      ? staleContainerNames(parseComposeContainers(inspectResult.stdout))
      : await readContainerNamesFromDockerPs(),
  );

  if (containerNames.length === 0) {
    console.log(
      'No stale or unhealthy Docker Compose project containers found.',
    );
    return;
  }

  console.log(
    `Removing stale or unhealthy Docker Compose project containers:\n${containerNames
      .map((name) => `- ${name}`)
      .join('\n')}`,
  );

  for (const containerName of containerNames) {
    const result = await runCommand('docker', [
      'rm',
      '-f',
      '-v',
      containerName,
    ]);

    if (result.status !== 0) {
      throw new Error(
        `Failed to remove stale Docker Compose container ${containerName}: ${commandFailureReason(result)}`,
      );
    }
  }
};

if (import.meta.main) {
  await main();
}
