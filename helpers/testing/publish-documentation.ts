import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { e2eTestUserPasswordVariables } from '../user-data';
import { buildDocumentationConsumerBundle } from './documentation-publication-contract';
import { resolvePlaywrightReporterArgument } from '../../tests/support/config/protected-value-reporters';

const requiredIntegrationCredentials = [
  ...e2eTestUserPasswordVariables,
  'AUTH0_MANAGEMENT_CLIENT_ID',
  'AUTH0_MANAGEMENT_CLIENT_SECRET',
  'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER',
  'E2E_LIVE_ESN_CARD_IDENTIFIER',
  'PUBLIC_GOOGLE_MAPS_API_KEY',
] as const;

export const documentationPublishProjects = [
  'docs-baseline',
  'docs-integration',
  'docs-live-esncard',
] as const;

export const resolveDocumentationPublishPlaywrightArguments = (
  environment: NodeJS.ProcessEnv,
): string[] => [
  'playwright',
  'test',
  ...documentationPublishProjects.map((project) => `--project=${project}`),
  resolvePlaywrightReporterArgument({
    ci: environment['CI'] === 'true',
    includeDocumentation: true,
    listOnly: false,
  }),
];

const configuredValue = (
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined => {
  const value = environment[name]?.trim();
  return value && value.length > 0 ? value : undefined;
};

export const assertDocumentationPublishCredentials = (
  environment: NodeJS.ProcessEnv,
): void => {
  const missing = requiredIntegrationCredentials.filter(
    (name) => configuredValue(environment, name) === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `Documentation publishing requires the complete integration credential set. Missing: ${missing.join(', ')}`,
    );
  }
};

const requiredPath = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = configuredValue(environment, name);
  if (!value) throw new Error(`Documentation publishing requires ${name}`);
  if (!path.isAbsolute(value)) {
    throw new Error(`Documentation publishing requires ${name} to be absolute`);
  }
  return path.normalize(value);
};

const assertRealDirectory = (directory: string, label: string): void => {
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${directory}`);
  }
};

const assertRegularFile = (filePath: string, label: string): void => {
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
};

const documentationConsumerEnvironmentNames = [
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'TEMP',
  'TMP',
  'TMPDIR',
] as const;

export const documentationConsumerEnvironment = (
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv =>
  Object.fromEntries(
    documentationConsumerEnvironmentNames.flatMap((name) => {
      const value = environment[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );

const runConsumerGit = (
  repositoryRoot: string,
  args: readonly string[],
): string => {
  const sshAuthSocket = process.env['SSH_AUTH_SOCK'];
  const result = spawnSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    env: {
      ...documentationConsumerEnvironment(process.env),
      GIT_TERMINAL_PROMPT: '0',
      ...(sshAuthSocket ? { SSH_AUTH_SOCK: sshAuthSocket } : {}),
    },
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Evorto Pages checkout validation failed for git ${args.join(' ')}: ${result.stderr.trim() || `status ${String(result.status)}`}`,
    );
  }
  return result.stdout;
};

const readLiveDocumentationConsumerUpstream = (
  repositoryRoot: string,
): string => {
  const localBranch = runConsumerGit(repositoryRoot, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'HEAD',
  ]).trim();
  const remote = runConsumerGit(repositoryRoot, [
    'config',
    '--get',
    `branch.${localBranch}.remote`,
  ]).trim();
  const mergeRef = runConsumerGit(repositoryRoot, [
    'config',
    '--get',
    `branch.${localBranch}.merge`,
  ]).trim();
  if (!remote || !mergeRef.startsWith('refs/heads/')) {
    throw new Error(
      'Evorto Pages checkout must have a branch-based configured upstream',
    );
  }

  const remoteLines = runConsumerGit(repositoryRoot, [
    'ls-remote',
    '--exit-code',
    remote,
    mergeRef,
  ])
    .trim()
    .split('\n')
    .filter((line) => line.length > 0);
  const liveMatches = remoteLines.flatMap((line) => {
    const [commit, ref, ...remainder] = line.split(/\s+/u);
    return ref === mergeRef && remainder.length === 0 ? [commit] : [];
  });
  const liveCommit = liveMatches.length === 1 ? liveMatches[0] : undefined;
  if (!liveCommit || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(liveCommit)) {
    throw new Error(
      'Evorto Pages configured upstream did not resolve to one live branch commit',
    );
  }
  return liveCommit;
};

export const assertDocumentationConsumerCurrent = ({
  head,
  liveUpstream,
  status,
}: {
  head: string;
  liveUpstream: string;
  status: string;
}): void => {
  if (status.trim()) {
    throw new Error(
      'Evorto Pages checkout must be clean before documentation publication',
    );
  }
  if (head.trim() !== liveUpstream.trim()) {
    throw new Error(
      'Evorto Pages checkout must match its configured upstream tip from the live remote before documentation publication',
    );
  }
};

const assertTrustedDocumentationConsumer = (
  repositoryRoot: string,
  syncScript: string,
): void => {
  const gitRoot = fs.realpathSync(
    runConsumerGit(repositoryRoot, ['rev-parse', '--show-toplevel']).trim(),
  );
  if (gitRoot !== fs.realpathSync(repositoryRoot)) {
    throw new Error(
      `EVORTO_PAGES_ROOT must be the Git repository root: ${repositoryRoot}`,
    );
  }

  const relativeSyncScript = path.relative(repositoryRoot, syncScript);
  runConsumerGit(repositoryRoot, [
    'ls-files',
    '--error-unmatch',
    '--',
    relativeSyncScript,
  ]);
  const trackedConsumerFiles = runConsumerGit(repositoryRoot, [
    'ls-files',
    '--',
    'apps/documentation-page',
  ]).trim();
  if (!trackedConsumerFiles) {
    throw new Error(
      'Evorto Pages documentation consumer must contain tracked files',
    );
  }

  const status = runConsumerGit(repositoryRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);

  const head = runConsumerGit(repositoryRoot, ['rev-parse', 'HEAD']);
  const liveUpstream = readLiveDocumentationConsumerUpstream(repositoryRoot);
  assertDocumentationConsumerCurrent({ head, liveUpstream, status });
};

export const resolveDocumentationConsumer = (
  environment: NodeJS.ProcessEnv,
): { repositoryRoot: string; syncScript: string } => {
  const repositoryRoot = requiredPath(environment, 'EVORTO_PAGES_ROOT');
  assertRealDirectory(repositoryRoot, 'Evorto Pages repository root');
  assertRealDirectory(
    path.join(repositoryRoot, 'apps', 'documentation-page'),
    'Evorto Pages documentation consumer',
  );
  const syncScript = path.join(
    repositoryRoot,
    'tools',
    'docs',
    'sync-generated-docs.mjs',
  );
  assertRegularFile(syncScript, 'Evorto Pages documentation sync tool');
  assertTrustedDocumentationConsumer(repositoryRoot, syncScript);
  return { repositoryRoot, syncScript };
};

export const assertGeneratedDocumentation = (
  docsDirectory: string,
  imagesDirectory: string,
): void => {
  assertRealDirectory(docsDirectory, 'Generated documentation directory');
  assertRealDirectory(
    imagesDirectory,
    'Generated documentation image directory',
  );
  const hasPage = fs
    .readdirSync(docsDirectory, { recursive: true, withFileTypes: true })
    .some((entry) => entry.isFile() && entry.name === 'page.md');
  const hasImage = fs
    .readdirSync(imagesDirectory, { recursive: true, withFileTypes: true })
    .some((entry) => entry.isFile());
  if (!hasPage)
    throw new Error('Generated documentation contains no page.md files');
  if (!hasImage) throw new Error('Generated documentation contains no images');
};

const runDocumentationGeneration = (
  docsDirectory: string,
  imagesDirectory: string,
  environment: NodeJS.ProcessEnv,
): void => {
  const result = spawnSync(
    'bunx',
    resolveDocumentationPublishPlaywrightArguments(environment),
    {
      env: {
        ...environment,
        DOCS_IMG_OUT_DIR: imagesDirectory,
        DOCS_OUT_DIR: docsDirectory,
        E2E_SELECTED_PROJECTS: documentationPublishProjects.join(','),
      },
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Documentation Playwright generation failed with ${result.signal ? `signal ${result.signal}` : `status ${String(result.status)}`}`,
    );
  }
};

export const runDocumentationConsumerSync = (input: {
  environment?: NodeJS.ProcessEnv;
  repositoryRoot: string;
  sourceRoot: string;
  syncScript: string;
}): void => {
  // Generation can take minutes. Revalidate the consumer immediately before
  // the only operation that mutates it instead of trusting the earlier check.
  assertTrustedDocumentationConsumer(input.repositoryRoot, input.syncScript);

  const result = spawnSync(
    'node',
    [input.syncScript, '--source', input.sourceRoot],
    {
      cwd: input.repositoryRoot,
      env: documentationConsumerEnvironment(input.environment ?? process.env),
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Evorto Pages documentation sync failed with ${result.signal ? `signal ${result.signal}` : `status ${String(result.status)}`}`,
    );
  }
};

export const publishDocumentation = (
  environment: NodeJS.ProcessEnv = process.env,
): void => {
  assertDocumentationPublishCredentials(environment);
  const consumer = resolveDocumentationConsumer(environment);
  const stagingParent = path.resolve('test-results');
  fs.mkdirSync(stagingParent, { recursive: true });
  const stagingRoot = fs.mkdtempSync(path.join(stagingParent, 'docs-publish-'));
  const rawDocsRoot = path.join(stagingRoot, 'raw', 'docs');
  const rawImagesRoot = path.join(stagingRoot, 'raw', 'images');
  const consumerSourceRoot = path.join(stagingRoot, 'consumer');

  try {
    runDocumentationGeneration(rawDocsRoot, rawImagesRoot, environment);
    assertGeneratedDocumentation(rawDocsRoot, rawImagesRoot);
    buildDocumentationConsumerBundle({
      outputRoot: consumerSourceRoot,
      rawDocsRoot,
      rawImagesRoot,
    });
    runDocumentationConsumerSync({
      repositoryRoot: consumer.repositoryRoot,
      sourceRoot: consumerSourceRoot,
      syncScript: consumer.syncScript,
    });
  } finally {
    fs.rmSync(stagingRoot, { force: true, recursive: true });
  }
};

if (import.meta.main) publishDocumentation();
