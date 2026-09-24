import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('post-registration add-on mutation guards', () => {
  it('pins Checkout expiry to the server-owned purchase time', () => {
    const source = readSource('addon-purchase.service.ts');

    expect(source).toContain('getServerNow(undefined)');
    expect(source).toContain('pinnedNowIso: input.now.toISOString()');
  });

  it('derives purchase ownership in the RPC handler and forwards only participant intent', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    const handlerStart = source.indexOf("'events.purchaseRegistrationAddon':");
    const handlerEnd = source.indexOf(
      "'events.redeemRegistrationAddon':",
      handlerStart,
    );
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handler).toContain('yield* RpcAccess.ensureAuthenticated()');
    expect(handler).toContain('const { tenant } = yield* RpcAccess.current()');
    expect(handler).toContain('const user = yield* RpcAccess.requireUser()');
    expect(handler).toContain('yield* purchaseRegistrationAddon({');
    expect(handler).toContain('addonId: addOnId');
    expect(handler).toContain('tenantId: tenant.id');
    expect(handler).toContain('userId: user.id');
    expect(handler).not.toContain('pinnedNowIso');
    expect(handler).not.toContain('stripeAccountId');
  });

  it('keeps event availability and payment deadlines on their owning clocks', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    const handlerStart = source.indexOf("'events.getRegistrationStatus':");
    const handlerEnd = source.indexOf("'events.joinWaitlist':", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handler).toContain(
      'const now = yield* registrationHandlerNow.pipe(Effect.orDie)',
    );
    expect(handler).toContain(
      'const paymentDeadlineNow = yield* registrationPaymentDeadlineNow',
    );
    expect(handler).toContain(
      'matchingPendingOrder?.expiresAt,\n                  paymentDeadlineNow,',
    );
    expect(handler).not.toContain('getServerNow(undefined)');
  });

  it('blocks registration cancellation while an add-on payment is pending', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    const pendingTransaction = source.indexOf(
      'const pendingAddonTransaction =',
    );
    const orderLock = source.indexOf(
      '.from(eventRegistrationAddonPurchaseOrders)',
      pendingTransaction,
    );
    const entitlementLock = source.indexOf(
      'const lockedAddonPurchases =',
      orderLock,
    );

    expect(pendingTransaction).toBeGreaterThanOrEqual(0);
    expect(orderLock).toBeGreaterThan(pendingTransaction);
    expect(entitlementLock).toBeGreaterThan(orderLock);
    expect(source.slice(orderLock, entitlementLock)).toContain(
      ".for('update')",
    );
  });

  it('locks the current acquisition and pending add-on payment before sealing transfer entitlements', () => {
    const source = readSource('registration-transfer.service.ts');
    const acquisitionLock = source.indexOf('const acquisitionRows =');
    const pendingOrder = source.indexOf('const pendingAddonOrderCandidates =');
    const pendingTransactionLock = source.indexOf(
      'const pendingAddonTransactions =',
      pendingOrder,
    );
    const pendingOrderLock = source.indexOf(
      'const lockedAddonOrders =',
      pendingTransactionLock,
    );
    const entitlementLock = source.indexOf(
      'const sourceAddOnEntitlements =',
      pendingOrderLock,
    );
    const componentLock = source.indexOf(
      'const acquisitionComponents =',
      entitlementLock,
    );
    const sourcePaymentLock = source.indexOf(
      'const sourcePayments =',
      componentLock,
    );

    expect(acquisitionLock).toBeGreaterThanOrEqual(0);
    expect(pendingOrder).toBeGreaterThan(acquisitionLock);
    expect(pendingTransactionLock).toBeGreaterThan(pendingOrder);
    expect(pendingOrderLock).toBeGreaterThan(pendingTransactionLock);
    expect(entitlementLock).toBeGreaterThan(pendingOrderLock);
    expect(componentLock).toBeGreaterThan(entitlementLock);
    expect(sourcePaymentLock).toBeGreaterThan(componentLock);
    expect(source.slice(componentLock, sourcePaymentLock)).toContain(
      'registrationAcquisitionComponents',
    );
    expect(source.slice(sourcePaymentLock)).toContain(
      '.from(registrationAcquisitionPayments)',
    );
  });

  it('blocks pending add-on payment before opening an offer without changing ownership', () => {
    const source = readSource('registration-transfer.service.ts');
    const offerStart = source.indexOf(
      "const createOffer = Effect.fn('RegistrationTransferService.createOffer')",
    );
    const offerEnd = source.indexOf('const getClaim =', offerStart);
    const offer = source.slice(offerStart, offerEnd);
    const registrationLock = offer.indexOf('const lockedSources =');
    const acquisitionLock = offer.indexOf('const acquisitionRows =');
    const pendingOrder = offer.indexOf('const pendingAddonOrderCandidates =');
    const pendingTransactionLock = offer.indexOf(
      'const pendingAddonTransactions =',
      pendingOrder,
    );
    const pendingOrderLock = offer.indexOf(
      'const lockedAddonOrders =',
      pendingTransactionLock,
    );
    const entitlementLock = offer.indexOf(
      'const sourceAddOnEntitlements =',
      pendingOrderLock,
    );
    const offerInsert = offer.indexOf('.insert(registrationTransfers)');

    expect(offerStart).toBeGreaterThanOrEqual(0);
    expect(offerEnd).toBeGreaterThan(offerStart);
    expect(registrationLock).toBeGreaterThanOrEqual(0);
    expect(acquisitionLock).toBeGreaterThan(registrationLock);
    expect(pendingOrder).toBeGreaterThan(acquisitionLock);
    expect(pendingTransactionLock).toBeGreaterThan(pendingOrder);
    expect(pendingOrderLock).toBeGreaterThan(pendingTransactionLock);
    expect(entitlementLock).toBeGreaterThan(pendingOrderLock);
    expect(offerInsert).toBeGreaterThan(entitlementLock);
    const pendingGuard = offer.slice(pendingOrder, entitlementLock);
    expect(pendingGuard).toContain('pendingAddonTransactions.length !== 1');
    expect(pendingGuard).toContain('lockedAddonOrders.length !== 1');
    expect(pendingGuard).toContain(
      'transactions.eventRegistrationId, lockedSource.id',
    );
    expect(pendingGuard).toContain('transactions.tenantId, tenant.id');
    expect(pendingGuard).toContain("transactions.status, 'pending'");
    expect(pendingGuard).toContain(
      'return yield* new RegistrationTransferConflictError',
    );
    expect(offer).not.toContain('.update(eventRegistrations)');
  });

  it('keeps paid and free ownership changes in the authenticated private claim flow', () => {
    const source = readSource('registration-transfer.service.ts');
    const claimStart = source.indexOf(
      "const claim = Effect.fn('RegistrationTransferService.claim')",
    );
    const claim = source.slice(claimStart);
    const paymentStart = claim.indexOf(
      'if (requiresCheckout && lockedStripeAccountId) {',
    );
    const sourcePayments = claim.indexOf('const currentAcquisitionPayments =');
    const ownerUpdate = claim.indexOf('const transferredRegistrations =');
    expect(claimStart).toBeGreaterThanOrEqual(0);
    expect(paymentStart).toBeGreaterThanOrEqual(0);
    expect(sourcePayments).toBeGreaterThan(paymentStart);
    expect(ownerUpdate).toBeGreaterThan(sourcePayments);
    expect(claim).toContain('const requiresCheckout = totalPrice > 0');
    expect(claim.slice(paymentStart, sourcePayments)).toContain(
      'yield* tx.insert(transactions)',
    );
    expect(claim.slice(paymentStart, sourcePayments)).toContain(
      "_tag: 'PaymentPending'",
    );
    expect(claim.slice(paymentStart, sourcePayments)).not.toContain(
      '.update(eventRegistrations)',
    );
    expect(claim.slice(sourcePayments, ownerUpdate)).toContain(
      '.from(registrationAcquisitionPayments)',
    );
    expect(claim.slice(sourcePayments, ownerUpdate)).toContain(
      '.from(registrationTransferRefundPlanItems)',
    );
    const handlerSource = readSource(
      '../effect/rpc/handlers/registration-transfers.handlers.ts',
    );
    const handlerStart = handlerSource.indexOf(
      "'registrationTransfers.claim':",
    );
    const handlerEnd = handlerSource.indexOf(
      "'registrationTransfers.createOffer':",
      handlerStart,
    );
    const handler = handlerSource.slice(handlerStart, handlerEnd);
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handler).toContain('const user = yield* requireTransferUser');
    expect(handler).toContain('claimCode: input.claimCode');
    expect(handler).toContain('tenant: context.tenant');
    expect(handler).toContain('user,');
    const eventsContract = readSource(
      '../../shared/rpc-contracts/app-rpcs/events.rpcs.ts',
    );
    for (const retiredRpc of [
      'events.transferEventRegistration',
      'events.transferMyRegistration',
      'events.findTransferTargets',
      'events.previewEventRegistrationTransfer',
    ]) {
      expect(eventsContract).not.toContain(retiredRpc);
    }
  });

  it('rechecks the locked offer deadline immediately before insert', () => {
    const source = readSource('registration-transfer.service.ts');
    const createOfferStart = source.indexOf(
      "const createOffer = Effect.fn('RegistrationTransferService.createOffer')",
    );
    const createOfferEnd = source.indexOf('const getClaim =', createOfferStart);
    const createOffer = source.slice(createOfferStart, createOfferEnd);
    const registrationLock = createOffer.indexOf('const lockedSources =');
    const termsLock = createOffer.indexOf('const lockedTransferTerms =');
    const deadlineSampleTime = createOffer.indexOf('const mutationNow =');
    const claimPageUrl = createOffer.indexOf('const claimPageUrl =');
    const insertSampleTime = createOffer.indexOf('const offerInsertNow =');
    const transferInsert = createOffer.indexOf(
      '.insert(registrationTransfers)',
    );

    expect(registrationLock).toBeGreaterThanOrEqual(0);
    expect(termsLock).toBeGreaterThan(registrationLock);
    expect(deadlineSampleTime).toBeGreaterThan(termsLock);
    expect(claimPageUrl).toBeGreaterThan(deadlineSampleTime);
    expect(insertSampleTime).toBeGreaterThan(claimPageUrl);
    expect(transferInsert).toBeGreaterThan(insertSampleTime);
    const tenantLock = createOffer.indexOf('.from(tenants)');
    const eventLock = createOffer.indexOf('.from(eventInstances)', tenantLock);
    expect(tenantLock).toBeGreaterThan(registrationLock);
    expect(eventLock).toBeGreaterThan(tenantLock);
    expect(termsLock).toBeGreaterThan(eventLock);
    expect(createOffer.slice(tenantLock, eventLock)).toContain(
      ".for('update')",
    );
    expect(createOffer.slice(eventLock, termsLock)).toContain(".for('share')");
    expect(createOffer.slice(termsLock, deadlineSampleTime)).toContain(
      ".for('update', { of: eventRegistrationOptions })",
    );
    expect(createOffer).toContain("eventStatus !== 'APPROVED'");
    expect(createOffer).toContain('now: mutationNow');
    expect(createOffer.slice(insertSampleTime, transferInsert)).toContain(
      'lockedExpiresAt <= offerInsertNow',
    );
    expect(createOffer).toContain('expiresAt: lockedExpiresAt');
    expect(createOffer).toContain(
      'expiresAt: transferResult.expiresAt.toISOString()',
    );
  });

  it('rechecks claim expiry at the paid and free mutation boundaries', () => {
    const source = readSource('registration-transfer.service.ts');
    const claimStart = source.indexOf(
      "const claim = Effect.fn('RegistrationTransferService.claim')",
    );
    const claimEnd = source.indexOf(
      'export class RegistrationTransferService',
      claimStart,
    );
    const claim = source.slice(claimStart, claimEnd);
    const registrationLock = claim.indexOf('const lockedSources =');
    const transferLock = claim.indexOf('const lockedTransfers =');
    const initialSampleTime = claim.indexOf('const lockedNow =');
    const currentDeadline = claim.indexOf('const currentExpiresAt =');
    const effectiveDeadline = claim.indexOf('const effectiveExpiresAt =');
    const questionsLock = claim.indexOf(
      'const questionRows = yield* lockEventRegistrationQuestionSet(',
    );
    const answerValidation = claim.indexOf(
      'const answerInserts =',
      effectiveDeadline,
    );
    const discountLock = claim.indexOf('const lockedDiscounts =');
    const paymentMutationTime = claim.indexOf('const paymentMutationNow =');
    const paymentInsert = claim.indexOf(
      'yield* tx.insert(transactions)',
      paymentMutationTime,
    );
    const refundPlanLock = claim.indexOf('const refundPlans =', paymentInsert);
    const priorRefundLock = claim.indexOf(
      'const priorRefunds =',
      refundPlanLock,
    );
    const ownershipMutationTime = claim.indexOf(
      'const ownershipMutationNow =',
      priorRefundLock,
    );
    const ownershipUpdate = claim.indexOf(
      'const transferredRegistrations =',
      ownershipMutationTime,
    );

    expect(registrationLock).toBeGreaterThanOrEqual(0);
    expect(transferLock).toBeGreaterThan(registrationLock);
    expect(initialSampleTime).toBeGreaterThan(transferLock);
    expect(questionsLock).toBeGreaterThan(initialSampleTime);
    expect(currentDeadline).toBeGreaterThan(questionsLock);
    expect(effectiveDeadline).toBeGreaterThan(currentDeadline);
    expect(answerValidation).toBeGreaterThan(effectiveDeadline);
    expect(discountLock).toBeGreaterThan(answerValidation);
    const effectiveDeadlineSource = claim.slice(
      effectiveDeadline,
      answerValidation,
    );
    expect(effectiveDeadlineSource).toContain('Math.min(');
    expect(effectiveDeadlineSource).toContain(
      'lockedTransfer.expiresAt.getTime()',
    );
    expect(effectiveDeadlineSource).toContain('currentExpiresAt.getTime()');
    expect(paymentMutationTime).toBeGreaterThan(discountLock);
    expect(paymentInsert).toBeGreaterThan(paymentMutationTime);
    expect(claim.slice(paymentMutationTime, paymentInsert)).toContain(
      'effectiveExpiresAt <= paymentMutationNow',
    );
    expect(refundPlanLock).toBeGreaterThan(paymentInsert);
    expect(priorRefundLock).toBeGreaterThan(refundPlanLock);
    expect(ownershipMutationTime).toBeGreaterThan(priorRefundLock);
    expect(ownershipUpdate).toBeGreaterThan(ownershipMutationTime);
    expect(claim.slice(priorRefundLock, ownershipMutationTime)).toContain(
      ".for('update')",
    );
    expect(claim.slice(ownershipMutationTime, ownershipUpdate)).toContain(
      'effectiveExpiresAt <= ownershipMutationNow',
    );
    expect(claim).toContain('const completedAt = ownershipMutationNow');
    expect(claim).toContain('lockedTransfer.expiresAt <= lockedNow');
    expect(claim.slice(paymentMutationTime, paymentInsert)).toContain(
      'pinnedNowIso: paymentMutationNow.toISOString()',
    );
    expect(claim).toContain('lockedNow.getTime() +');
  });

  it('preserves interruption during immediate source-refund processing', () => {
    const source = readSource('registration-transfer.service.ts');
    const confirmedStart = source.indexOf("case 'Confirmed':");
    const confirmedEnd = source.indexOf("case 'Ineligible':", confirmedStart);
    const confirmed = source.slice(confirmedStart, confirmedEnd);
    const catchCause = confirmed.indexOf('Effect.catchCause((cause) =>');
    const interruptFilter = confirmed.indexOf('Cause.isInterruptReason');
    const interruptFailure = confirmed.indexOf(
      'Effect.failCause(Cause.fromReasons<never>(interruptReasons))',
    );
    const failureLog = confirmed.indexOf(
      'Registration transfer refund remains queued after immediate processing failed',
    );

    expect(confirmedStart).toBeGreaterThanOrEqual(0);
    expect(confirmedEnd).toBeGreaterThan(confirmedStart);
    expect(catchCause).toBeGreaterThanOrEqual(0);
    expect(interruptFilter).toBeGreaterThan(catchCause);
    expect(interruptFailure).toBeGreaterThan(interruptFilter);
    expect(failureLog).toBeGreaterThan(interruptFailure);
  });
});
