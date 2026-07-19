import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('post-registration add-on mutation guards', () => {
  it('keeps caller-controlled clock overrides out of the public purchase service', () => {
    const source = readSource('addon-purchase.service.ts');

    expect(source).not.toContain('pinnedNowIso');
    expect(source).toContain('getServerNow(undefined)');
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

  it('uses the deterministic registration handler clock for owner add-on availability', () => {
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

  it('blocks direct ownership transfer before changing the registration user', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    const directTransfer = source.indexOf('const transferResult =');
    const acquisitionLock = source.indexOf(
      'lockCurrentRegistrationAcquisition(tx, {',
      directTransfer,
    );
    const pendingOrder = source.indexOf(
      'const pendingAddonOrderCandidates =',
      directTransfer,
    );
    const pendingTransactionLock = source.indexOf(
      'const pendingAddonTransactions =',
      pendingOrder,
    );
    const pendingOrderLock = source.indexOf(
      'const lockedAddonOrders =',
      pendingTransactionLock,
    );
    const sourcePaymentLock = source.indexOf(
      'const successfulPaidSourceTransactions =',
      pendingOrderLock,
    );
    const ownerUpdate = source.indexOf(
      'const transferredRegistrations =',
      sourcePaymentLock,
    );

    expect(directTransfer).toBeGreaterThanOrEqual(0);
    expect(acquisitionLock).toBeGreaterThan(directTransfer);
    expect(pendingOrder).toBeGreaterThan(acquisitionLock);
    expect(pendingTransactionLock).toBeGreaterThan(pendingOrder);
    expect(pendingOrderLock).toBeGreaterThan(pendingTransactionLock);
    expect(sourcePaymentLock).toBeGreaterThan(pendingOrderLock);
    expect(ownerUpdate).toBeGreaterThan(sourcePaymentLock);
    expect(source.slice(sourcePaymentLock, ownerUpdate)).toContain(
      'sourceRefundAmountDue > 0 || recipientBundlePrice > 0',
    );
  });

  it('routes any currently paid acquisition or recipient bundle through a private offer', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );

    expect(source).toContain('currentAcquisitionState.payments');
    expect(source).toContain('successfulPaidSourceTransactions');
    expect(source).toContain(
      'sourceRefundAmountDue > 0 || recipientBundlePrice > 0',
    );
    expect(source).toContain('privateRegistrationTransferRequiredMessage');
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
    const claimUrl = createOffer.indexOf('const claimUrl =');
    const insertSampleTime = createOffer.indexOf('const offerInsertNow =');
    const transferInsert = createOffer.indexOf(
      '.insert(registrationTransfers)',
    );

    expect(registrationLock).toBeGreaterThanOrEqual(0);
    expect(termsLock).toBeGreaterThan(registrationLock);
    expect(deadlineSampleTime).toBeGreaterThan(termsLock);
    expect(claimUrl).toBeGreaterThan(deadlineSampleTime);
    expect(insertSampleTime).toBeGreaterThan(claimUrl);
    expect(transferInsert).toBeGreaterThan(insertSampleTime);
    expect(createOffer.slice(termsLock, deadlineSampleTime)).toContain(
      ".for('update')",
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
    expect(discountLock).toBeGreaterThan(initialSampleTime);
    expect(paymentMutationTime).toBeGreaterThan(discountLock);
    expect(paymentInsert).toBeGreaterThan(paymentMutationTime);
    expect(claim.slice(paymentMutationTime, paymentInsert)).toContain(
      'lockedTransfer.expiresAt <= paymentMutationNow',
    );
    expect(refundPlanLock).toBeGreaterThan(paymentInsert);
    expect(priorRefundLock).toBeGreaterThan(refundPlanLock);
    expect(ownershipMutationTime).toBeGreaterThan(priorRefundLock);
    expect(ownershipUpdate).toBeGreaterThan(ownershipMutationTime);
    expect(claim.slice(priorRefundLock, ownershipMutationTime)).toContain(
      ".for('update')",
    );
    expect(claim.slice(ownershipMutationTime, ownershipUpdate)).toContain(
      'lockedTransfer.expiresAt <= ownershipMutationNow',
    );
    expect(claim).toContain('const completedAt = ownershipMutationNow');
    expect(claim).toContain('lockedTransfer.expiresAt <= lockedNow');
    expect(claim).toContain('pinnedNowIso: lockedNow.toISOString()');
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
