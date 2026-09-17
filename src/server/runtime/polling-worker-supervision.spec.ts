import { assert, describe, it } from '@effect/vitest';
import { Cause, Deferred, Effect, Exit, Fiber } from 'effect';
import { TestConsole } from 'effect/testing';

import { launchRegistrationRefundWorker } from '../payments/registration-refund';
import {
  reportPollingWorkerFailure,
  supervisePollingWorkers,
} from './polling-worker-supervision';

const findDefect = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return;
  const reason = exit.cause.reasons.find((candidate) =>
    Cause.isDieReason(candidate),
  );
  return reason?.defect;
};

describe('polling worker supervision', () => {
  it.effect('logs and re-fails an unexpected iteration defect', () =>
    Effect.gen(function* () {
      const defect = new Error('worker iteration defect');
      const message = 'Test polling worker iteration failed';

      const exit = yield* Effect.die(defect).pipe(
        Effect.catchCause(reportPollingWorkerFailure(message)),
        Effect.exit,
      );

      assert.isTrue(Exit.hasDies(exit));
      assert.strictEqual(findDefect(exit), defect);
      assert.isTrue((yield* TestConsole.logLines).includes(message));
    }),
  );

  it.effect(
    'preserves intentional worker interruption without failure logging',
    () =>
      Effect.gen(function* () {
        const message = 'Interrupted polling worker failed';

        const exit = yield* Effect.interrupt.pipe(
          Effect.catchCause(reportPollingWorkerFailure(message)),
          Effect.exit,
        );

        assert.isTrue(Exit.hasInterrupts(exit));
        assert.isFalse((yield* TestConsole.logLines).includes(message));
      }),
  );

  it.effect('fails the supervisor and interrupts sibling workers', () =>
    Effect.gen(function* () {
      const siblingStarted = yield* Deferred.make<undefined>();
      const siblingInterrupted = yield* Deferred.make<undefined>();
      const defect = new Error('worker supervisor defect');
      const sibling = Deferred.succeed(siblingStarted, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Deferred.succeed(siblingInterrupted, undefined),
        ),
      );
      const failing = Deferred.await(siblingStarted).pipe(
        Effect.andThen(Effect.die(defect)),
      );

      const exit = yield* supervisePollingWorkers([sibling, failing]).pipe(
        Effect.exit,
      );

      assert.isTrue(Exit.hasDies(exit));
      assert.strictEqual(findDefect(exit), defect);
      assert.isTrue(yield* Deferred.isDone(siblingInterrupted));
    }),
  );
  it.effect('propagates enabled refund worker defects into supervision', () =>
    Effect.gen(function* () {
      const defect = new Error('refund worker failed');
      const exit = yield* launchRegistrationRefundWorker(
        'enabled',
        Effect.die(defect),
      ).pipe(Effect.exit);
      assert.isTrue(Exit.hasDies(exit));
      assert.strictEqual(findDefect(exit), defect);
      assert.isTrue(
        (yield* TestConsole.logLines).includes(
          'Registration refund worker started',
        ),
      );
    }),
  );

  it.effect('waits for owned worker finalizers during shutdown', () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<undefined>();
      const released = yield* Deferred.make<undefined>();
      const worker = Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(Deferred.succeed(released, undefined)),
      );
      const fiber = yield* supervisePollingWorkers([worker]).pipe(
        Effect.forkScoped,
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      assert.isTrue(yield* Deferred.isDone(released));
    }),
  );
});
