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

const defect = Cause.die(new Error(privateDetail));
const interruption = Cause.interrupt(42);
const expectedFailure = Cause.fail(
  new FixtureRefundError({ message: privateDetail }),
);

describe('immediate transfer refund failure handling', () => {
  it.effect('logs safe context and continues after an expected failure', () =>
    Effect.gen(function* () {
      const logs = captureLogs();
      let continued = false;
      const outcome = yield* Effect.failCause(expectedFailure).pipe(
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
    }),
  );

  it.effect.each([
    { cause: defect, name: 'a defect' },
    { cause: interruption, name: 'an interruption' },
    {
      cause: Cause.fromReasons([...defect.reasons, ...interruption.reasons]),
      name: 'a defect and interruption together',
    },
    {
      cause: Cause.fromReasons([...expectedFailure.reasons, ...defect.reasons]),
      name: 'a defect mixed with an expected failure',
    },
    {
      cause: Cause.fromReasons([
        ...expectedFailure.reasons,
        ...interruption.reasons,
      ]),
      name: 'an interruption mixed with an expected failure',
    },
    {
      cause: Cause.fromReasons([
        ...expectedFailure.reasons,
        ...defect.reasons,
        ...interruption.reasons,
      ]),
      name: 'a defect and interruption mixed with an expected failure',
    },
  ])('preserves $name without continuing or logging recovery', ({ cause }) =>
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
      if (Exit.isSuccess(outcome))
        throw new Error('Expected an unrecoverable cause');
      expect(outcome.cause.reasons).toEqual(
        cause.reasons.filter((reason) => !Cause.isFailReason(reason)),
      );
      expect(continued).toBe(false);
      expect(logs.entries).toEqual([]);
    }),
  );
});
