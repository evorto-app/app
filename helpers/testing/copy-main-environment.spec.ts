import { describe, expect, it } from '@effect/vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { copyMainEnvironment } from './copy-main-environment';

const ignoreLog = (message: string): void => {
  expect(typeof message).toBe('string');
};

const withTemporaryDirectory = (test: (root: string) => void): void => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evorto-env-copy-'));
  try {
    test(root);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
};

describe('copyMainEnvironment', () => {
  it('copies only the main checkout .env into the current worktree', () => {
    withTemporaryDirectory((root) => {
      const repositoryRoot = path.join(root, 'worktrees', 'e159', 'evorto');
      const mainCheckout = path.join(root, 'home', 'code', 'evorto');
      fs.mkdirSync(repositoryRoot, { recursive: true });
      fs.mkdirSync(mainCheckout, { recursive: true });
      fs.writeFileSync(
        path.join(mainCheckout, '.env'),
        [
          'SECRET=main',
          'FONT_AWESOME_TOKEN=unused-private-package-token',
          'FONTAWESOME_NPM_AUTH_TOKEN=unused-private-package-token',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(path.join(mainCheckout, '.env.dev'), 'BASE_URL=wrong\n');
      fs.writeFileSync(
        path.join(mainCheckout, '.npmrc'),
        '@fortawesome:registry=https://npm.fontawesome.com/\n',
      );
      const messages: string[] = [];

      copyMainEnvironment({
        env: { HOME: path.join(root, 'home') },
        log: (message) => messages.push(message),
        repositoryRoot,
      });

      expect(fs.readFileSync(path.join(repositoryRoot, '.env'), 'utf8')).toBe(
        'SECRET=main\n',
      );
      expect(fs.existsSync(path.join(repositoryRoot, '.env.dev'))).toBe(false);
      expect(fs.existsSync(path.join(repositoryRoot, '.npmrc'))).toBe(false);
      expect(messages).toContain(
        'Omitted Font Awesome package-token variables; Evorto uses the public npm Font Awesome packages.',
      );
      expect(messages).toContain(
        'Do not copy .env.dev or .npmrc; .env.dev is generated per worktree and Font Awesome must stay on the public npm registry.',
      );
    });
  });

  it('preserves comments and unrelated env lines while omitting Font Awesome package tokens', () => {
    withTemporaryDirectory((root) => {
      const repositoryRoot = path.join(root, 'worktrees', 'e159', 'evorto');
      const mainCheckout = path.join(root, 'home', 'code', 'evorto');
      fs.mkdirSync(repositoryRoot, { recursive: true });
      fs.mkdirSync(mainCheckout, { recursive: true });
      fs.writeFileSync(
        path.join(mainCheckout, '.env'),
        [
          '# local developer secrets',
          'SECRET=main',
          '  FONTAWESOME_TOKEN=unused-private-package-token',
          'FONTAWESOME_PACKAGE_TOKEN=unused-private-package-token',
          'NEON_API_KEY=keep-neon',
          '',
        ].join('\n'),
      );

      copyMainEnvironment({
        env: { HOME: path.join(root, 'home') },
        log: ignoreLog,
        repositoryRoot,
      });

      expect(fs.readFileSync(path.join(repositoryRoot, '.env'), 'utf8')).toBe(
        [
          '# local developer secrets',
          'SECRET=main',
          'NEON_API_KEY=keep-neon',
          '',
        ].join('\n'),
      );
    });
  });

  it('refuses to overwrite an existing worktree .env unless forced', () => {
    withTemporaryDirectory((root) => {
      const repositoryRoot = path.join(root, 'worktrees', 'e159', 'evorto');
      const mainCheckout = path.join(root, 'home', 'code', 'evorto');
      fs.mkdirSync(repositoryRoot, { recursive: true });
      fs.mkdirSync(mainCheckout, { recursive: true });
      fs.writeFileSync(path.join(mainCheckout, '.env'), 'SECRET=main\n');
      fs.writeFileSync(path.join(repositoryRoot, '.env'), 'SECRET=worktree\n');

      expect(() =>
        copyMainEnvironment({
          env: { HOME: path.join(root, 'home') },
          log: ignoreLog,
          repositoryRoot,
        }),
      ).toThrow(/--if-missing[\s\S]*--force/u);
      expect(fs.readFileSync(path.join(repositoryRoot, '.env'), 'utf8')).toBe(
        'SECRET=worktree\n',
      );

      copyMainEnvironment({
        argv: ['bun', 'helpers/testing/copy-main-environment.ts', '--force'],
        env: { HOME: path.join(root, 'home') },
        log: ignoreLog,
        repositoryRoot,
      });

      expect(fs.readFileSync(path.join(repositoryRoot, '.env'), 'utf8')).toBe(
        'SECRET=main\n',
      );
    });
  });

  it('leaves an existing worktree .env unchanged when if-missing is requested', () => {
    withTemporaryDirectory((root) => {
      const repositoryRoot = path.join(root, 'worktrees', 'e159', 'evorto');
      const mainCheckout = path.join(root, 'home', 'code', 'evorto');
      fs.mkdirSync(repositoryRoot, { recursive: true });
      fs.mkdirSync(mainCheckout, { recursive: true });
      fs.writeFileSync(path.join(mainCheckout, '.env'), 'SECRET=main\n');
      fs.writeFileSync(path.join(repositoryRoot, '.env'), 'SECRET=worktree\n');
      const messages: string[] = [];

      copyMainEnvironment({
        argv: [
          'bun',
          'helpers/testing/copy-main-environment.ts',
          '--if-missing',
        ],
        env: { HOME: path.join(root, 'home') },
        log: (message) => messages.push(message),
        repositoryRoot,
      });

      expect(fs.readFileSync(path.join(repositoryRoot, '.env'), 'utf8')).toBe(
        'SECRET=worktree\n',
      );
      expect(messages).toEqual([
        `${path.join(repositoryRoot, '.env')} already exists; leaving it unchanged.`,
      ]);
    });
  });

  it('does not require a source checkout when if-missing finds an existing worktree .env', () => {
    withTemporaryDirectory((root) => {
      const repositoryRoot = path.join(root, 'worktrees', 'e159', 'evorto');
      fs.mkdirSync(repositoryRoot, { recursive: true });
      fs.writeFileSync(path.join(repositoryRoot, '.env'), 'SECRET=worktree\n');
      const messages: string[] = [];

      copyMainEnvironment({
        argv: [
          'bun',
          'helpers/testing/copy-main-environment.ts',
          '--if-missing',
        ],
        env: { HOME: path.join(root, 'home-without-code-checkout') },
        log: (message) => messages.push(message),
        repositoryRoot,
      });

      expect(fs.readFileSync(path.join(repositoryRoot, '.env'), 'utf8')).toBe(
        'SECRET=worktree\n',
      );
      expect(messages).toEqual([
        `${path.join(repositoryRoot, '.env')} already exists; leaving it unchanged.`,
      ]);
    });
  });

  it('supports an explicit MAIN_CHECKOUT_DIR when the default sibling path is absent', () => {
    withTemporaryDirectory((root) => {
      const repositoryRoot = path.join(root, 'worktrees', 'e159', 'evorto');
      const mainCheckout = path.join(root, 'source-checkout');
      fs.mkdirSync(repositoryRoot, { recursive: true });
      fs.mkdirSync(mainCheckout, { recursive: true });
      fs.writeFileSync(path.join(mainCheckout, '.env'), 'SECRET=explicit\n');

      copyMainEnvironment({
        env: {
          HOME: path.join(root, 'home-without-code-checkout'),
          MAIN_CHECKOUT_DIR: mainCheckout,
        },
        log: ignoreLog,
        repositoryRoot,
      });

      expect(fs.readFileSync(path.join(repositoryRoot, '.env'), 'utf8')).toBe(
        'SECRET=explicit\n',
      );
    });
  });

  it('points at the no-secret checklist when the source .env is missing', () => {
    withTemporaryDirectory((root) => {
      const repositoryRoot = path.join(root, 'worktrees', 'e159', 'evorto');
      fs.mkdirSync(repositoryRoot, { recursive: true });

      expect(() =>
        copyMainEnvironment({
          env: { HOME: path.join(root, 'home') },
          log: ignoreLog,
          repositoryRoot,
        }),
      ).toThrow(/\.env\.example[\s\S]*\.env/u);
    });
  });
});
