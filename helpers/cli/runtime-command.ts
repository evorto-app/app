import path from 'node:path';

export interface CommandSpec {
  cmd: string[];
  cwd?: string;
  extraEnv?: Record<string, string>;
  runtimeEnv?: boolean;
}

export class CommandLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandLineError';
  }
}

const dotenvCliPath = path.resolve(process.cwd(), 'node_modules/dotenv-cli/cli.js');

const buildRuntimeEnvironmentArguments = (): string[] => {
  const environmentArguments: string[] = [];

  if (process.env['CI']) {
    environmentArguments.push('-e', '.env.ci');
  }

  environmentArguments.push('-e', '.env.runtime', '-e', '.env.local', '-e', '.env');

  return environmentArguments;
};

export const fail = (message: string): never => {
  throw new CommandLineError(message);
};

export const runCommand = async (
  cmd: readonly string[],
  options: {
    cwd?: string;
    extraEnv?: Record<string, string>;
  } = {},
): Promise<number> => {
  const subprocess = Bun.spawn({
    cmd: [...cmd],
    cwd: options.cwd,
    env: options.extraEnv
      ? { ...process.env, ...options.extraEnv }
      : process.env,
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  });

  return await subprocess.exited;
};

export const runWithRuntimeEnvironmentCommand = async (
  cmd: readonly string[],
  options: {
    cwd?: string;
    extraEnv?: Record<string, string>;
  } = {},
): Promise<number> => {
  const variableArguments = Object.entries(options.extraEnv ?? {}).flatMap(
    ([key, value]) => ['-v', `${key}=${value}`],
  );

  return await runCommand(
    [
      process.execPath,
      dotenvCliPath,
      ...buildRuntimeEnvironmentArguments(),
      ...variableArguments,
      '--',
      ...cmd,
    ],
    { cwd: options.cwd },
  );
};

export const runCommandsSequentially = async (
  commands: readonly CommandSpec[],
): Promise<number> => {
  for (const command of commands) {
    const exitCode = command.runtimeEnv
      ? await runWithRuntimeEnvironmentCommand(command.cmd, {
          cwd: command.cwd,
          extraEnv: command.extraEnv,
        })
      : await runCommand(command.cmd, {
          cwd: command.cwd,
          extraEnv: command.extraEnv,
        });

    if (exitCode !== 0) {
      return exitCode;
    }
  }

  return 0;
};
