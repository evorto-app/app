import { describe, expect, it } from 'vitest';

import {
  assertDirectSchemaMigrationEnvironment,
  directSchemaCutoverConfirmation,
} from '../../migration/cutover-guard';

const validEnvironment = {
  allowReuseTenant: true,
  clearTarget: false,
  confirmation: undefined,
  featureSelection: undefined,
  sourceDatabaseUrl: 'postgresql://legacy_reader@legacy.example/legacy_app',
  targetDatabaseUrl:
    'postgresql://new_writer@target.example/new_app?sslmode=require',
  tenantSelection: undefined,
} as const;

describe('direct schema migration cutover guard', () => {
  it('allows ordinary imports only between distinct databases', () => {
    expect(() =>
      assertDirectSchemaMigrationEnvironment(validEnvironment),
    ).not.toThrow();

    expect(() =>
      assertDirectSchemaMigrationEnvironment({
        ...validEnvironment,
        sourceDatabaseUrl:
          'postgresql://reader@same-pooler.example/app?sslmode=require',
        targetDatabaseUrl: 'postgresql://writer@same.example/app',
      }),
    ).toThrow('must be separate PostgreSQL databases');
  });

  it('requires an explicit confirmation before clearing the target', () => {
    expect(() =>
      assertDirectSchemaMigrationEnvironment({
        ...validEnvironment,
        clearTarget: true,
      }),
    ).toThrow(`MIGRATION_CUTOVER_CONFIRMED=${directSchemaCutoverConfirmation}`);
  });

  it('accepts only a complete, non-reusing one-go cutover', () => {
    const cutover = {
      ...validEnvironment,
      allowReuseTenant: false,
      clearTarget: true,
      confirmation: directSchemaCutoverConfirmation,
      tenantSelection: 'tumi:evorto.app',
    } as const;

    expect(() => assertDirectSchemaMigrationEnvironment(cutover)).not.toThrow();
    expect(() =>
      assertDirectSchemaMigrationEnvironment({
        ...cutover,
        featureSelection: 'users,tenants',
      }),
    ).toThrow('must migrate every feature');
    expect(() =>
      assertDirectSchemaMigrationEnvironment({
        ...cutover,
        allowReuseTenant: true,
      }),
    ).toThrow('MIGRATION_ALLOW_REUSE_TENANT=false');
  });
});
