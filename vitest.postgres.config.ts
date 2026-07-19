import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const resolveFromRoot = (...segments: string[]) =>
  path.resolve(rootDirectory, ...segments);

export default defineConfig({
  resolve: {
    alias: {
      '@app': resolveFromRoot('src/app'),
      '@db': resolveFromRoot('src/db'),
      '@helpers': resolveFromRoot('helpers'),
      '@server': resolveFromRoot('src/server'),
      '@shared': resolveFromRoot('src/shared'),
      '@types': resolveFromRoot('src/types'),
    },
  },
  test: {
    allowOnly: false,
    environment: 'node',
    fileParallelism: false,
    include: ['helpers/**/*.postgres.spec.ts', 'src/**/*.postgres.spec.ts'],
    maxWorkers: 1,
    passWithNoTests: false,
    reporters: [
      'default',
      resolveFromRoot('helpers/testing/complete-vitest-run-reporter.ts'),
    ],
  },
});
