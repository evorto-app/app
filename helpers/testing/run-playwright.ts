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

const localPlaywrightBinary = 'node_modules/.bin/playwright';

const getExitStatus = (
  label: string,
  result: ReturnType<typeof spawnSync>,
): number => {
  if (result.status !== null) {
    return result.status;
  }

  if (result.signal) {
    throw new Error(`${label} exited after signal ${result.signal}`);
  }

  throw new Error(`${label} exited without a status or signal.`);
};

export const runPlaywright = (options: RunPlaywrightOptions = {}): number => {
  const argv = [...(options.argv ?? process.argv.slice(2))];
  const baseEnvironment = options.env ?? process.env;
  const environment = {
    ...baseEnvironment,
    ...localDocumentationEnvironment,
  };
  const noWebserverIndex = argv.indexOf('--no-webserver');
  const spawn = options.spawn ?? spawnSync;

  if (noWebserverIndex !== -1) {
    argv.splice(noWebserverIndex, 1);
    environment['NO_WEBSERVER'] = 'true';
  }

  const copyMainEnvironmentResult = spawn(
    'bun',
    ['run', 'env:copy-main', '--', '--if-missing'],
    {
      env: baseEnvironment,
      stdio: 'inherit',
    },
  );
  const copyMainEnvironmentStatus = getExitStatus(
    'Main checkout environment copy',
    copyMainEnvironmentResult,
  );

  if (copyMainEnvironmentStatus !== 0) {
    return copyMainEnvironmentStatus;
  }

  const runtimeResult = spawn('bun', ['run', 'env:runtime'], {
    env: baseEnvironment,
    stdio: 'inherit',
  });
  const runtimeStatus = getExitStatus(
    'Runtime environment refresh',
    runtimeResult,
  );

  if (runtimeStatus !== 0) {
    return runtimeStatus;
  }

  return getExitStatus(
    'Playwright',
    spawn(
      'node_modules/.bin/dotenv',
      ['-c', 'dev', '--', localPlaywrightBinary, 'test', ...argv],
      {
        env: environment,
        stdio: 'inherit',
      },
    ),
  );
};

if (import.meta.main) {
  try {
    process.exitCode = runPlaywright();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
