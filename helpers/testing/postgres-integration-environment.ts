const POSTGRES_MAJOR_VERSION = 17;
export const postgresIntegrationDatabaseName = 'evorto_postgres_integration';
const localHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const allowedConnectionParameters = new Set(['sslmode']);
const normalizeHost = (host: string) => host.replace(/^\[(.*)\]$/u, '$1');

export interface PostgresIntegrationEnvironment {
  readonly databaseName: string;
  readonly databaseUrl: string;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

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
  if (!localHosts.has(normalizeHost(databaseUrl.hostname))) {
    throw new Error(
      'PostgreSQL integration tests may reset only a loopback database',
    );
  }

  const port = Number(databaseUrl.port);
  if (
    !databaseUrl.port ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(
      'POSTGRES_INTEGRATION_DATABASE_URL must include an explicit port between 1 and 65535',
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

  // Match pg-connection-string: remove one URL slash and retain reserved escapes.
  const databaseName = decodeURI(databaseUrl.pathname.slice(1));
  if (databaseName !== postgresIntegrationDatabaseName) {
    throw new Error(
      `Local PostgreSQL integration tests require database ${postgresIntegrationDatabaseName}`,
    );
  }

  if (
    databaseUrl.searchParams
      .getAll('sslmode')
      .some((mode) => mode !== 'disable')
  ) {
    throw new Error(
      'POSTGRES_INTEGRATION_DATABASE_URL must omit sslmode or use sslmode=disable',
    );
  }
  // Bind parent maintenance/reset pools and child drivers to the same local TLS policy.
  databaseUrl.searchParams.set('sslmode', 'disable');

  return databaseUrl;
};

export const resolvePostgresIntegrationEnvironment = async ({
  environment = process.env,
  local = false,
}: {
  readonly environment?: EnvironmentSource;
  readonly local?: boolean;
} = {}): Promise<PostgresIntegrationEnvironment> => {
  if (environment['POSTGRES_INTEGRATION_DISPOSABLE'] !== 'true') {
    throw new Error(
      'POSTGRES_INTEGRATION_DISPOSABLE=true is required before resetting an integration database',
    );
  }
  const databaseUrl = parseDatabaseUrl(
    requiredValue(environment, 'POSTGRES_INTEGRATION_DATABASE_URL'),
  );
  if (local) {
    const expectedPort = requiredValue(environment, 'POSTGRES_HOST_PORT');
    if (
      !/^\d+$/u.test(expectedPort) ||
      Number(expectedPort) < 1024 ||
      Number(expectedPort) > 65_535
    ) {
      throw new Error(
        'POSTGRES_HOST_PORT must be a decimal port between 1024 and 65535',
      );
    }
    if (Number(databaseUrl.port) !== Number(expectedPort)) {
      throw new Error(
        'POSTGRES_INTEGRATION_DATABASE_URL must target the resolved POSTGRES_HOST_PORT for local integration tests',
      );
    }
  }
  return {
    databaseName: decodeURI(databaseUrl.pathname.slice(1)),
    databaseUrl: databaseUrl.toString(),
  };
};

export const postgresIntegrationChildEnvironment = (
  environment: PostgresIntegrationEnvironment,
  parentEnvironment: EnvironmentSource = process.env,
): Readonly<Record<string, string>> => {
  const inherited: Record<string, string> = {};
  for (const [name, value] of Object.entries(parentEnvironment)) {
    if (
      value !== undefined &&
      name !== 'DATABASE_TLS_CA_CERTIFICATE' &&
      name !== 'DATABASE_TLS_SERVER_NAME' &&
      !name.startsWith('PGSSL') &&
      name !== 'PGREQUIRESSL'
    ) {
      inherited[name] = value;
    }
  }
  return {
    ...inherited,
    DATABASE_TLS_REQUIRED: 'false',
    DATABASE_URL: environment.databaseUrl,
    POSTGRES_DB: environment.databaseName,
  };
};

export const requiredPostgresMajorVersion = POSTGRES_MAJOR_VERSION;
