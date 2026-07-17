const POSTGRES_MAJOR_VERSION = 17;
const LOCAL_DATABASE_NAME = 'evorto_postgres_integration';
const localHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const allowedConnectionParameters = new Set(['sslmode']);
const normalizeHost = (host: string) => host.replace(/^\[(.*)\]$/u, '$1');

export interface PostgresIntegrationEnvironment {
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

  const databaseName = decodeURIComponent(
    databaseUrl.pathname.replace(/^\/+/, ''),
  );
  if (databaseName !== LOCAL_DATABASE_NAME) {
    throw new Error(
      `Local PostgreSQL integration tests require database ${LOCAL_DATABASE_NAME}`,
    );
  }

  return databaseUrl;
};

export const resolvePostgresIntegrationEnvironment = async ({
  environment = process.env,
}: {
  readonly environment?: EnvironmentSource;
} = {}): Promise<PostgresIntegrationEnvironment> => {
  if (environment['POSTGRES_INTEGRATION_DISPOSABLE'] !== 'true') {
    throw new Error(
      'POSTGRES_INTEGRATION_DISPOSABLE=true is required before resetting an integration database',
    );
  }
  const databaseUrl = parseDatabaseUrl(
    requiredValue(environment, 'POSTGRES_INTEGRATION_DATABASE_URL'),
  );
  return { databaseUrl: databaseUrl.toString() };
};

export const requiredPostgresMajorVersion = POSTGRES_MAJOR_VERSION;
