import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  migrationFeatures,
  parseMigrationFeatures,
} from '../../migration/feature-selection';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('migration feature selection', () => {
  it('selects every feature by default', () => {
    expect(parseMigrationFeatures(undefined)).toEqual(migrationFeatures);
  });

  it.each([
    ['roles,assignments', ['roles', 'assignments']],
    ['roles,templates', ['roles', 'templates']],
    ['roles,templates,events', ['roles', 'templates', 'events']],
  ])('allows dependency-complete selection %s', (selection, expected) => {
    expect(parseMigrationFeatures(selection)).toEqual(expected);
  });

  it.each([
    ['assignments', 'assignments requires roles'],
    ['templates', 'templates requires roles'],
    ['events', 'events requires templates, events requires roles'],
    ['roles,events', 'events requires templates'],
    ['templates,events', 'events requires roles'],
  ])('blocks incomplete selection %s', (selection, expected) => {
    expect(() => parseMigrationFeatures(selection)).toThrow(expected);
  });

  it('blocks unknown feature names instead of silently ignoring them', () => {
    expect(() => parseMigrationFeatures('users,typo')).toThrow(
      'unknown features: typo',
    );
  });

  it('validates the selection before target reset or tenant writes', () => {
    const migration = readFileSync(
      path.join(repositoryRoot, 'migration/index.ts'),
      'utf8',
    );
    const validationIndex = migration.indexOf('parseMigrationFeatures(');

    expect(validationIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeLessThan(migration.indexOf('if (clearDb)'));
    expect(validationIndex).toBeLessThan(
      migration.indexOf('const newTenant = await migrateTenant('),
    );
  });
});
