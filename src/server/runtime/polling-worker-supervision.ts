import { Cause, Effect } from 'effect';

export const reportPollingWorkerFailure =
  (message: string) =>
  <E>(cause: Cause.Cause<E>) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.failCause(cause)
      : Effect.logError(message).pipe(
          Effect.annotateLogs({ cause: String(cause) }),
          Effect.andThen(Effect.failCause(cause)),
        );

export const supervisePollingWorkers = <A, E>(
  workers: readonly Effect.Effect<A, E, never>[],
) => Effect.all(workers, { concurrency: 'unbounded', discard: true });
