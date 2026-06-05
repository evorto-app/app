import { spawnSync } from 'node:child_process';

interface StatusCommand {
  args: readonly string[];
  label: string;
}

const runStatusCommand = ({ args, label }: StatusCommand): boolean => {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(args[0] ?? '', args.slice(1), {
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`${label} failed to start: ${result.error.message}`);
    return false;
  }

  return result.status === 0;
};

const statusCommands: readonly StatusCommand[] = [
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
      'helpers/testing/delete-neon-local-branches.ts',
      '--dry-run',
    ],
    label: 'Neon Local branch cleanup dry-run',
  },
];

const failedLabels = statusCommands
  .filter((command) => !runStatusCommand(command))
  .map((command) => command.label);

if (failedLabels.length > 0) {
  console.error(`\nLocal runtime status failed: ${failedLabels.join(', ')}.`);
  process.exitCode = 1;
} else {
  console.log('\nLocal runtime status passed.');
}
