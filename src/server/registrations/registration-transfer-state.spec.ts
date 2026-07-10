import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import {
  ensureRegistrationTransferTransition,
  registrationTransferCapacityDelta,
  resolveRegistrationCancellationDeadline,
  resolveRegistrationFeeRefund,
  resolveRegistrationTransferDeadline,
  resolveRegistrationTransferRefundPlan,
} from './registration-transfer-state';

describe('registration transfer state', () => {
  it.effect(
    'allows recipient confirmation before durable refund completion',
    () =>
      Effect.gen(function* () {
        yield* ensureRegistrationTransferTransition('open', 'refund_pending');
        yield* ensureRegistrationTransferTransition(
          'refund_pending',
          'completed',
        );
      }),
  );

  it.effect(
    'keeps paid-recipient compensation recoverable until its full refund completes',
    () =>
      Effect.gen(function* () {
        yield* ensureRegistrationTransferTransition(
          'checkout_pending',
          'compensation_pending',
        );
        yield* ensureRegistrationTransferTransition(
          'compensation_pending',
          'compensation_failed',
        );
        yield* ensureRegistrationTransferTransition(
          'compensation_failed',
          'compensation_pending',
        );
        yield* ensureRegistrationTransferTransition(
          'compensation_pending',
          'compensated',
        );
      }),
  );

  it.effect('rejects reopening a completed transfer', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ensureRegistrationTransferTransition('completed', 'open'),
      );

      assert.strictEqual(error._tag, 'RegistrationTransferStateError');
      assert.include(error.message, 'completed to open');
    }),
  );

  it.effect(
    'resolves tenant timing defaults and nullable option overrides',
    () =>
      Effect.gen(function* () {
        const eventStart = new Date('2026-08-20T18:00:00.000Z');
        const now = new Date('2026-08-01T12:00:00.000Z');
        const tenantDefault = yield* resolveRegistrationTransferDeadline({
          eventStart,
          now,
          optionHoursBeforeStart: null,
          tenantHoursBeforeStart: 0,
        });
        const optionOverride = yield* resolveRegistrationTransferDeadline({
          eventStart,
          now,
          optionHoursBeforeStart: 24,
          tenantHoursBeforeStart: 0,
        });
        const cancellation = yield* resolveRegistrationCancellationDeadline({
          eventStart,
          optionHoursBeforeStart: null,
          tenantHoursBeforeStart: 120,
        });

        assert.strictEqual(
          tenantDefault.toISOString(),
          '2026-08-20T18:00:00.000Z',
        );
        assert.strictEqual(
          optionOverride.toISOString(),
          '2026-08-19T18:00:00.000Z',
        );
        assert.strictEqual(
          cancellation.toISOString(),
          '2026-08-15T18:00:00.000Z',
        );
        assert.isTrue(
          resolveRegistrationFeeRefund({
            optionRefundFees: null,
            tenantRefundFees: true,
          }),
        );
        assert.isFalse(
          resolveRegistrationFeeRefund({
            optionRefundFees: false,
            tenantRefundFees: true,
          }),
        );
      }),
  );

  it.effect('rejects an offer after its resolved transfer deadline', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveRegistrationTransferDeadline({
          eventStart: new Date('2026-08-20T18:00:00.000Z'),
          now: new Date('2026-08-20T18:00:00.000Z'),
          optionHoursBeforeStart: null,
          tenantHoursBeforeStart: 0,
        }),
      );

      assert.strictEqual(error._tag, 'RegistrationTransferStateError');
      assert.strictEqual(
        error.message,
        'Registration can no longer be transferred',
      );
    }),
  );

  it.effect(
    'refunds gross plus application fee behavior when fees are refundable',
    () =>
      Effect.gen(function* () {
        const plan = yield* resolveRegistrationTransferRefundPlan(
          { amount: 2000, stripeNetAmount: 1820 },
          true,
        );

        assert.deepStrictEqual(plan, {
          amount: 2000,
          applicationFeeRefunded: true,
        });
      }),
  );

  it.effect('refunds persisted net when fees are not refundable', () =>
    Effect.gen(function* () {
      const plan = yield* resolveRegistrationTransferRefundPlan(
        { amount: 2000, stripeNetAmount: 1820 },
        false,
      );

      assert.deepStrictEqual(plan, {
        amount: 1820,
        applicationFeeRefunded: false,
      });
    }),
  );

  it.effect('fails closed until Stripe fee settlement is persisted', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveRegistrationTransferRefundPlan(
          { amount: 2000, stripeNetAmount: null },
          false,
        ),
      );

      assert.include(error.message, 'Stripe fee reconciliation');
    }),
  );

  it('reserves only capacity above the source registration and swaps the confirmed delta', () => {
    assert.deepStrictEqual(
      registrationTransferCapacityDelta({
        recipientSpotCount: 3,
        sourceSpotCount: 2,
      }),
      { additionalReservation: 1, confirmedDelta: 1 },
    );
    assert.deepStrictEqual(
      registrationTransferCapacityDelta({
        recipientSpotCount: 1,
        sourceSpotCount: 2,
      }),
      { additionalReservation: 0, confirmedDelta: -1 },
    );
  });
});
