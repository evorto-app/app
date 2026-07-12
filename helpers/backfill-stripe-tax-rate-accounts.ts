import { databaseLayer } from '@db/index';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Cause, Effect, Layer } from 'effect';

import { runStripeTaxRateAccountBackfill } from '../src/server/payments/stripe-tax-rate-account-backfill';
import { stripeClientLayer } from '../src/server/stripe-client';

const backfill = runStripeTaxRateAccountBackfill().pipe(
  Effect.tap((summary) =>
    Effect.logInfo('Stripe tax-rate account backfill completed').pipe(
      Effect.annotateLogs(summary),
    ),
  ),
  Effect.tapError((error) =>
    Effect.logError(error.message).pipe(
      Effect.annotateLogs({
        reason: error.reason,
        ...(error.remainingCount !== undefined && {
          remainingCount: error.remainingCount,
        }),
        ...(error.rowId !== undefined && { rowId: error.rowId }),
        ...(error.stripeTaxRateId !== undefined && {
          stripeTaxRateId: error.stripeTaxRateId,
        }),
        ...(error.tenantId !== undefined && { tenantId: error.tenantId }),
      }),
    ),
  ),
  Effect.provide(Layer.merge(databaseLayer, stripeClientLayer)),
  Effect.catchCause((cause) =>
    Cause.hasInterrupts(cause)
      ? Effect.failCause(cause)
      : Effect.logError(
          'Stripe tax-rate account backfill failed; deployment remains blocked',
        ).pipe(
          Effect.andThen(
            Effect.fail(
              new Error('Stripe tax-rate account backfill failed safely'),
            ),
          ),
        ),
  ),
);

BunRuntime.runMain(backfill);
