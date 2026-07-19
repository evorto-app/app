export const directSchemaCutoverConfirmation = 'direct-new-schema';

const completeFeatureSet = new Set([
  'assignments',
  'events',
  'roles',
  'templates',
  'tenants',
  'users',
]);

interface DirectSchemaMigrationEnvironment {
  readonly allowReuseTenant: boolean;
  readonly clearTarget: boolean;
  readonly confirmation: string | undefined;
  readonly featureSelection: string | undefined;
  readonly sourceDatabaseUrl: string | undefined;
  readonly targetDatabaseUrl: string;
  readonly tenantSelection: string | undefined;
}

const databaseIdentity = (value: string | undefined, label: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} database URL is required`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label} database URL is invalid`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${label} database URL must use PostgreSQL`);
  }

  const database = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/gu, '');
  if (!database) {
    throw new Error(`${label} database URL must name a database`);
  }

  const host = url.hostname.toLowerCase().replace(/-pooler(?=\.)/u, '');
  return `${host}:${url.port || '5432'}/${database}`;
};

const selectedFeatures = (selection: string | undefined): Set<string> =>
  new Set(
    selection === undefined
      ? completeFeatureSet
      : selection
          .split(',')
          .map((feature) => feature.trim())
          .filter(Boolean),
  );

export const assertDirectSchemaMigrationEnvironment = (
  environment: DirectSchemaMigrationEnvironment,
): void => {
  const sourceIdentity = databaseIdentity(
    environment.sourceDatabaseUrl,
    'Legacy source',
  );
  const targetIdentity = databaseIdentity(
    environment.targetDatabaseUrl,
    'New target',
  );
  if (sourceIdentity === targetIdentity) {
    throw new Error(
      'Legacy source and new target must be separate PostgreSQL databases',
    );
  }

  const confirmation = environment.confirmation?.trim() || undefined;
  if (
    confirmation !== undefined &&
    confirmation !== directSchemaCutoverConfirmation
  ) {
    throw new Error('MIGRATION_CUTOVER_CONFIRMED has an invalid value');
  }
  if (environment.clearTarget && confirmation === undefined) {
    throw new Error(
      `Clearing the target requires MIGRATION_CUTOVER_CONFIRMED=${directSchemaCutoverConfirmation}`,
    );
  }
  if (confirmation === undefined) return;

  if (!environment.clearTarget) {
    throw new Error('A confirmed cutover must clear the separate target first');
  }
  if (environment.allowReuseTenant) {
    throw new Error(
      'A confirmed cutover must set MIGRATION_ALLOW_REUSE_TENANT=false',
    );
  }
  if (!environment.tenantSelection?.trim()) {
    throw new Error('A confirmed cutover requires an explicit MIGRATE_TENANTS');
  }

  const features = selectedFeatures(environment.featureSelection);
  if (
    features.size !== completeFeatureSet.size ||
    [...completeFeatureSet].some((feature) => !features.has(feature))
  ) {
    throw new Error('A confirmed cutover must migrate every feature');
  }
};
