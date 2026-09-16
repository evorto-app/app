const localDatabaseHosts = new Set(['127.0.0.1', '::1', 'db', 'localhost']);
const allowedConnectionParameters = new Set(['sslmode']);

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const requiredValue = (
  environment: EnvironmentSource,
  name: string,
): string => {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for local database operations`);
  }
  return value;
};

const parseDatabaseUrl = (value: string, expectedDatabaseName: string): URL => {
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (
    databaseUrl.protocol !== 'postgres:' &&
    databaseUrl.protocol !== 'postgresql:'
  ) {
    throw new Error('DATABASE_URL must use postgres or postgresql');
  }
  if (!databaseUrl.username || !databaseUrl.password) {
    throw new Error(
      'DATABASE_URL must include explicit local database credentials',
    );
  }

  const host = databaseUrl.hostname.replace(/^\[(.*)\]$/u, '$1');
  if (!localDatabaseHosts.has(host)) {
    throw new Error(
      `Refusing to operate on non-local database host (${host || 'missing'})`,
    );
  }

  const unsupportedParameters = [
    ...new Set(databaseUrl.searchParams.keys()).difference(
      allowedConnectionParameters,
    ),
  ];
  if (unsupportedParameters.length > 0) {
    throw new Error(
      `DATABASE_URL contains unsupported connection parameters: ${unsupportedParameters.join(', ')}`,
    );
  }

  // Match pg-connection-string so the guard checks the database pg will open.
  const databaseName = decodeURI(databaseUrl.pathname.slice(1));
  if (!databaseName) {
    throw new Error('DATABASE_URL must identify a local database');
  }

  if (databaseName !== expectedDatabaseName) {
    throw new Error(
      `DATABASE_URL must target the configured local database (${expectedDatabaseName})`,
    );
  }

  return databaseUrl;
};

export const resolveLocalDatabaseEnvironment = (
  environment: EnvironmentSource = process.env,
): { readonly databaseUrl: string } => {
  if (environment['LOCAL_DATABASE'] !== 'true') {
    throw new Error(
      'LOCAL_DATABASE=true is required for local database operations',
    );
  }

  const expectedDatabaseName = environment['POSTGRES_DB'];
  if (!expectedDatabaseName) {
    throw new Error('POSTGRES_DB is required for local database operations');
  }

  const databaseUrl = parseDatabaseUrl(
    requiredValue(environment, 'DATABASE_URL'),
    expectedDatabaseName,
  );
  return { databaseUrl: databaseUrl.toString() };
};
