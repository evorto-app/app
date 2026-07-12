import {
  DEFAULT_E2E_NOW_ISO,
  DEFAULT_E2E_SEED_KEY,
} from '@shared/testing/deterministic-test-defaults';
import { Config, ConfigProvider, Effect, Option } from 'effect';
import path from 'node:path';

import { nonEmptyTrimmedString, optionalTrimmedString } from './config-string';

const INTEGRATION_PROJECT_NAMES = [
  'docs-integration',
  'local-chrome-integration',
] as const;
const LIVE_PROVIDER_PROJECT_NAMES = ['local-chrome-live-esncard'] as const;
const PLAYWRIGHT_PROJECT_NAMES = [
  'setup',
  'local-chrome-baseline',
  'docs-baseline',
  ...INTEGRATION_PROJECT_NAMES,
  ...LIVE_PROVIDER_PROJECT_NAMES,
] as const;
const SELECTED_PLAYWRIGHT_PROJECTS_ENV = 'E2E_SELECTED_PROJECTS';
const PLAYWRIGHT_BROWSER_CHANNELS = ['chromium', 'chrome'] as const;
const LIST_ONLY_ENVIRONMENT_DEFAULTS = {
  BASE_URL: 'http://localhost:4200',
  CLIENT_ID: 'playwright-list-client-id',
  CLIENT_SECRET: 'playwright-list-client-secret',
  ISSUER_BASE_URL: 'https://playwright-list.invalid',
  SECRET: 'playwright-list-secret',
  STRIPE_API_KEY: 'sk_test_playwright_list',
  STRIPE_TEST_ACCOUNT_ID: 'acct_playwright_list',
  STRIPE_WEBHOOK_SECRET: 'whsec_playwright_list',
} as const;

export interface Auth0ManagementEnvironment {
  AUTH0_MANAGEMENT_CLIENT_ID: string;
  AUTH0_MANAGEMENT_CLIENT_SECRET: string;
}

export interface DocumentationOutputEnvironment {
  docsImageOutputDirectory: string;
  docsOutputDirectory: string;
}

export type PlaywrightBrowserChannel =
  (typeof PLAYWRIGHT_BROWSER_CHANNELS)[number];

export type PlaywrightEnvironment = Omit<
  TestRuntimeConfigState,
  | 'BASE_URL'
  | 'CLIENT_ID'
  | 'CLIENT_SECRET'
  | 'E2E_BROWSER_CHANNEL'
  | 'ISSUER_BASE_URL'
  | 'SECRET'
  | 'STRIPE_API_KEY'
  | 'STRIPE_TEST_ACCOUNT_ID'
  | 'STRIPE_WEBHOOK_SECRET'
> & {
  BASE_URL: string;
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  E2E_BROWSER_CHANNEL: PlaywrightBrowserChannel;
  ISSUER_BASE_URL: string;
  NO_WEBSERVER: boolean;
  SECRET: string;
  STRIPE_API_KEY: string;
  STRIPE_TEST_ACCOUNT_ID: string;
  STRIPE_WEBHOOK_SECRET: string;
};

export type TestRuntimeConfigState = Config.Success<
  typeof testRuntimeConfigState
>;

const combineMissingDataErrors = (errors: readonly Error[]) => {
  const [firstError, ...restErrors] = errors;
  if (!firstError) {
    throw new Error('Expected at least one config error');
  }

  return new Error(
    [
      ...new Set([firstError, ...restErrors].map((error) => error.message)),
    ].join('\n'),
  );
};

const missingFieldError = (name: string) =>
  new Error(`Expected ${name} to be configured`);

const collectMissingFieldErrors = (
  fields: readonly [name: string, configured: boolean][],
) =>
  fields
    .map(([name, configured]) =>
      configured ? undefined : missingFieldError(name),
    )
    .filter((value): value is Error => value !== undefined);

const isPlaywrightBrowserChannel = (
  value: string,
): value is PlaywrightBrowserChannel =>
  (PLAYWRIGHT_BROWSER_CHANNELS as readonly string[]).includes(value);

const matchesProjectPattern = (pattern: string, projectName: string) => {
  const escapedPattern = pattern.replaceAll(
    /[|\\{}()[\]^$+?.]/g,
    String.raw`\$&`,
  );
  const projectPattern = new RegExp(
    `^${escapedPattern.replaceAll('*', '.*')}$`,
    'u',
  );
  return projectPattern.test(projectName);
};

const parseSelectedProjectNames = (value: string) =>
  value
    .split(',')
    .map((projectName) => projectName.trim())
    .filter((projectName) => projectName.length > 0);

const configFailure = (message: string) =>
  new Config.ConfigError(new ConfigProvider.SourceError({ message }));

const assertKnownProjectNames = (
  projectNames: readonly string[],
): Effect.Effect<readonly string[], Config.ConfigError> => {
  const unknownProjectNames = projectNames.filter((projectName) =>
    PLAYWRIGHT_PROJECT_NAMES.every(
      (knownProjectName) =>
        !matchesProjectPattern(projectName, knownProjectName),
    ),
  );
  if (unknownProjectNames.length > 0) {
    return Effect.fail(
      configFailure(
        `${SELECTED_PLAYWRIGHT_PROJECTS_ENV} contains unknown Playwright project(s): ${unknownProjectNames.join(', ')}`,
      ),
    );
  }

  return Effect.succeed(projectNames);
};

const selectedProjectNamesConfig = optionalTrimmedString(
  SELECTED_PLAYWRIGHT_PROJECTS_ENV,
).pipe(
  Config.mapOrFail((value) =>
    Option.match(value, {
      onNone: () => Effect.succeed([]),
      onSome: (projectNames) =>
        assertKnownProjectNames(parseSelectedProjectNames(projectNames)),
    }),
  ),
);

export const testRuntimeConfigState = Config.all({
  AUTH0_MANAGEMENT_CLIENT_ID: optionalTrimmedString(
    'AUTH0_MANAGEMENT_CLIENT_ID',
  ),
  AUTH0_MANAGEMENT_CLIENT_SECRET: optionalTrimmedString(
    'AUTH0_MANAGEMENT_CLIENT_SECRET',
  ),
  BASE_URL: optionalTrimmedString('BASE_URL'),
  CI: Config.boolean('CI').pipe(Config.withDefault(false)),
  CLIENT_ID: optionalTrimmedString('CLIENT_ID'),
  CLIENT_SECRET: optionalTrimmedString('CLIENT_SECRET'),
  DATABASE_URL: nonEmptyTrimmedString('DATABASE_URL'),
  DOCS_IMG_OUT_DIR: optionalTrimmedString('DOCS_IMG_OUT_DIR').pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => path.resolve('test-results/docs/images'),
        onSome: (outputDirectory) => outputDirectory,
      }),
    ),
  ),
  DOCS_OUT_DIR: optionalTrimmedString('DOCS_OUT_DIR').pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => path.resolve('test-results/docs'),
        onSome: (outputDirectory) => outputDirectory,
      }),
    ),
  ),
  E2E_BROWSER_CHANNEL: optionalTrimmedString('E2E_BROWSER_CHANNEL'),
  E2E_NOW_ISO: optionalTrimmedString('E2E_NOW_ISO').pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => DEFAULT_E2E_NOW_ISO,
        onSome: (nowIso) => nowIso,
      }),
    ),
  ),
  E2E_SEED_KEY: optionalTrimmedString('E2E_SEED_KEY').pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => DEFAULT_E2E_SEED_KEY,
        onSome: (seedKey) => seedKey,
      }),
    ),
  ),
  E2E_SELECTED_PROJECTS: selectedProjectNamesConfig,
  ISSUER_BASE_URL: optionalTrimmedString('ISSUER_BASE_URL'),
  NEON_LOCAL_PROXY: Config.boolean('NEON_LOCAL_PROXY').pipe(
    Config.withDefault(false),
  ),
  NO_WEBSERVER: Config.boolean('NO_WEBSERVER').pipe(Config.withDefault(false)),
  PUBLIC_GOOGLE_MAPS_API_KEY: optionalTrimmedString(
    'PUBLIC_GOOGLE_MAPS_API_KEY',
  ),
  S3_ACCESS_KEY_ID: optionalTrimmedString('S3_ACCESS_KEY_ID'),
  S3_BUCKET: optionalTrimmedString('S3_BUCKET'),
  S3_ENDPOINT: optionalTrimmedString('S3_ENDPOINT'),
  S3_REGION: optionalTrimmedString('S3_REGION'),
  S3_SECRET_ACCESS_KEY: optionalTrimmedString('S3_SECRET_ACCESS_KEY'),
  SECRET: optionalTrimmedString('SECRET'),
  STRIPE_API_KEY: optionalTrimmedString('STRIPE_API_KEY'),
  STRIPE_TEST_ACCOUNT_ID: optionalTrimmedString('STRIPE_TEST_ACCOUNT_ID'),
  STRIPE_WEBHOOK_SECRET: optionalTrimmedString('STRIPE_WEBHOOK_SECRET'),
  TENANT_DOMAIN: optionalTrimmedString('TENANT_DOMAIN'),
});

const resolveRequestedProjectNames = (argv: readonly string[]) => {
  const requestedProjectNames: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) {
      continue;
    }

    if (argument === '--project') {
      const nextArgument = argv[index + 1];
      if (!nextArgument) {
        continue;
      }

      requestedProjectNames.push(
        ...nextArgument.split(',').map((projectName) => projectName.trim()),
      );
      index += 1;
      continue;
    }

    if (argument.startsWith('--project=')) {
      requestedProjectNames.push(
        ...argument
          .slice('--project='.length)
          .split(',')
          .map((projectName) => projectName.trim()),
      );
    }
  }

  return requestedProjectNames.filter((projectName) => projectName.length > 0);
};

export const requiresIntegrationOnlyPlaywrightEnvironment = (
  argv: readonly string[] = process.argv,
  selectedProjectNames: readonly string[] = [],
) => {
  if (argv.includes('--ui')) {
    return false;
  }

  const requestedProjectNames = [
    ...resolveRequestedProjectNames(argv),
    ...selectedProjectNames,
  ];
  if (requestedProjectNames.length === 0) {
    return true;
  }

  return requestedProjectNames.some((requestedProjectName) =>
    INTEGRATION_PROJECT_NAMES.some((integrationProjectName) =>
      matchesProjectPattern(requestedProjectName, integrationProjectName),
    ),
  );
};

export const isPlaywrightListOnly = (argv: readonly string[] = process.argv) =>
  argv.includes('--list');

const validateCiEnvironment = (
  state: TestRuntimeConfigState,
  argv: readonly string[] = process.argv,
) => {
  if (!state.CI) {
    return Effect.void;
  }
  if (isPlaywrightListOnly(argv)) {
    return Effect.void;
  }

  const errors = collectMissingFieldErrors([
    ['S3_ACCESS_KEY_ID', Option.isSome(state.S3_ACCESS_KEY_ID)],
    ['S3_BUCKET', Option.isSome(state.S3_BUCKET)],
    ['S3_ENDPOINT', Option.isSome(state.S3_ENDPOINT)],
    ['S3_REGION', Option.isSome(state.S3_REGION)],
    ['S3_SECRET_ACCESS_KEY', Option.isSome(state.S3_SECRET_ACCESS_KEY)],
    ['STRIPE_WEBHOOK_SECRET', Option.isSome(state.STRIPE_WEBHOOK_SECRET)],
    ['STRIPE_TEST_ACCOUNT_ID', Option.isSome(state.STRIPE_TEST_ACCOUNT_ID)],
  ]);

  return errors.length > 0
    ? Effect.fail(combineMissingDataErrors(errors))
    : Effect.void;
};

const validateIntegrationEnvironment = (
  state: TestRuntimeConfigState,
  argv: readonly string[] = process.argv,
) => {
  if (
    isPlaywrightListOnly(argv) ||
    !requiresIntegrationOnlyPlaywrightEnvironment(
      argv,
      state.E2E_SELECTED_PROJECTS,
    )
  ) {
    return Effect.void;
  }

  const errors = collectMissingFieldErrors([
    [
      'AUTH0_MANAGEMENT_CLIENT_ID',
      Option.isSome(state.AUTH0_MANAGEMENT_CLIENT_ID),
    ],
    [
      'AUTH0_MANAGEMENT_CLIENT_SECRET',
      Option.isSome(state.AUTH0_MANAGEMENT_CLIENT_SECRET),
    ],
    [
      'PUBLIC_GOOGLE_MAPS_API_KEY',
      Option.isSome(state.PUBLIC_GOOGLE_MAPS_API_KEY),
    ],
  ]);

  return errors.length > 0
    ? Effect.fail(combineMissingDataErrors(errors))
    : Effect.void;
};

export const makePlaywrightEnvironmentConfig = (
  argv: readonly string[] = process.argv,
) =>
  Effect.gen(function* () {
    const state = yield* testRuntimeConfigState;
    yield* validateCiEnvironment(state, argv);
    yield* validateIntegrationEnvironment(state, argv);
    const listOnly = isPlaywrightListOnly(argv);

    const errors = [
      Option.isSome(state.BASE_URL) || listOnly
        ? undefined
        : missingFieldError('BASE_URL'),
      Option.isSome(state.CLIENT_ID) || listOnly
        ? undefined
        : missingFieldError('CLIENT_ID'),
      Option.isSome(state.CLIENT_SECRET) || listOnly
        ? undefined
        : missingFieldError('CLIENT_SECRET'),
      Option.isSome(state.ISSUER_BASE_URL) || listOnly
        ? undefined
        : missingFieldError('ISSUER_BASE_URL'),
      Option.isSome(state.SECRET) || listOnly
        ? undefined
        : missingFieldError('SECRET'),
      Option.isSome(state.STRIPE_API_KEY) || listOnly
        ? undefined
        : missingFieldError('STRIPE_API_KEY'),
      Option.isSome(state.STRIPE_TEST_ACCOUNT_ID) || listOnly
        ? undefined
        : missingFieldError('STRIPE_TEST_ACCOUNT_ID'),
    ].filter((value): value is Error => value !== undefined);

    if (errors.length > 0) {
      return yield* Effect.fail(combineMissingDataErrors(errors));
    }

    const playwrightBrowserChannel =
      Option.getOrUndefined(state.E2E_BROWSER_CHANNEL) ?? 'chromium';
    if (!isPlaywrightBrowserChannel(playwrightBrowserChannel)) {
      return yield* Effect.fail(
        new Error(
          `Expected E2E_BROWSER_CHANNEL to be one of ${PLAYWRIGHT_BROWSER_CHANNELS.join(', ')}`,
        ),
      );
    }

    const baseUrl =
      Option.getOrUndefined(state.BASE_URL) ??
      (listOnly ? LIST_ONLY_ENVIRONMENT_DEFAULTS.BASE_URL : undefined);
    const clientId =
      Option.getOrUndefined(state.CLIENT_ID) ??
      (listOnly ? LIST_ONLY_ENVIRONMENT_DEFAULTS.CLIENT_ID : undefined);
    const clientSecret =
      Option.getOrUndefined(state.CLIENT_SECRET) ??
      (listOnly ? LIST_ONLY_ENVIRONMENT_DEFAULTS.CLIENT_SECRET : undefined);
    const issuerBaseUrl =
      Option.getOrUndefined(state.ISSUER_BASE_URL) ??
      (listOnly ? LIST_ONLY_ENVIRONMENT_DEFAULTS.ISSUER_BASE_URL : undefined);
    const secret =
      Option.getOrUndefined(state.SECRET) ??
      (listOnly ? LIST_ONLY_ENVIRONMENT_DEFAULTS.SECRET : undefined);
    const stripeApiKey =
      Option.getOrUndefined(state.STRIPE_API_KEY) ??
      (listOnly ? LIST_ONLY_ENVIRONMENT_DEFAULTS.STRIPE_API_KEY : undefined);
    const stripeTestAccountId =
      Option.getOrUndefined(state.STRIPE_TEST_ACCOUNT_ID) ??
      (listOnly
        ? LIST_ONLY_ENVIRONMENT_DEFAULTS.STRIPE_TEST_ACCOUNT_ID
        : undefined);
    const stripeWebhookSecret =
      Option.getOrUndefined(state.STRIPE_WEBHOOK_SECRET) ??
      (listOnly ? LIST_ONLY_ENVIRONMENT_DEFAULTS.STRIPE_WEBHOOK_SECRET : '');

    if (
      !baseUrl ||
      !clientId ||
      !clientSecret ||
      !issuerBaseUrl ||
      !secret ||
      !stripeApiKey ||
      !stripeTestAccountId
    ) {
      throw new Error('Expected validated Playwright configuration values');
    }

    return {
      ...state,
      BASE_URL: baseUrl,
      CLIENT_ID: clientId,
      CLIENT_SECRET: clientSecret,
      E2E_BROWSER_CHANNEL: playwrightBrowserChannel,
      ISSUER_BASE_URL: issuerBaseUrl,
      NO_WEBSERVER: state.NO_WEBSERVER,
      SECRET: secret,
      STRIPE_API_KEY: stripeApiKey,
      STRIPE_TEST_ACCOUNT_ID: stripeTestAccountId,
      STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
    } satisfies PlaywrightEnvironment;
  });

export const playwrightEnvironmentConfig = makePlaywrightEnvironmentConfig();

export const hasAuth0ManagementEnvironment = Effect.gen(function* () {
  const state = yield* testRuntimeConfigState;

  return (
    Option.isSome(state.AUTH0_MANAGEMENT_CLIENT_ID) &&
    Option.isSome(state.AUTH0_MANAGEMENT_CLIENT_SECRET)
  );
});

export const auth0ManagementEnvironment = Effect.gen(function* () {
  const state = yield* testRuntimeConfigState;
  const errors = [
    Option.isSome(state.AUTH0_MANAGEMENT_CLIENT_ID)
      ? undefined
      : missingFieldError('AUTH0_MANAGEMENT_CLIENT_ID'),
    Option.isSome(state.AUTH0_MANAGEMENT_CLIENT_SECRET)
      ? undefined
      : missingFieldError('AUTH0_MANAGEMENT_CLIENT_SECRET'),
  ].filter((value): value is Error => value !== undefined);

  if (errors.length > 0) {
    return yield* Effect.fail(combineMissingDataErrors(errors));
  }

  const managementClientId = Option.getOrUndefined(
    state.AUTH0_MANAGEMENT_CLIENT_ID,
  );
  const managementClientSecret = Option.getOrUndefined(
    state.AUTH0_MANAGEMENT_CLIENT_SECRET,
  );

  if (!managementClientId || !managementClientSecret) {
    throw new Error('Expected validated Auth0 management configuration values');
  }

  return {
    AUTH0_MANAGEMENT_CLIENT_ID: managementClientId,
    AUTH0_MANAGEMENT_CLIENT_SECRET: managementClientSecret,
  };
});

export const documentationOutputEnvironment = Effect.gen(function* () {
  const state = yield* testRuntimeConfigState;

  return {
    docsImageOutputDirectory: state.DOCS_IMG_OUT_DIR,
    docsOutputDirectory: state.DOCS_OUT_DIR,
  } satisfies DocumentationOutputEnvironment;
});
