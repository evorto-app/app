import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type RuntimeTarget = 'docker';

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
  docker: [
    {
      description:
        'Font Awesome package registry access for premium and brand icons',
      name: 'FONT_AWESOME_TOKEN',
    },
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

const targets = new Set<RuntimeTarget>(['docker']);

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
  const checks: RuntimeCheck[] = [
    {
      details:
        missingVariables.length > 0
          ? missingVariables.map(
              ({ description, name }) => `${name}: ${description}`,
            )
          : ['All required variables are present.'],
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
    {
      details: [path.join(cwd, '.env.dev')],
      label: 'Generated worktree runtime env file',
      severity: fileExists(path.join(cwd, '.env.dev')) ? 'ok' : 'failure',
    },
    commandCheck('Bun runtime', 'bun', ['--version'], 'failure', runCommand),
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
    commandCheck(
      'Playwright CLI',
      'bunx',
      ['playwright', '--version'],
      'warning',
      runCommand,
    ),
    stripeWebhookSecretSourceCheck(env),
    playwrightBrowserCheck(env, fileExists, runCommand),
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
    console.log(
      'Fix failed checks before starting Docker. Use .env.example as the checklist, then add secret values to .env or export them in the shell when variables are missing.',
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
