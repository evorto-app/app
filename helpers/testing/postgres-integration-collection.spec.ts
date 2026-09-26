import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { configDefaults } from 'vitest/config';

import serverProject from '../../vitest.config';
import postgresProject from '../../vitest.postgres.config';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const collect = (include: readonly string[], exclude: readonly string[]) =>
  globSync([...include], { cwd: repositoryRoot, exclude: [...exclude] })
    .map((file) => path.resolve(repositoryRoot, file))
    .toSorted();

describe('PostgreSQL suite collection', () => {
  it('assigns every database test to the serial integration project without collecting it in server units', () => {
    const databaseTests = collect(
      ['helpers/**/*.postgres.spec.ts', 'src/**/*.postgres.spec.ts'],
      [],
    );
    expect(databaseTests.length).toBeGreaterThan(0);
    expect(
      collect(
        postgresProject.test?.include ?? [],
        postgresProject.test?.exclude ?? configDefaults.exclude,
      ),
    ).toEqual(databaseTests);
    const serverTests = new Set(
      collect(
        serverProject.test?.include ?? [],
        serverProject.test?.exclude ?? configDefaults.exclude,
      ),
    );
    expect(databaseTests.filter((file) => serverTests.has(file))).toEqual([]);
    expect(postgresProject.test).toMatchObject({
      fileParallelism: false,
      maxWorkers: 1,
      passWithNoTests: false,
    });
  });
});
