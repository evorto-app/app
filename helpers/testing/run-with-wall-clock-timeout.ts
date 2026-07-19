const timeoutText = process.argv[2];
const terminationGraceText = process.argv[3];
const command = process.argv.slice(4);

const readSeconds = (
  value: string | undefined,
  description: string,
  allowZero: boolean,
): number => {
  const validPattern = allowZero ? /^\d+$/u : /^[1-9]\d*$/u;
  if (!value || !validPattern.test(value)) {
    throw new Error(`${description} must be an integer number of seconds`);
  }
  return Number(value);
};

if (command.length === 0) {
  throw new Error('A command is required after the timeout arguments');
}

const timeoutSeconds = readSeconds(timeoutText, 'Wall-clock timeout', true);
const terminationGraceSeconds = readSeconds(
  terminationGraceText,
  'Termination grace',
  true,
);

const subprocess = Bun.spawn(command, {
  detached: true,
  stderr: 'inherit',
  stdin: 'inherit',
  stdout: 'inherit',
});

let timedOut = false;
let forwardedSignalExitCode: number | undefined;
let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
let forceKillPromise: Promise<void> | undefined;
let resolveForceKill: (() => void) | undefined;

const isNoSuchProcessError = (
  error: unknown,
): error is Error & { code: 'ESRCH' } =>
  error instanceof Error && 'code' in error && error.code === 'ESRCH';

const signalProcessGroup = (signal: NodeJS.Signals): void => {
  try {
    process.kill(-subprocess.pid, signal);
  } catch (error) {
    if (!isNoSuchProcessError(error)) throw error;
  }
};

const scheduleForceKill = (): void => {
  if (forceKillPromise !== undefined) return;

  forceKillPromise = new Promise((resolve) => {
    resolveForceKill = resolve;
    forceKillTimer = setTimeout(() => {
      try {
        signalProcessGroup('SIGKILL');
      } finally {
        forceKillTimer = undefined;
        resolveForceKill = undefined;
        resolve();
      }
    }, terminationGraceSeconds * 1000);
  });
};

const forwardSignal = (signal: NodeJS.Signals, exitCode: number): void => {
  forwardedSignalExitCode ??= exitCode;
  try {
    signalProcessGroup(signal);
  } finally {
    scheduleForceKill();
  }
};

process.once('SIGHUP', () => forwardSignal('SIGHUP', 129));
process.once('SIGINT', () => forwardSignal('SIGINT', 130));
process.once('SIGTERM', () => forwardSignal('SIGTERM', 143));

const timeoutTimer =
  timeoutSeconds === 0
    ? undefined
    : setTimeout(() => {
        timedOut = true;
        try {
          signalProcessGroup('SIGTERM');
        } finally {
          scheduleForceKill();
        }
      }, timeoutSeconds * 1000);

const exitCode = await subprocess.exited;
if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
if (forceKillTimer !== undefined) {
  try {
    process.kill(-subprocess.pid, 0);
  } catch (error) {
    if (!isNoSuchProcessError(error)) throw error;
    clearTimeout(forceKillTimer);
    forceKillTimer = undefined;
    const resolve = resolveForceKill;
    resolve?.();
  }
}
if (forceKillPromise !== undefined) await forceKillPromise;
if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);

if (timedOut) {
  process.stderr.write(
    `Command exceeded its ${timeoutSeconds}-second wall-clock timeout.\n`,
  );
  process.exitCode = 124;
} else {
  process.exitCode = forwardedSignalExitCode ?? exitCode;
}

export {};
