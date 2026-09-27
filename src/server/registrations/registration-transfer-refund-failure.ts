import { Cause, Effect } from 'effect';

import { safeServerErrorSummary } from '../utils/safe-server-error-summary';

// Refund claims are already durable. A failed immediate attempt does not undo
// ownership. Defects and cancellation must still end the request.
export const reportImmediateTransferRefundFailure =
  (context: { readonly refundClaimId: string; readonly transferId: string }) =>
  <E>(cause: Cause.Cause<E>) => {
    const unrecoverableReasons = cause.reasons.filter(
      (reason): reason is Cause.Die | Cause.Interrupt =>
        !Cause.isFailReason(reason),
    );
    return unrecoverableReasons.length > 0
      ? Effect.failCause(Cause.fromReasons<never>(unrecoverableReasons))
      : Effect.logError(
          'Registration transfer refund remains queued after immediate processing failed',
        ).pipe(
          Effect.annotateLogs(context),
          Effect.annotateLogs(
            safeServerErrorSummary(
              'registrationTransfer.claim.refundProcessing',
              cause,
            ),
          ),
        );
  };
