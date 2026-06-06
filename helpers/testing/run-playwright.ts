import { spawnSync } from 'node:child_process';

interface RunPlaywrightOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  spawn?: typeof spawnSync;
}

export const localDocumentationEnvironment = {
  DOCS_IMG_OUT_DIR: 'test-results/docs/images',
  DOCS_OUT_DIR: 'test-results/docs',
} as const;

export const runPlaywright = (options: RunPlaywrightOptions = {}): number => {
  const argv = [...(options.argv ?? process.argv.slice(2))];
  const environment = {
    ...(options.env ?? process.env),
    ...localDocumentationEnvironment,
  };
  const noWebserverIndex = argv.indexOf('--no-webserver');

  if (noWebserverIndex !== -1) {
    argv.splice(noWebserverIndex, 1);
    environment['NO_WEBSERVER'] = 'true';
  }

  const spawn = options.spawn ?? spawnSync;
  const result = spawn(
    'node_modules/.bin/dotenv',
    ['-c', 'dev', '--', 'playwright', 'test', ...argv],
    {
      env: environment,
      stdio: 'inherit',
    },
  );

  if (result.status !== null) {
    return result.status;
  }

  if (result.signal) {
    throw new Error(`Playwright exited after signal ${result.signal}`);
  }

  throw new Error('Playwright exited without a status or signal.');
};

if (import.meta.main) {
  try {
    process.exitCode = runPlaywright();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
