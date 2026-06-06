import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const fail = (messages: readonly string[]): never => {
  throw new Error(messages.join('\n'));
};

interface CopyMainEnvironmentOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  fileExists?: (filePath: string) => boolean;
  log?: (message: string) => void;
  readFile?: (filePath: string) => string;
  repositoryRoot?: string;
  writeFile?: (filePath: string, contents: string) => void;
}

const omittedFontAwesomeTokenNames = new Set([
  'FONT_AWESOME_TOKEN',
  'FONTAWESOME_NPM_AUTH_TOKEN',
  'FONTAWESOME_PACKAGE_TOKEN',
  'FONTAWESOME_TOKEN',
]);

const omitFontAwesomePackageTokens = (source: string): string =>
  source
    .split('\n')
    .filter((line) => {
      const trimmedLine = line.trimStart();
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        return true;
      }

      const separatorIndex = trimmedLine.indexOf('=');
      if (separatorIndex === -1) {
        return true;
      }

      return !omittedFontAwesomeTokenNames.has(
        trimmedLine.slice(0, separatorIndex).trim(),
      );
    })
    .join('\n');

export const copyMainEnvironment = (
  options: CopyMainEnvironmentOptions = {},
): void => {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const repositoryName = path.basename(repositoryRoot);
  const environment = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const fileExists = options.fileExists ?? existsSync;
  const readFile =
    options.readFile ?? ((filePath: string) => readFileSync(filePath, 'utf8'));
  const writeFile =
    options.writeFile ??
    ((filePath: string, contents: string) => writeFileSync(filePath, contents));
  const log = options.log ?? console.log;
  const homeDirectory = environment['HOME']?.trim();
  const explicitMainCheckout = environment['MAIN_CHECKOUT_DIR']?.trim();
  const force = argv.includes('--force');
  const ifMissing = argv.includes('--if-missing');

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

  if (fileExists(destination) && ifMissing && !force) {
    log(`${destination} already exists; leaving it unchanged.`);
    return;
  }

  if (path.resolve(source) === path.resolve(destination)) {
    fail([
      'The main checkout .env path is the current checkout .env path; nothing to copy.',
    ]);
  }

  if (!fileExists(source)) {
    fail([
      `No main-checkout developer secrets file found at ${source}.`,
      `Use ${path.join(repositoryRoot, '.env.example')} as the no-secret checklist, then add missing values to ${destination}.`,
    ]);
  }

  if (fileExists(destination) && !force) {
    fail([
      `${destination} already exists.`,
      'Rerun with --if-missing to leave it unchanged or --force only when you intentionally want to replace it.',
    ]);
  }

  writeFile(destination, omitFontAwesomePackageTokens(readFile(source)));
  log(`Copied developer secrets from ${source} to ${destination}.`);
  log(
    'Omitted Font Awesome package-token variables; Evorto uses the public npm Font Awesome packages.',
  );
  log(
    'Do not copy .env.dev or .npmrc; .env.dev is generated per worktree and Font Awesome must stay on the public npm registry.',
  );
};

try {
  if (import.meta.main) {
    copyMainEnvironment();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
