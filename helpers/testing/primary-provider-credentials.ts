import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { parse } from 'dotenv';

export const primaryCheckoutProviderCredentialNames = [
  'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER',
  'E2E_LIVE_ESN_CARD_IDENTIFIER',
  'PUBLIC_GOOGLE_MAPS_API_KEY',
] as const;

const configuredValue = (
  environment: NodeJS.ProcessEnv,
  name: (typeof primaryCheckoutProviderCredentialNames)[number],
): string | undefined => {
  const value = environment[name]?.trim();
  return value ? value : undefined;
};

export const resolvePrimaryCheckoutRoot = (repositoryRoot: string): string => {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Could not locate the primary checkout: ${result.stderr.trim() || `git exited with status ${String(result.status)}`}`,
    );
  }

  const firstWorktree = result.stdout
    .split('\0')
    .find((field) => field.startsWith('worktree '));
  const checkoutRoot = firstWorktree?.slice('worktree '.length);
  if (!checkoutRoot) {
    throw new Error('Git did not report a primary checkout');
  }
  return fs.realpathSync(checkoutRoot);
};

export const providerEnvironmentFromPrimaryCheckout = ({
  environment,
  primaryCheckoutRoot,
  repositoryRoot = process.cwd(),
}: {
  readonly environment: NodeJS.ProcessEnv;
  readonly primaryCheckoutRoot?: string;
  readonly repositoryRoot?: string;
}): {
  readonly environment: NodeJS.ProcessEnv;
  readonly loadedNames: readonly (typeof primaryCheckoutProviderCredentialNames)[number][];
} => {
  const missingNames = primaryCheckoutProviderCredentialNames.filter(
    (name) => configuredValue(environment, name) === undefined,
  );
  if (missingNames.length === 0) {
    return { environment: { ...environment }, loadedNames: [] };
  }

  const sourceRoot =
    primaryCheckoutRoot ?? resolvePrimaryCheckoutRoot(repositoryRoot);
  const sourcePath = path.join(sourceRoot, '.env');
  const sourceStat = fs.lstatSync(sourcePath, { throwIfNoEntry: false });
  if (!sourceStat) {
    return { environment: { ...environment }, loadedNames: [] };
  }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error('The primary checkout .env must be a regular file');
  }

  const sourceEnvironment = parse(fs.readFileSync(sourcePath));
  const loadedEntries = missingNames.flatMap((name) => {
    const value = configuredValue(sourceEnvironment, name);
    return value === undefined ? [] : [[name, value] as const];
  });

  return {
    environment: { ...environment, ...Object.fromEntries(loadedEntries) },
    loadedNames: loadedEntries.map(([name]) => name),
  };
};
