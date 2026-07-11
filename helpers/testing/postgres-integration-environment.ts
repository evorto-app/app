import { Effect, Schema } from 'effect';

const POSTGRES_MAJOR_VERSION = 17;
const LOCAL_DATABASE_NAME = 'evorto_postgres_integration';
const NEON_BRANCH_NAME_PREFIX = 'codex-postgres-integration-';
const MAXIMUM_NEON_BRANCH_LIFETIME_MS = 25 * 60 * 60 * 1000;
const localHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const allowedConnectionParameters = new Set(['channel_binding', 'sslmode']);
const normalizeHost = (host: string) => host.replace(/^\[(.*)\]$/u, '$1');

const NeonBranchResponse = Schema.Struct({
  branch: Schema.Struct({
    default: Schema.Boolean,
    expires_at: Schema.optionalKey(Schema.String),
    id: Schema.String,
    name: Schema.String,
    protected: Schema.Boolean,
  }),
});

const NeonEndpointsResponse = Schema.Struct({
  endpoints: Schema.Array(
    Schema.Struct({
      branch_id: Schema.String,
      disabled: Schema.Boolean,
      host: Schema.String,
      type: Schema.String,
    }),
  ),
});

export interface PostgresIntegrationEnvironment {
  readonly databaseUrl: string;
  readonly neonLocalProxy: false;
}

export type PostgresIntegrationTarget =
  LocalPostgresIntegrationTarget | NeonPostgresIntegrationTarget;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

interface LocalPostgresIntegrationTarget {
  readonly _tag: 'Local';
  readonly databaseUrl: string;
}

interface NeonPostgresIntegrationTarget {
  readonly _tag: 'Neon';
  readonly apiKey: string;
  readonly branchId: string;
  readonly databaseUrl: string;
  readonly projectId: string;
}

const requiredValue = (
  environment: EnvironmentSource,
  name: string,
): string => {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for PostgreSQL integration tests`);
  }
  return value;
};

const parseDatabaseUrl = (value: string): URL => {
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(value);
  } catch {
    throw new Error(
      'POSTGRES_INTEGRATION_DATABASE_URL must be a valid PostgreSQL URL',
    );
  }

  if (
    databaseUrl.protocol !== 'postgres:' &&
    databaseUrl.protocol !== 'postgresql:'
  ) {
    throw new Error(
      'POSTGRES_INTEGRATION_DATABASE_URL must use postgres or postgresql',
    );
  }

  if (!databaseUrl.username || !databaseUrl.password) {
    throw new Error(
      'POSTGRES_INTEGRATION_DATABASE_URL must include explicit disposable credentials',
    );
  }

  const unsupportedParameters = [
    ...new Set(databaseUrl.searchParams.keys()).difference(
      allowedConnectionParameters,
    ),
  ];
  if (unsupportedParameters.length > 0) {
    throw new Error(
      `POSTGRES_INTEGRATION_DATABASE_URL contains unsupported connection parameters: ${unsupportedParameters.join(', ')}`,
    );
  }

  const channelBinding = databaseUrl.searchParams.get('channel_binding');
  if (channelBinding !== null && channelBinding !== 'require') {
    throw new Error(
      'POSTGRES_INTEGRATION_DATABASE_URL channel_binding must be require when provided',
    );
  }

  databaseUrl.search = '';
  if (channelBinding === 'require') {
    databaseUrl.searchParams.set('channel_binding', channelBinding);
  }

  return databaseUrl;
};

export const parsePostgresIntegrationTarget = (
  environment: EnvironmentSource,
): PostgresIntegrationTarget => {
  if (environment['POSTGRES_INTEGRATION_DISPOSABLE'] !== 'true') {
    throw new Error(
      'POSTGRES_INTEGRATION_DISPOSABLE=true is required before resetting an integration database',
    );
  }

  const databaseUrlValue = requiredValue(
    environment,
    'POSTGRES_INTEGRATION_DATABASE_URL',
  );
  const databaseUrl = parseDatabaseUrl(databaseUrlValue);
  const databaseName = decodeURIComponent(
    databaseUrl.pathname.replace(/^\/+/, ''),
  );

  if (localHosts.has(normalizeHost(databaseUrl.hostname))) {
    if (databaseName !== LOCAL_DATABASE_NAME) {
      throw new Error(
        `Local PostgreSQL integration tests require database ${LOCAL_DATABASE_NAME}`,
      );
    }
    databaseUrl.search = '';
    return { _tag: 'Local', databaseUrl: databaseUrl.toString() };
  }

  if (databaseName !== 'appdb') {
    throw new Error(
      'Remote PostgreSQL integration tests require the isolated Neon appdb database',
    );
  }

  databaseUrl.searchParams.set('sslmode', 'verify-full');

  return {
    _tag: 'Neon',
    apiKey: requiredValue(environment, 'NEON_API_KEY'),
    branchId: requiredValue(environment, 'POSTGRES_INTEGRATION_NEON_BRANCH_ID'),
    databaseUrl: databaseUrl.toString(),
    projectId: requiredValue(environment, 'NEON_PROJECT_ID'),
  };
};

const fetchNeonJson = async (
  path: string,
  apiKey: string,
  fetchImplementation: typeof fetch,
): Promise<unknown> => {
  const response = await fetchImplementation(
    `https://console.neon.tech/api/v2${path}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Neon API verification failed with status ${response.status}`,
    );
  }

  return response.json();
};

const verifyNeonTarget = async (
  target: NeonPostgresIntegrationTarget,
  fetchImplementation: typeof fetch,
  now: number,
): Promise<void> => {
  const [branchPayload, endpointPayload] = await Promise.all([
    fetchNeonJson(
      `/projects/${target.projectId}/branches/${target.branchId}`,
      target.apiKey,
      fetchImplementation,
    ),
    fetchNeonJson(
      `/projects/${target.projectId}/endpoints?limit=100`,
      target.apiKey,
      fetchImplementation,
    ),
  ]);
  const { branch } = await Effect.runPromise(
    Schema.decodeUnknownEffect(NeonBranchResponse)(branchPayload),
  );
  const { endpoints } = await Effect.runPromise(
    Schema.decodeUnknownEffect(NeonEndpointsResponse)(endpointPayload),
  );

  if (branch.id !== target.branchId || branch.default || branch.protected) {
    throw new Error(
      'Refusing to reset a default, protected, or mismatched Neon branch',
    );
  }
  if (!branch.name.startsWith(NEON_BRANCH_NAME_PREFIX)) {
    throw new Error(
      `Disposable Neon branch names must start with ${NEON_BRANCH_NAME_PREFIX}`,
    );
  }

  const expiresAt = Date.parse(branch.expires_at ?? '');
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > MAXIMUM_NEON_BRANCH_LIFETIME_MS
  ) {
    throw new Error(
      'Disposable Neon integration branches must expire within 25 hours',
    );
  }

  const databaseHost = new URL(target.databaseUrl).hostname;
  const matchingEndpoint = endpoints.find(
    (endpoint) =>
      endpoint.branch_id === target.branchId &&
      endpoint.host === databaseHost &&
      endpoint.type === 'read_write' &&
      !endpoint.disabled,
  );
  if (!matchingEndpoint) {
    throw new Error(
      'POSTGRES_INTEGRATION_DATABASE_URL does not belong to the verified Neon branch',
    );
  }
};

export const resolvePostgresIntegrationEnvironment = async ({
  environment = process.env,
  fetchImplementation = fetch,
  now = Date.now(),
}: {
  readonly environment?: EnvironmentSource;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: number;
} = {}): Promise<PostgresIntegrationEnvironment> => {
  const target = parsePostgresIntegrationTarget(environment);
  if (target._tag === 'Neon') {
    await verifyNeonTarget(target, fetchImplementation, now);
  }

  return {
    databaseUrl: target.databaseUrl,
    neonLocalProxy: false,
  };
};

export const requiredPostgresMajorVersion = POSTGRES_MAJOR_VERSION;
