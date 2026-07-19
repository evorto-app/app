export const migrationFeatures = [
  'users',
  'tenants',
  'roles',
  'assignments',
  'templates',
  'events',
] as const;

export type MigrationFeature = (typeof migrationFeatures)[number];

const migrationFeatureSet = new Set<string>(migrationFeatures);

const isMigrationFeature = (feature: string): feature is MigrationFeature =>
  migrationFeatureSet.has(feature);

const requiredFeatureDependencies: Readonly<
  Partial<Record<MigrationFeature, readonly MigrationFeature[]>>
> = {
  assignments: ['roles'],
  events: ['templates', 'roles'],
  templates: ['roles'],
};

export const assertMigrationFeatureDependencies = (
  features: readonly MigrationFeature[],
): void => {
  const selectedFeatures = new Set(features);
  const missingDependencies = features.flatMap((feature) =>
    (requiredFeatureDependencies[feature] ?? [])
      .filter((dependency) => !selectedFeatures.has(dependency))
      .map((dependency) => `${feature} requires ${dependency}`),
  );

  if (missingDependencies.length > 0) {
    throw new Error(
      `MIGRATE_FEATURES selection is incomplete: ${missingDependencies.join(', ')}.`,
    );
  }
};

export const parseMigrationFeatures = (
  selection: string | undefined,
): MigrationFeature[] => {
  if (!selection) return [...migrationFeatures];

  const requestedFeatures = selection
    .split(',')
    .map((feature) => feature.trim())
    .filter(Boolean);
  const unknownFeatures = requestedFeatures.filter(
    (feature) => !isMigrationFeature(feature),
  );
  if (unknownFeatures.length > 0) {
    throw new Error(
      `MIGRATE_FEATURES contains unknown features: ${[...new Set(unknownFeatures)].join(', ')}.`,
    );
  }

  const selectedFeatures = new Set(requestedFeatures);
  const features = migrationFeatures.filter((feature) =>
    selectedFeatures.has(feature),
  );
  assertMigrationFeatureDependencies(features);
  return features;
};
