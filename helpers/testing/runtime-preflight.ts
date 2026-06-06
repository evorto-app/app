import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isCleanupTarget,
  parseComposeContainers,
} from './remove-stale-compose-containers';

// Runtime preflight runs before local runtime commands so missing secrets,
// broken Compose config, missing browsers, or closed database ports fail clearly
// before the app starts.
export type RuntimeTarget = 'dev' | 'docker';

type RequiredVariable = {
  description: string;
  name: string;
};

type RuntimeCheckSeverity = 'failure' | 'ok' | 'warning';

type RuntimeCheck = {
  details?: readonly string[];
  label: string;
  severity: RuntimeCheckSeverity;
};

type CommandResult = {
  errorMessage?: string;
  stderr: string;
  stdout: string;
  status: null | number;
};

type RuntimePreflightOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fileExists?: (filePath: string) => boolean;
  runCommand?: (command: string, args: readonly string[]) => CommandResult;
};

const commandTimeoutMs = 15_000;

export const requiredByTarget = {
  dev: [
    {
      description: 'Browser-facing application URL',
      name: 'BASE_URL',
    },
    {
      description: 'Database connection for server-side rendering and RPC',
      name: 'DATABASE_URL',
    },
    {
      description: 'Auth0 application id',
      name: 'CLIENT_ID',
    },
    {
      description: 'Auth0 application secret',
      name: 'CLIENT_SECRET',
    },
    {
      description: 'Auth0 issuer URL',
      name: 'ISSUER_BASE_URL',
    },
    {
      description: 'Application session secret',
      name: 'SECRET',
    },
  ],
  docker: [
    {
      description: 'Neon Local branch creation',
      name: 'NEON_API_KEY',
    },
    {
      description: 'Neon Local project selection',
      name: 'NEON_PROJECT_ID',
    },
    {
      description: 'Auth0 application id',
      name: 'CLIENT_ID',
    },
    {
      description: 'Auth0 application secret',
      name: 'CLIENT_SECRET',
    },
    {
      description: 'Auth0 issuer URL',
      name: 'ISSUER_BASE_URL',
    },
    {
      description: 'Application session secret',
      name: 'SECRET',
    },
    {
      description: 'Stripe API access for paid registration flows',
      name: 'STRIPE_API_KEY',
    },
    {
      description: 'Stripe connected account id for seeded paid flows',
      name: 'STRIPE_TEST_ACCOUNT_ID',
    },
  ],
} satisfies Record<RuntimeTarget, RequiredVariable[]>;

export const optionalByTarget = {
  dev: [],
  docker: [],
} satisfies Record<RuntimeTarget, RequiredVariable[]>;

const targets = new Set<RuntimeTarget>(['dev', 'docker']);

const readTarget = (): RuntimeTarget => {
  const target = process.argv[2];
  if (targets.has(target as RuntimeTarget)) {
    return target as RuntimeTarget;
  }

  console.error(
    `Usage: bun helpers/testing/runtime-preflight.ts ${Array.from(targets).join('|')}`,
  );
  process.exit(2);
};

const isPresent = (env: NodeJS.ProcessEnv, name: string): boolean => {
  const value = env[name];
  return value !== undefined && value.trim().length > 0;
};

const defaultRunCommand = (
  command: string,
  args: readonly string[],
): CommandResult => {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    timeout: commandTimeoutMs,
  });

  return {
    errorMessage: result.error?.message,
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
};

const firstLine = (value: string): string | undefined =>
  value
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

const commandCheck = (
  label: string,
  command: string,
  args: readonly string[],
  severityOnFailure: Exclude<RuntimeCheckSeverity, 'ok'>,
  runCommand: (command: string, args: readonly string[]) => CommandResult,
): RuntimeCheck => {
  const result = runCommand(command, args);
  const output = firstLine(result.stdout) ?? firstLine(result.stderr);

  if (result.status === 0) {
    return {
      details: output ? [output] : undefined,
      label,
      severity: 'ok',
    };
  }

  return {
    details: output ? [output] : undefined,
    label,
    severity: severityOnFailure,
  };
};

const dockerComposeProjectContainerCheck = (
  runCommand: (
    command: string,
    commandArguments: readonly string[],
  ) => CommandResult,
): RuntimeCheck => {
  const label = 'Docker Compose project containers';
  const result = runCommand('docker', [
    'compose',
    'ps',
    '--all',
    '--format',
    'json',
  ]);

  if (result.status !== 0) {
    const timedOut =
      result.status === null ||
      result.errorMessage?.toLowerCase().includes('etimedout') === true;

    return {
      details: [
        timedOut
          ? `Timed out after ${commandTimeoutMs / 1000}s while inspecting Docker Compose project containers.`
          : (firstLine(result.stderr) ??
            firstLine(result.stdout) ??
            result.errorMessage ??
            'Unable to inspect Docker Compose project containers.'),
        'Resolve stale Docker Compose containers before starting Docker; uninspectable project state can make docker compose up/down hang before Browser verification can run.',
        'Run `bun run docker:clean-stale` to attempt bounded cleanup of the generated Compose project containers.',
        'If bounded cleanup also times out, restart Docker Desktop or the Docker engine before retrying; Docker container removal is then blocked below the app tooling layer.',
      ],
      label,
      severity: 'failure',
    };
  }

  const containers = parseComposeContainers(result.stdout);
  const stalledContainers = containers.flatMap((container) => {
    if (
      !isCleanupTarget({
        health: container.Health,
        state: container.State,
        status: container.Status,
      })
    ) {
      return [];
    }

    const service = String(container.Service ?? 'unknown-service');
    const name = String(container.Name ?? '').trim() || service;
    const status = String(container.Status ?? container.State ?? 'unknown');
    return [`${name} (${service}) is ${status}`];
  });

  if (stalledContainers.length === 0) {
    return {
      details:
        containers.length === 0
          ? ['No Docker Compose project containers currently exist.']
          : [
              `${containers.length} Docker Compose project container(s) inspectable.`,
            ],
      label,
      severity: 'ok',
    };
  }

  return {
    details: [
      ...stalledContainers,
      'Remove stale created/dead/removing or unhealthy containers before starting Docker; they can make docker compose up/down hang before Browser verification can run.',
      'Run `bun run docker:clean-stale` to attempt bounded cleanup of the generated Compose project containers.',
      'If the container is still running or bounded cleanup also times out, run `docker compose down` for the generated project or restart Docker Desktop before retrying; Docker container removal is then blocked below the app tooling layer.',
    ],
    label,
    severity: 'failure',
  };
};

const publishedPortExpression =
  /(?:^|[,\s])(?:0\.0\.0\.0|\[::\]|127\.0\.0\.1|\[::1\]|\*)?:(\d+)->/gu;

const extractPublishedHostPorts = (ports: unknown): readonly string[] => {
  if (typeof ports !== 'string') {
    return [];
  }

  return [...ports.matchAll(publishedPortExpression)].map((match) => match[1]);
};

const auth0RegisteredPortConflictCheck = (
  environment: NodeJS.ProcessEnv,
  runCommand: (
    command: string,
    commandArguments: readonly string[],
  ) => CommandResult,
): RuntimeCheck => {
  const appHostPort = environment['APP_HOST_PORT']?.trim();
  const composeProjectName = environment['COMPOSE_PROJECT_NAME']?.trim();
  const label = 'Auth0 registered app port';

  if (!appHostPort) {
    return {
      details: ['APP_HOST_PORT is missing; skipping cross-project port check.'],
      label,
      severity: 'ok',
    };
  }

  const result = runCommand('docker', [
    'ps',
    '--format',
    '{{json .}}',
    '--filter',
    'label=com.docker.compose.project',
  ]);

  if (result.status !== 0) {
    return {
      details: [
        firstLine(result.stderr) ??
          firstLine(result.stdout) ??
          result.errorMessage ??
          'Unable to inspect running Docker Compose containers.',
        `If Auth0 login fails locally, check whether another Evorto stack is already publishing localhost:${appHostPort}.`,
      ],
      label,
      severity: 'warning',
    };
  }

  const conflicts = result.stdout
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
          !project.startsWith('evorto-')
        ) {
          return [];
        }

        if (!extractPublishedHostPorts(parsed.Ports).includes(appHostPort)) {
          return [];
        }

        const name = String(parsed.Names ?? '').trim() || '<unnamed>';
        return [`${name} from Compose project ${project}`];
      } catch {
        return [];
      }
    });

  if (conflicts.length === 0) {
    return {
      details: [
        `No other Evorto Compose project is publishing ${appHostPort}.`,
      ],
      label,
      severity: 'ok',
    };
  }

  return {
    details: [
      ...conflicts,
      `Another Evorto stack is already publishing localhost:${appHostPort}. Auth0 callbacks are usually registered for this port, so generated fallback ports can fail authenticated Browser and Playwright verification.`,
      'Stop the owning stack if it is not active: COMPOSE_PROJECT_NAME=<project> docker compose down',
    ],
    label,
    severity: 'warning',
  };
};

const dockerContainerStartCheck = (
  runCommand: (
    command: string,
    commandArguments: readonly string[],
  ) => CommandResult,
): RuntimeCheck => {
  const label = 'Docker container start path';
  const containerName = `evorto-runtime-preflight-${process.pid}`;
  const timeoutSeconds = String(commandTimeoutMs / 1000);
  const cleanupTimeoutSeconds = String(commandTimeoutMs / 1000);
  const result = runCommand('sh', [
    '-c',
    `
container_name="$1"
timeout_seconds="$2"
cleanup_timeout_seconds="$3"
docker rm -f -v "$container_name" >/dev/null 2>&1 || true
docker run --name "$container_name" --rm --pull missing alpine:latest true &
docker_pid="$!"
elapsed=0
while [ "$elapsed" -lt "$timeout_seconds" ]; do
  if ! kill -0 "$docker_pid" 2>/dev/null; then
    wait "$docker_pid"
    exit "$?"
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done
echo "Timed out after ${timeoutSeconds}s while starting a disposable Alpine container." >&2
kill -9 "$docker_pid" 2>/dev/null || true
docker rm -f -v "$container_name" >/dev/null 2>&1 &
cleanup_pid="$!"
cleanup_elapsed=0
while [ "$cleanup_elapsed" -lt "$cleanup_timeout_seconds" ]; do
  if ! kill -0 "$cleanup_pid" 2>/dev/null; then
    wait "$cleanup_pid"
    echo "Removed disposable preflight container $container_name after the timed-out start probe." >&2
    exit 124
  fi
  sleep 1
  cleanup_elapsed=$((cleanup_elapsed + 1))
done
echo "Timed out after ${cleanupTimeoutSeconds}s while removing disposable preflight container $container_name." >&2
kill -9 "$cleanup_pid" 2>/dev/null || true
exit 124
`.trim(),
    'docker-container-start-check',
    containerName,
    timeoutSeconds,
    cleanupTimeoutSeconds,
  ]);

  if (result.status === 0) {
    return {
      details: ['A disposable Alpine container started successfully.'],
      label,
      severity: 'ok',
    };
  }

  const timedOut =
    result.status === null ||
    result.status === 124 ||
    result.errorMessage?.toLowerCase().includes('etimedout') === true;

  return {
    details: [
      timedOut
        ? `Timed out after ${commandTimeoutMs / 1000}s while starting a disposable Alpine container.`
        : (firstLine(result.stderr) ??
          firstLine(result.stdout) ??
          result.errorMessage ??
          'Unable to start a disposable Alpine container.'),
      'Docker can inspect local configuration but cannot start containers; Browser verification and Docker-backed Playwright are blocked below the app tooling layer.',
      `Attempted bounded cleanup for disposable preflight container ${containerName}; if Docker removal also times out, restart Docker Desktop or the Docker engine.`,
    ],
    label,
    severity: 'failure',
  };
};

const localDatabaseHosts = new Set(['127.0.0.1', '::1', 'localhost']);

const normalizedHost = (host: string): string =>
  host.replaceAll(/^\[|\]$/g, '');

const databaseConnectivityCheck = (
  environment: NodeJS.ProcessEnv,
  runCommand: (
    command: string,
    commandArguments: readonly string[],
  ) => CommandResult,
): RuntimeCheck => {
  const databaseUrl = environment['DATABASE_URL']?.trim();
  const label = 'Database endpoint';

  if (!databaseUrl) {
    return {
      details: ['DATABASE_URL is missing; the dev server cannot render pages.'],
      label,
      severity: 'failure',
    };
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    return {
      details: ['DATABASE_URL is not a valid URL.'],
      label,
      severity: 'failure',
    };
  }

  const host = normalizedHost(parsedDatabaseUrl.hostname);
  const port = parsedDatabaseUrl.port || '5432';
  if (!localDatabaseHosts.has(host)) {
    return {
      details: [
        `DATABASE_URL uses non-local host ${host}; skipping local port probe.`,
      ],
      label,
      severity: 'ok',
    };
  }

  const result = runCommand('nc', ['-z', host, port]);
  if (result.status === 0) {
    return {
      details: [`DATABASE_URL endpoint ${host}:${port} is reachable.`],
      label,
      severity: 'ok',
    };
  }

  return {
    details: [
      `DATABASE_URL points at ${host}:${port}, but no local database endpoint is reachable.`,
      'Start the generated Docker stack with bun run docker:start, or set DATABASE_URL to a reachable database before bun run dev:start.',
      firstLine(result.stderr) ??
        firstLine(result.stdout) ??
        'Port probe failed.',
    ],
    label,
    severity: 'failure',
  };
};

const readPlaywrightInstallLocations = (output: string): readonly string[] => {
  const locations = new Set<string>();
  const installLocationExpression = /^\s*Install location:\s*(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = installLocationExpression.exec(output)) !== null) {
    locations.add(match[1].trim());
  }

  return [...locations];
};

const systemChromeLocations = [
  '/Applications/Google Chrome.app',
  '/Applications/Google Chrome Canary.app',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
] as const;

const playwrightBrowserCheck = (
  env: NodeJS.ProcessEnv,
  fileExists: (filePath: string) => boolean,
  runCommand: (command: string, args: readonly string[]) => CommandResult,
): RuntimeCheck => {
  if (env['E2E_BROWSER_CHANNEL'] === 'chrome') {
    const availableChromeLocation = systemChromeLocations.find((location) =>
      fileExists(location),
    );

    if (availableChromeLocation) {
      return {
        details: [
          `Using E2E_BROWSER_CHANNEL=chrome with ${availableChromeLocation}`,
        ],
        label: 'Playwright system Chrome browser channel',
        severity: 'ok',
      };
    }

    return {
      details: [
        'E2E_BROWSER_CHANNEL=chrome is set, but no system Chrome installation was found.',
        'Unset E2E_BROWSER_CHANNEL and run bun run test:e2e:install, or install Google Chrome for local exploratory runs.',
      ],
      label: 'Playwright system Chrome browser channel',
      severity: 'warning',
    };
  }

  const result = runCommand('bunx', [
    'playwright',
    'install',
    '--dry-run',
    'chromium',
  ]);

  if (result.status !== 0) {
    return {
      details: [
        firstLine(result.stderr) ??
          firstLine(result.stdout) ??
          'Unable to inspect Playwright browser installation',
      ],
      label: 'Playwright Chromium browser installation',
      severity: 'warning',
    };
  }

  const locations = readPlaywrightInstallLocations(result.stdout);
  const missing = locations.filter((location) => !fileExists(location));
  const availableChromeLocation = systemChromeLocations.find((location) =>
    fileExists(location),
  );

  if (missing.length === 0) {
    return {
      details: [`${locations.length} required cache location(s) present`],
      label: 'Playwright Chromium browser installation',
      severity: 'ok',
    };
  }

  return {
    details: [
      ...missing.map((location) => `Missing ${location}`),
      'Run bun run test:e2e:install before local Playwright runs.',
      ...(availableChromeLocation
        ? [
            `Or set E2E_BROWSER_CHANNEL=chrome to use ${availableChromeLocation} for local exploratory runs.`,
          ]
        : []),
    ],
    label: 'Playwright Chromium browser installation',
    severity: 'warning',
  };
};

const stripeWebhookSecretSourceCheck = (
  env: NodeJS.ProcessEnv,
): RuntimeCheck => {
  if (isPresent(env, 'STRIPE_WEBHOOK_SECRET')) {
    return {
      details: ['Using STRIPE_WEBHOOK_SECRET from the local environment.'],
      label: 'Stripe webhook signing secret source',
      severity: 'ok',
    };
  }

  return {
    details: [
      'Docker Stripe CLI writes its generated signing secret to STRIPE_WEBHOOK_SECRET_FILE for the app container.',
    ],
    label: 'Stripe webhook signing secret source',
    severity: 'ok',
  };
};

const databaseTarget = (databaseUrl: string | undefined): string => {
  if (!databaseUrl?.trim()) {
    return 'DATABASE_URL=<missing>';
  }

  try {
    const parsed = new URL(databaseUrl);
    const host = normalizedHost(parsed.hostname);
    const port = parsed.port || '5432';
    const database = parsed.pathname.replace(/^\//u, '') || '<missing-db>';

    return `DATABASE_URL target=${host}:${port}/${database}`;
  } catch {
    return 'DATABASE_URL=<invalid-url>';
  }
};

const runtimeTargetCheck = (
  target: RuntimeTarget,
  environment: NodeJS.ProcessEnv,
): RuntimeCheck => {
  const details = [
    `BASE_URL=${environment['BASE_URL']?.trim() || '<missing>'}`,
    databaseTarget(environment['DATABASE_URL']),
  ];

  if (target === 'docker') {
    details.push(
      `COMPOSE_PROJECT_NAME=${environment['COMPOSE_PROJECT_NAME']?.trim() || '<missing>'}`,
      `APP_HOST_PORT=${environment['APP_HOST_PORT']?.trim() || '<missing>'}`,
      `NEON_LOCAL_HOST_PORT=${environment['NEON_LOCAL_HOST_PORT']?.trim() || '<missing>'}`,
      `NEON_LOCAL_METADATA_DIR=${environment['NEON_LOCAL_METADATA_DIR']?.trim() || '<missing>'}`,
    );
  }

  return {
    details,
    label: 'Runtime target',
    severity: 'ok',
  };
};

const developerSecretsFileCheck = (
  cwd: string,
  environment: NodeJS.ProcessEnv,
  fileExists: (filePath: string) => boolean,
  missingVariables: readonly RequiredVariable[],
): RuntimeCheck => {
  if (missingVariables.length === 0) {
    return {
      details: ['Required variables are loaded from the local environment.'],
      label: 'Developer secrets file',
      severity: 'ok',
    };
  }

  const repositoryName = path.basename(cwd);
  const homeDirectory = environment['HOME']?.trim() || os.homedir();
  const mainCheckoutEnvironmentPath = path.join(
    homeDirectory,
    'code',
    repositoryName,
    '.env',
  );

  if (fileExists(mainCheckoutEnvironmentPath)) {
    return {
      details: [
        `Found a main-checkout developer secrets file at ${mainCheckoutEnvironmentPath}.`,
        'Copy it safely with: bun run env:copy-main -- --if-missing',
        'For a fresh dev-server worktree, run: bun run dev:bootstrap',
        `Source: ${mainCheckoutEnvironmentPath}`,
        'Do not copy .env.dev or .npmrc; .env.dev is generated per worktree and Font Awesome must stay on the public npm registry.',
      ],
      label: 'Developer secrets file',
      severity: 'warning',
    };
  }

  return {
    details: [
      `No main-checkout developer secrets file found at ${mainCheckoutEnvironmentPath}.`,
      `Use ${path.join(cwd, '.env.example')} as the no-secret checklist, then add missing values to ${path.join(cwd, '.env')} or your shell environment.`,
    ],
    label: 'Developer secrets file',
    severity: 'warning',
  };
};

const missingRequiredVariableDetails = (
  cwd: string,
  environment: NodeJS.ProcessEnv,
  fileExists: (filePath: string) => boolean,
  missingVariables: readonly RequiredVariable[],
): readonly string[] => {
  if (missingVariables.length === 0) {
    return ['All required variables are present.'];
  }

  const details = missingVariables.map(
    ({ description, name }) => `${name}: ${description}`,
  );
  const repositoryName = path.basename(cwd);
  const homeDirectory = environment['HOME']?.trim() || os.homedir();
  const mainCheckoutEnvironmentPath = path.join(
    homeDirectory,
    'code',
    repositoryName,
    '.env',
  );

  if (fileExists(mainCheckoutEnvironmentPath)) {
    return [
      ...details,
      'Missing variables may be recoverable from the main checkout secrets file.',
      'Run `bun run env:copy-main -- --if-missing` to copy only `.env` from the default main checkout, then retry the original command.',
      'For a fresh dev-server worktree, run `bun run dev:bootstrap`.',
      'For another source checkout, run `MAIN_CHECKOUT_DIR=/path/to/repo bun run env:copy-main -- --if-missing`.',
    ];
  }

  return [
    ...details,
    `No main-checkout developer secrets file was found at ${mainCheckoutEnvironmentPath}.`,
    `Use ${path.join(cwd, '.env.example')} as the no-secret checklist, then add missing values to ${path.join(cwd, '.env')} or your shell environment.`,
  ];
};

export const evaluateRuntimePreflight = (
  target: RuntimeTarget,
  options: RuntimePreflightOptions = {},
) => {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? fs.existsSync;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const missingVariables = requiredByTarget[target].filter(
    ({ name }) => !isPresent(env, name),
  );
  const presentVariables = requiredByTarget[target].filter(({ name }) =>
    isPresent(env, name),
  );
  const missingOptionalVariables = optionalByTarget[target].filter(
    ({ name }) => !isPresent(env, name),
  );
  const presentOptionalVariables = optionalByTarget[target].filter(({ name }) =>
    isPresent(env, name),
  );
  const checks: RuntimeCheck[] = [
    runtimeTargetCheck(target, env),
    {
      details: missingRequiredVariableDetails(
        cwd,
        environment,
        fileExists,
        missingVariables,
      ),
      label: `Required ${target} runtime variables`,
      severity: missingVariables.length > 0 ? 'failure' : 'ok',
    },
    {
      details:
        presentVariables.length > 0
          ? presentVariables.map(
              ({ description, name }) => `${name}: ${description}`,
            )
          : ['No required variables are currently available.'],
      label: `Available ${target} runtime variables`,
      severity: 'ok',
    },
    developerSecretsFileCheck(cwd, env, fileExists, missingVariables),
    {
      details:
        optionalByTarget[target].length > 0
          ? [
              ...presentOptionalVariables.map(
                ({ description, name }) => `${name}: ${description}`,
              ),
              ...missingOptionalVariables.map(
                ({ description, name }) => `missing ${name}: ${description}`,
              ),
            ]
          : ['No optional variables are configured for this target.'],
      label: `Optional ${target} variables`,
      severity: 'ok',
    },
    {
      details: [path.join(cwd, '.env.dev')],
      label: 'Generated worktree runtime env file',
      severity: fileExists(path.join(cwd, '.env.dev')) ? 'ok' : 'failure',
    },
    commandCheck('Bun runtime', 'bun', ['--version'], 'failure', runCommand),
    ...(target === 'dev'
      ? [databaseConnectivityCheck(env, runCommand)]
      : [
          commandCheck(
            'Docker Compose',
            'docker',
            ['compose', 'version'],
            'failure',
            runCommand,
          ),
          commandCheck(
            'Docker Compose config',
            'docker',
            ['compose', 'config', '--quiet'],
            'failure',
            runCommand,
          ),
          dockerContainerStartCheck(runCommand),
          dockerComposeProjectContainerCheck(runCommand),
          auth0RegisteredPortConflictCheck(environment, runCommand),
          commandCheck(
            'Playwright CLI',
            'bunx',
            ['playwright', '--version'],
            'warning',
            runCommand,
          ),
          stripeWebhookSecretSourceCheck(env),
          playwrightBrowserCheck(env, fileExists, runCommand),
        ]),
  ];

  return {
    checks,
    failed: checks.some((check) => check.severity === 'failure'),
    warned: checks.some((check) => check.severity === 'warning'),
  };
};

const markerBySeverity: Record<RuntimeCheckSeverity, string> = {
  failure: '[fail]',
  ok: '[ok]',
  warning: '[warn]',
};

const printResult = (
  target: RuntimeTarget,
  result: ReturnType<typeof evaluateRuntimePreflight>,
) => {
  console.log(`Runtime preflight for ${target}:`);

  for (const check of result.checks) {
    console.log(`${markerBySeverity[check.severity]} ${check.label}`);
    for (const detail of check.details ?? []) {
      console.log(`  - ${detail}`);
    }
  }

  if (result.failed) {
    const targetLabel = target === 'docker' ? 'Docker' : 'the dev server';
    console.log(
      `Fix failed checks before starting ${targetLabel}. Use .env.example as the checklist, then add secret values to .env or export them in the shell when variables are missing.`,
    );
  }

  if (result.warned) {
    console.log(
      'Warnings do not block Docker start, but may block Playwright.',
    );
  }
};

if (import.meta.main) {
  const target = readTarget();
  const result = evaluateRuntimePreflight(target);
  printResult(target, result);
  process.exit(result.failed ? 1 : 0);
}
