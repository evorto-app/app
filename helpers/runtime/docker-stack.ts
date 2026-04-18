import {
  CommandLineError,
  fail,
  runCommandsSequentially,
} from '../cli/runtime-command';

const main = async (): Promise<void> => {
  const action = process.argv[2];

  if (!action) {
    fail(
      'Usage: bun helpers/runtime/docker-stack.ts <start|start:foreground|start:watch|stop>',
    );
  }

  const commandsByAction = {
    start: [
      {
        cmd: ['docker', 'compose', 'down'],
        runtimeEnv: true,
      },
      {
        cmd: ['docker', 'compose', 'up', '--build', '-d'],
        runtimeEnv: true,
      },
    ],
    'start:foreground': [
      {
        cmd: ['docker', 'compose', 'down'],
        runtimeEnv: true,
      },
      {
        cmd: ['docker', 'compose', 'up', '--build'],
        runtimeEnv: true,
      },
    ],
    'start:watch': [
      {
        cmd: ['docker', 'compose', 'down'],
        runtimeEnv: true,
      },
      {
        cmd: ['docker', 'compose', 'up', '--build', '-w'],
        runtimeEnv: true,
      },
    ],
    stop: [
      {
        cmd: ['docker', 'compose', 'down'],
        runtimeEnv: true,
      },
    ],
  } as const;

  const commands = commandsByAction[action as keyof typeof commandsByAction];

  if (!commands) {
    fail(`Unknown docker stack action: ${action}`);
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
