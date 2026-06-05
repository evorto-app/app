import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const fail = (messages: readonly string[]): never => {
  throw new Error(messages.join('\n'));
};

const main = (): void => {
  const repositoryRoot = process.cwd();
  const repositoryName = path.basename(repositoryRoot);
  const homeDirectory = process.env['HOME']?.trim();
  const explicitMainCheckout = process.env['MAIN_CHECKOUT_DIR']?.trim();
  const force = process.argv.includes('--force');

  if (!homeDirectory && !explicitMainCheckout) {
    fail([
      'HOME is not set. Set MAIN_CHECKOUT_DIR to the source checkout that contains .env.',
    ]);
  }

  const mainCheckout = explicitMainCheckout
    ? path.resolve(explicitMainCheckout)
    : path.join(homeDirectory ?? '', 'code', repositoryName);
  const source = path.join(mainCheckout, '.env');
  const destination = path.join(repositoryRoot, '.env');

  if (path.resolve(source) === path.resolve(destination)) {
    fail([
      'The main checkout .env path is the current checkout .env path; nothing to copy.',
    ]);
  }

  if (!existsSync(source)) {
    fail([
      `No main-checkout developer secrets file found at ${source}.`,
      `Use ${path.join(repositoryRoot, '.env.example')} as the no-secret checklist, then add missing values to ${destination}.`,
    ]);
  }

  if (existsSync(destination) && !force) {
    fail([
      `${destination} already exists.`,
      'Rerun with --force only when you intentionally want to replace it.',
    ]);
  }

  copyFileSync(source, destination);
  console.log(`Copied developer secrets from ${source} to ${destination}.`);
  console.log(
    'Do not copy .env.dev; it is generated per worktree by bun run env:runtime.',
  );
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
