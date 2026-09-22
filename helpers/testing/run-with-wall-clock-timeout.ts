import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

const supervisorArgument = '--internal-wall-clock-supervisor';
const acknowledgementMilliseconds = 1000;
const isSupervisor = process.argv[2] === supervisorArgument;
const argumentOffset = isSupervisor ? 3 : 2;
const command = process.argv.slice(argumentOffset + 2);

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
const timeoutSeconds = readSeconds(
  process.argv[argumentOffset],
  'Wall-clock timeout',
  true,
);
const terminationGraceSeconds = readSeconds(
  process.argv[argumentOffset + 1],
  'Termination grace',
  true,
);

type CancellationSignal = 'SIGHUP' | 'SIGINT' | 'SIGTERM';
const signalExitCode = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
const isCancellationSignal = (value: unknown): value is CancellationSignal =>
  value === 'SIGHUP' || value === 'SIGINT' || value === 'SIGTERM';
const isMessage = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const diagnostic = (message: string, error?: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${message}${error === undefined ? '' : `: ${detail}`}\n`,
  );
};

const supervise = async () => {
  const send = process.send?.bind(process);
  if (!send) throw new Error('The private supervisor requires owned IPC');

  let phase: 'running' | 'terminating' | 'finishing' = 'running';
  let outcome: number | undefined;
  let cleanupFailed = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let acknowledgementTimer: ReturnType<typeof setTimeout> | undefined;
  let parentConnected = process.connected;

  const killOwnedGroup = () => {
    clearTimeout(acknowledgementTimer);
    // This process remains the session/group leader until this call kills it.
    // No callback signals a reaped child's numeric identity.
    try {
      process.kill(-process.pid, 'SIGKILL');
    } catch (error) {
      diagnostic(
        'Could not terminate the live supervisor process group',
        error,
      );
      // Retain the live lease if the OS refuses termination. Exiting here
      // would leave descendants without an owner able to settle them safely.
      setTimeout(killOwnedGroup, 100);
    }
  };

  const finish = (code: number) => {
    if (phase === 'finishing') return;
    phase = 'finishing';
    clearTimeout(timeoutTimer);
    clearTimeout(graceTimer);
    const exitCode = code === 0 && cleanupFailed ? 1 : code;
    acknowledgementTimer = setTimeout(() => {
      diagnostic(
        'Supervisor result acknowledgement exceeded 1000 milliseconds.',
      );
      killOwnedGroup();
    }, acknowledgementMilliseconds);
    if (!parentConnected) {
      killOwnedGroup();
      return;
    }
    try {
      send({ kind: 'result', exitCode });
    } catch (error) {
      diagnostic('Could not report the command outcome to its owner', error);
      killOwnedGroup();
    }
  };

  const cancel = (signal: CancellationSignal, timedOut = false) => {
    if (phase === 'finishing') return;
    if (timedOut) {
      outcome = 124;
      diagnostic(
        `Command exceeded its ${timeoutSeconds}-second wall-clock timeout.`,
      );
      // A still-running command keeps its deadline after an external signal.
      // Timeout overrides its status without restarting the existing grace.
      if (phase === 'terminating') return;
    } else {
      if (phase !== 'running') return;
      outcome = signalExitCode[signal];
    }
    phase = 'terminating';
    // Escalation survives the command leader's exit: resistant descendants
    // still belong to this live supervisor's group.
    graceTimer = setTimeout(
      () => finish(outcome ?? 1),
      terminationGraceSeconds * 1000,
    );
    try {
      process.kill(-process.pid, signal);
    } catch (error) {
      cleanupFailed = true;
      diagnostic('Could not signal the live supervisor process group', error);
    }
  };

  process.on('message', (message: unknown) => {
    if (!isMessage(message)) return;
    if (message['kind'] === 'ack' && phase === 'finishing') killOwnedGroup();
    if (
      message['kind'] === 'cancel' &&
      isCancellationSignal(message['signal'])
    ) {
      cancel(message['signal']);
    }
  });
  process.on('disconnect', () => {
    parentConnected = false;
    if (phase === 'finishing') killOwnedGroup();
    else cancel('SIGTERM');
  });
  process.on('SIGHUP', () => cancel('SIGHUP'));
  process.on('SIGINT', () => cancel('SIGINT'));
  process.on('SIGTERM', () => cancel('SIGTERM'));

  if (!parentConnected) {
    finish(143);
    return;
  }

  try {
    const child = Bun.spawn(command, {
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    });
    if (timeoutSeconds !== 0) {
      timeoutTimer = setTimeout(
        () => cancel('SIGTERM', true),
        timeoutSeconds * 1000,
      );
    }
    const exitCode = await child.exited;
    clearTimeout(timeoutTimer);
    if (phase === 'running') finish(exitCode);
  } catch (error) {
    diagnostic('Could not run the command', error);
    finish(outcome ?? 1);
  }
};

const run = async () => {
  let firstSignal: CancellationSignal | undefined;
  let outcome: number | undefined;
  let failed = false;
  let settled = false;
  let requestCancellation = (signal: CancellationSignal) => {
    firstSignal ??= signal;
  };
  const onHangup = () => requestCancellation('SIGHUP');
  const onInterrupt = () => requestCancellation('SIGINT');
  const onTerminate = () => requestCancellation('SIGTERM');
  // Register before the supervisor can launch a command or publish readiness.
  process.on('SIGHUP', onHangup);
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  const environment = { ...process.env };
  delete environment['EVORTO_WALL_CLOCK_CONTROL_FD'];
  delete environment['EVORTO_WALL_CLOCK_CONTROL_PATH'];
  const supervisor = Bun.spawn(
    [
      process.execPath,
      ...process.execArgv,
      import.meta.path,
      supervisorArgument,
      String(timeoutSeconds),
      String(terminationGraceSeconds),
      ...command,
    ],
    {
      detached: true,
      env: environment,
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
      ipc(message: unknown, child) {
        if (
          !isMessage(message) ||
          message['kind'] !== 'result' ||
          typeof message['exitCode'] !== 'number' ||
          !Number.isInteger(message['exitCode']) ||
          message['exitCode'] < 0 ||
          message['exitCode'] > 255 ||
          outcome !== undefined
        ) {
          failed = true;
          diagnostic('Invalid or duplicate supervisor result.');
          child.disconnect();
          return;
        }
        outcome = message['exitCode'];
        try {
          child.send({ kind: 'ack' });
        } catch (error) {
          failed = true;
          diagnostic('Could not acknowledge the supervisor result', error);
          child.disconnect();
        }
      },
    },
  );
  requestCancellation = (signal) => {
    if (settled || outcome !== undefined || firstSignal !== undefined) return;
    firstSignal = signal;
    try {
      supervisor.send({ kind: 'cancel', signal });
    } catch (error) {
      failed = true;
      diagnostic('Could not send cancellation through owned IPC', error);
      supervisor.disconnect();
    }
  };
  const pendingSignal = firstSignal;
  firstSignal = undefined;
  if (pendingSignal) requestCancellation(pendingSignal);

  let controlDescriptor: number | undefined;
  let controlTimer: ReturnType<typeof setInterval> | undefined;
  let controlText = '';
  const consumeControl = (text: string) => {
    controlText += text;
    const lines = controlText.split('\n');
    controlText = lines.pop() ?? '';
    for (const line of lines) {
      if (line === 'HUP') requestCancellation('SIGHUP');
      else if (line === 'INT') requestCancellation('SIGINT');
      else if (line === 'TERM') requestCancellation('SIGTERM');
      else {
        failed = true;
        diagnostic('Invalid wall-clock cancellation control message.');
        requestCancellation('SIGTERM');
      }
    }
  };
  if (process.env['EVORTO_WALL_CLOCK_CONTROL_FD'] === '3') {
    try {
      const retained = fstatSync(3, { bigint: true });
      const controlPath = process.env['EVORTO_WALL_CLOCK_CONTROL_PATH'];
      if (!retained.isFIFO() || !controlPath)
        throw new Error('Cancellation requires an owned FIFO path and fd 3');
      // macOS /dev/fd ignores O_NONBLOCK. Open the owned path and compare it
      // with the still-retained fd: that live inode cannot be reused meanwhile.
      controlDescriptor = openSync(
        controlPath,
        constants.O_RDONLY | constants.O_NONBLOCK,
      );
      const opened = fstatSync(controlDescriptor, { bigint: true });
      if (
        !opened.isFIFO() ||
        opened.dev !== retained.dev ||
        opened.ino !== retained.ino
      ) {
        throw new Error('Cancellation path does not match the retained FIFO');
      }
      const buffer = Buffer.alloc(256);
      const descriptor = controlDescriptor;
      controlTimer = setInterval(() => {
        try {
          const count = readSync(descriptor, buffer, 0, buffer.length, null);
          if (count === 0) {
            clearInterval(controlTimer);
            requestCancellation('SIGTERM');
          } else consumeControl(buffer.toString('utf8', 0, count));
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK')
          )
            return;
          clearInterval(controlTimer);
          failed = true;
          diagnostic('Wall-clock cancellation control failed', error);
          requestCancellation('SIGTERM');
        }
      }, 25);
    } catch (error) {
      failed = true;
      diagnostic('Could not acquire the owned cancellation reader', error);
      requestCancellation('SIGTERM');
    }
  }
  try {
    await supervisor.exited;
    if (outcome === undefined || supervisor.signalCode !== 'SIGKILL') {
      failed = true;
      diagnostic(
        'Supervisor exited without completing owned group settlement.',
      );
    }
  } finally {
    settled = true;
    clearInterval(controlTimer);
    for (const descriptor of [
      controlDescriptor,
      process.env['EVORTO_WALL_CLOCK_CONTROL_FD'] === '3' ? 3 : undefined,
    ]) {
      if (descriptor === undefined) continue;
      try {
        closeSync(descriptor);
      } catch (error) {
        failed = true;
        diagnostic('Could not close the owned cancellation reader', error);
      }
    }
    process.removeListener('SIGHUP', onHangup);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
  process.exitCode = outcome ?? (firstSignal ? signalExitCode[firstSignal] : 1);
  if (failed && process.exitCode === 0) process.exitCode = 1;
};

if (isSupervisor) await supervise();
else await run();
