import path from 'node:path';

import {
  CommandLineError,
  fail,
  runCommandsSequentially,
} from '../cli/runtime-command';

const playwrightCliPath = path.resolve(process.cwd(), 'node_modules/playwright/cli.js');

const hasProjectFlag = (commandLineArguments: readonly string[]): boolean =>
  commandLineArguments.some(
    (argument) => argument === '--project' || argument.startsWith('--project='),
  );

const collectRequestedProjects = (
  commandLineArguments: readonly string[],
): string[] => {
  const projects: string[] = [];

  for (let index = 0; index < commandLineArguments.length; index += 1) {
    const argument = commandLineArguments[index];

    if (!argument) {
      continue;
    }

    if (argument === '--project') {
      const project = commandLineArguments[index + 1];
      if (project) {
        projects.push(project);
      }
      continue;
    }

    if (argument.startsWith('--project=')) {
      projects.push(argument.slice('--project='.length));
    }
  }

  return projects;
};

const main = async (): Promise<void> => {
  const [defaultProject, ...rawArguments] = process.argv.slice(2);

  if (!defaultProject) {
    fail(
      'Usage: bun helpers/testing/run-playwright.ts <default-project> [--prewarm-setup] [...playwright-args]',
    );
  }

  const forwardedArguments: string[] = [];
  let prewarmSetup = false;

  for (const argument of rawArguments) {
    if (argument === '--prewarm-setup') {
      prewarmSetup = true;
      continue;
    }

    forwardedArguments.push(argument);
  }

  const playwrightArguments = hasProjectFlag(forwardedArguments)
    ? forwardedArguments
    : [`--project=${defaultProject}`, ...forwardedArguments];

  const requestedProjects = collectRequestedProjects(playwrightArguments);
  const endToEndMode = requestedProjects.some((project) =>
    project.includes('integration'),
  )
    ? 'integration'
    : 'baseline';

  const commands = [
    ...(prewarmSetup
      ? [
          {
            cmd: [process.execPath, playwrightCliPath, 'test', '--project=setup'],
            extraEnv: { E2E_MODE: 'baseline' },
            runtimeEnv: true,
          },
        ]
      : []),
    {
      cmd: [process.execPath, playwrightCliPath, 'test', ...playwrightArguments],
      extraEnv: { E2E_MODE: endToEndMode },
      runtimeEnv: true,
    },
  ];

  const exitCode = await runCommandsSequentially(commands);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
};

await main().catch((error: unknown) => {
  if (error instanceof CommandLineError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  throw error;
});
