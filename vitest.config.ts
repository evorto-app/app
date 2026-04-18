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
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/app/**/*.spec.ts',
      'tests/**',
    ],
    include: [
      'helpers/**/*.spec.ts',
      'src/db/**/*.spec.ts',
      'src/server/**/*.spec.ts',
    ],
  },
});
