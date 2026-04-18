import path from 'node:path';

import {
  CommandLineError,
  fail,
  runCommandsSequentially,
} from './cli/runtime-command';

const drizzleCliPath = path.resolve(process.cwd(), 'node_modules/drizzle-kit/bin.cjs');
const databaseScriptPath = path.resolve(process.cwd(), 'helpers/database.ts');

const main = async (): Promise<void> => {
  const action = process.argv[2];

  if (!action) {
    fail('Usage: bun helpers/database-command.ts <push|setup|studio>');
  }

  const commandsByAction = {
    push: [
      {
        cmd: [process.execPath, drizzleCliPath, 'push', '--force'],
        runtimeEnv: true,
      },
    ],
    setup: [
      {
        cmd: [process.execPath, drizzleCliPath, 'push', '--force'],
        runtimeEnv: true,
      },
      {
        cmd: [process.execPath, databaseScriptPath],
        runtimeEnv: true,
      },
    ],
    studio: [
      {
        cmd: [process.execPath, drizzleCliPath, 'studio'],
        runtimeEnv: true,
      },
    ],
  } as const;

  const commands = commandsByAction[action as keyof typeof commandsByAction];

  if (!commands) {
    fail(`Unknown database action: ${action}`);
  }

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
