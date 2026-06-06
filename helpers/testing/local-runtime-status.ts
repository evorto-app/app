import { spawnSync } from 'node:child_process';

interface LocalRuntimeStatusOptions {
  runCommand?: (commandArguments: readonly string[]) => StatusCommandResult;
  writeError?: (message: string) => void;
  writeOutput?: (message: string) => void;
}

interface StatusCommand {
  args: readonly string[];
  label: string;
}

interface StatusCommandResult {
  error?: Error;
  status: null | number;
}

const defaultRunCommand = (
  commandArguments: readonly string[],
): StatusCommandResult =>
  spawnSync(commandArguments[0] ?? '', commandArguments.slice(1), {
    stdio: 'inherit',
  });

const runStatusCommand = (
  { args, label }: StatusCommand,
  options: Required<LocalRuntimeStatusOptions>,
): boolean => {
  options.writeOutput(`\n== ${label} ==`);
  const result = options.runCommand(args);

  if (result.error) {
    options.writeError(`${label} failed to start: ${result.error.message}`);
    return false;
  }

  return result.status === 0;
};

export const statusCommands: readonly StatusCommand[] = [
  {
    args: ['bun', 'run', 'env:runtime'],
    label: 'Generate worktree runtime environment',
  },
  {
    args: [
      'node_modules/.bin/dotenv',
      '-c',
      'dev',
      '--',
      'bun',
      'helpers/testing/runtime-preflight.ts',
      'dev',
    ],
    label: 'Development runtime preflight',
  },
  {
    args: [
      'node_modules/.bin/dotenv',
      '-c',
      'dev',
      '--',
      'bun',
      'helpers/testing/runtime-preflight.ts',
      'docker',
    ],
    label: 'Docker runtime preflight',
  },
  {
    args: [
      'node_modules/.bin/dotenv',
      '-c',
      'dev',
      '--',
      'bun',
      'helpers/testing/local-app-route-probe.ts',
    ],
    label: 'Existing app route probe',
  },
  {
    args: [
      'node_modules/.bin/dotenv',
      '-c',
      'dev',
      '--',
      'bun',
      'helpers/testing/delete-neon-local-branches.ts',
      '--dry-run',
    ],
    label: 'Neon Local branch cleanup dry-run',
  },
];

export const runLocalRuntimeStatus = (
  options: LocalRuntimeStatusOptions = {},
): readonly string[] => {
  const resolvedOptions: Required<LocalRuntimeStatusOptions> = {
    runCommand: options.runCommand ?? defaultRunCommand,
    writeError: options.writeError ?? console.error,
    writeOutput: options.writeOutput ?? console.log,
  };
  const failedLabels = statusCommands
    .filter((command) => !runStatusCommand(command, resolvedOptions))
    .map((command) => command.label);

  if (failedLabels.length > 0) {
    resolvedOptions.writeError(
      `\nLocal runtime status failed: ${failedLabels.join(', ')}.`,
    );
  } else {
    resolvedOptions.writeOutput('\nLocal runtime status passed.');
  }

  return failedLabels;
};

if (import.meta.main) {
  const failedLabels = runLocalRuntimeStatus();
  if (failedLabels.length > 0) {
    process.exitCode = 1;
  }
}
