import { describe, expect, it } from '@effect/vitest';

import { runLocalRuntimeStatus, statusCommands } from './local-runtime-status';

describe('runLocalRuntimeStatus', () => {
  it('runs every local runtime status check and reports success', () => {
    const executedCommands: string[] = [];
    const output: string[] = [];
    const errors: string[] = [];

    const failedLabels = runLocalRuntimeStatus({
      runCommand: (commandArguments) => {
        executedCommands.push(commandArguments.join(' '));
        return { status: 0 };
      },
      writeError: (message) => errors.push(message),
      writeOutput: (message) => output.push(message),
    });

    expect(failedLabels).toEqual([]);
    expect(executedCommands).toEqual(
      statusCommands.map(({ args }) => args.join(' ')),
    );
    expect(output).toContain('\nLocal runtime status passed.');
    expect(errors).toEqual([]);
  });

  it('keeps running after failed checks and reports the failed labels together', () => {
    const executedCommands: string[] = [];
    const errors: string[] = [];
    const failingLabels = new Set([
      'Development runtime preflight',
      'Docker runtime preflight',
    ]);

    const failedLabels = runLocalRuntimeStatus({
      runCommand: (commandArguments) => {
        executedCommands.push(commandArguments.join(' '));
        const label = statusCommands.find(
          (command) => command.args.join(' ') === commandArguments.join(' '),
        )?.label;

        return { status: label && failingLabels.has(label) ? 1 : 0 };
      },
      writeError: (message) => errors.push(message),
      writeOutput: () => {
        expect(true).toBe(true);
      },
    });

    expect(executedCommands).toEqual(
      statusCommands.map(({ args }) => args.join(' ')),
    );
    expect(failedLabels).toEqual([
      'Development runtime preflight',
      'Docker runtime preflight',
    ]);
    expect(errors).toContain(
      '\nLocal runtime status failed: Development runtime preflight, Docker runtime preflight.',
    );
  });

  it('reports command startup failures as failed status checks', () => {
    const errors: string[] = [];

    const failedLabels = runLocalRuntimeStatus({
      runCommand: (commandArguments) => ({
        error:
          commandArguments[0] === 'bun'
            ? new Error('bun is not available')
            : undefined,
        status: commandArguments[0] === 'bun' ? null : 0,
      }),
      writeError: (message) => errors.push(message),
      writeOutput: () => {
        expect(true).toBe(true);
      },
    });

    expect(failedLabels).toEqual(['Generate worktree runtime environment']);
    expect(errors).toContain(
      'Generate worktree runtime environment failed to start: bun is not available',
    );
  });
});
