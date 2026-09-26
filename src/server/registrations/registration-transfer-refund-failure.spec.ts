import { describe, expect, it } from '@effect/vitest';
import { Cause, Effect, Exit, Logger, References, Schema } from 'effect';

import { reportImmediateTransferRefundFailure } from './registration-transfer-refund-failure';

class FixtureRefundError extends Schema.TaggedError<FixtureRefundError>()(
  'FixtureRefundError',
  { message: Schema.String },
) {}

const context = { refundClaimId: 'refund-1', transferId: 'transfer-1' };
const privateDetail =
  'private provider detail https://provider.invalid/?token=fixture-secret';

const captureLogs = () => {
  const entries: Record<string, unknown>[] = [];
  const logger = Logger.make(({ fiber, message }) => {
    entries.push({
      ...fiber.getRef(References.CurrentLogAnnotations),
      message,
    });
  });
  return { entries, layer: Logger.layer([logger]) };
};

describe('immediate transfer refund failure handling', () => {
  it.effect(
    'logs safe context and lets the caller continue after ordinary failures',
    () =>
      Effect.gen(function* () {
        for (const failure of [
          Effect.fail(new FixtureRefundError({ message: privateDetail })),
          Effect.die(new Error(privateDetail)),
        ]) {
          const logs = captureLogs();
          let continued = false;
          const outcome = yield* failure.pipe(
            Effect.catchCause(reportImmediateTransferRefundFailure(context)),
            Effect.andThen(
              Effect.sync(() => {
                continued = true;
              }),
            ),
            Effect.exit,
            Effect.provide(logs.layer),
          );
          expect(Exit.isSuccess(outcome)).toBe(true);
          expect(continued).toBe(true);
          expect(logs.entries).toHaveLength(1);
          expect(logs.entries[0]).toMatchObject({
            ...context,
            operation: 'registrationTransfer.claim.refundProcessing',
          });
          expect(JSON.stringify(logs.entries)).not.toContain(privateDetail);
        }
      }),
  );

  it.effect.each([
    { cause: Cause.interrupt(42), name: 'an interruption' },
    {
      cause: Cause.fromReasons([
        ...Cause.die(new Error(privateDetail)).reasons,
        ...Cause.interrupt(42).reasons,
      ]),
      name: 'an interruption combined with a defect',
    },
  ])(
    'preserves $name without continuing or logging a processing failure',
    ({ cause }) =>
      Effect.gen(function* () {
        const logs = captureLogs();
        let continued = false;
        const outcome = yield* Effect.failCause(cause).pipe(
          Effect.catchCause(reportImmediateTransferRefundFailure(context)),
          Effect.andThen(
            Effect.sync(() => {
              continued = true;
            }),
          ),
          Effect.exit,
          Effect.provide(logs.layer),
        );
        expect(Exit.hasInterrupts(outcome)).toBe(true);
        expect(Exit.hasDies(outcome)).toBe(false);
        if (Exit.isSuccess(outcome)) throw new Error('Expected interruption');
        expect(Cause.interruptors(outcome.cause)).toEqual(new Set([42]));
        expect(continued).toBe(false);
        expect(logs.entries).toEqual([]);
      }),
  );
});
