import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSiblingSource = (fileName: string): string =>
  readFileSync(new URL(fileName, import.meta.url), 'utf8');

describe('registration transfer transactional finalization source', () => {
  it('reassigns the sealed registration bundle in place without changing capacity or fulfillment', () => {
    const source = readSiblingSource('./registration-transfer-finalization.ts');
    const finalization = source.slice(
      source.indexOf('export const finalizeRegistrationTransferCheckout'),
      source.indexOf('export const expireRegistrationTransferCheckout'),
    );

    expect(finalization).toContain(
      'transfer.recipientRegistrationId !== transfer.sourceRegistrationId',
    );
    expect(finalization).toContain(
      '.from(registrationTransferBundleAddonPurchases)',
    );
    expect(finalization).toContain(
      '.from(registrationTransferBundleAddonPurchaseLots)',
    );
    expect(finalization).toContain('.from(eventRegistrationAddonPurchases)');
    expect(finalization).toContain('bundleSnapshotMatches(snapshot, current)');
    expect(finalization).toContain('.update(eventRegistrations)');
    expect(finalization).toContain('userId: transfer.recipientUserId');
    expect(finalization).toContain(
      'eq(eventRegistrations.id, transfer.sourceRegistrationId)',
    );
    expect(finalization).not.toContain('.insert(eventRegistrations)');
    expect(finalization).not.toContain('.update(eventRegistrationOptions)');
    expect(finalization).not.toContain(
      '.update(eventRegistrationAddonPurchases)',
    );
    expect(finalization).not.toContain('.update(eventAddons)');
    expect(finalization).not.toContain(".set({ status: 'CANCELLED' })");
    expect(finalization).not.toContain(".set({ status: 'PENDING' })");
  });

  it('establishes one fully settled recipient acquisition from exact positive Checkout lines', () => {
    const source = readSiblingSource('./registration-transfer-finalization.ts');
    const finalization = source.slice(
      source.indexOf('export const finalizeRegistrationTransferCheckout'),
      source.indexOf('export const expireRegistrationTransferCheckout'),
    );

    expect(finalization).toContain('checkoutBaseAmount !== payment.amount');
    expect(finalization).toContain("line.kind !== 'addon'");
    expect(finalization).toContain('registrationTransferAddonAllocationKey(');
    expect(finalization).toContain(
      'const componentTerms: AcquisitionComponentTerm[] = []',
    );
    expect(finalization).toContain("allocationKey: 'registration'");
    expect(finalization).toContain("kind: 'registration'");
    expect(finalization).toContain('allocationKey: `addon-lot:${lot.id}`');
    expect(finalization).toContain("kind: 'addon_lot'");
    expect(finalization).toContain(
      'const settledTerms = settleAcquisitionComponentTerms({',
    );
    expect(finalization).toContain('stripeNetAmount: payment.stripeNetAmount');
    expect(finalization).toContain(
      'yield* establishRegistrationAcquisition(tx, {',
    );
    expect(finalization).toContain('components: settledTerms');
    expect(finalization).toContain("kind: 'claim_transfer'");
    expect(finalization).toContain(
      'operationKey: `registration-transfer:${transfer.id}`',
    );
    expect(finalization).toContain('ownerUserId: recipientUserId');
    expect(finalization).toContain('stripeAccountId: payment.stripeAccountId');
    expect(finalization).toContain('stripeChargeId: payment.stripeChargeId');
    expect(finalization).toContain(
      'stripePaymentIntentId: payment.stripePaymentIntentId',
    );
    expect(finalization).toContain('transactionId: input.transactionId');
    expect(finalization).toContain('transferId: transfer.id');
    expect(finalization).toContain('registrationId: recipientRegistrationId');
    expect(finalization).toContain(
      'Effect.catch((error) => Effect.die(error))',
    );
    expect(finalization).not.toContain(
      'Recipient acquisition could not be established: ${error.message}',
    );
    expect(finalization).not.toContain(
      'registrationTransferRecipientAddonPayments',
    );
    expect(finalization).not.toContain(
      'registrationTransferRecipientAddonRefundAllocations',
    );
    expect(finalization).not.toContain(
      '.update(eventRegistrationAddonPurchaseLots)',
    );
  });

  it('creates and attaches one exact source refund claim per positive plan item', () => {
    const source = readSiblingSource('./registration-transfer-finalization.ts');
    const finalization = source.slice(
      source.indexOf('export const finalizeRegistrationTransferCheckout'),
      source.indexOf('export const expireRegistrationTransferCheckout'),
    );

    expect(finalization).toContain(
      '.from(registrationTransferRefundPlanItems)',
    );
    expect(finalization).toContain('for (const plan of refundPlans)');
    expect(finalization).toContain('if (plan.refundAmountDue === 0) continue');
    expect(finalization).toContain('amount: plan.refundAmountDue');
    expect(finalization).toContain(
      'sourceTransactionId: plan.sourceTransactionId',
    );
    expect(finalization).toContain(
      '.update(registrationTransferRefundPlanItems)',
    );
    expect(finalization).toContain(
      '.set({ refundTransactionId: refundClaim.id })',
    );
    expect(finalization).toContain(
      "refundClaimIds.length > 0 ? 'refund_pending' : 'completed'",
    );
  });

  it('locks every current acquisition payment and requires exact refund-plan coverage before ownership changes', () => {
    const source = readSiblingSource('./registration-transfer-finalization.ts');
    const finalization = source.slice(
      source.indexOf('export const finalizeRegistrationTransferCheckout'),
      source.indexOf('export const expireRegistrationTransferCheckout'),
    );
    const coverageCheck = finalization.indexOf(
      'refundPlansExactlyCoverCurrentAcquisitionPayments({',
    );
    const ownershipUpdate = finalization.indexOf('.update(eventRegistrations)');

    expect(finalization).toContain('.from(registrationAcquisitionPayments)');
    expect(finalization).toContain(
      'registrationAcquisitionPayments.acquisitionId',
    );
    expect(finalization).toContain('currentAcquisition.id');
    expect(finalization).toContain(
      '.orderBy(registrationAcquisitionPayments.transactionId)',
    );
    expect(finalization).toContain(".for('update')");
    expect(finalization).toContain(
      'currentPayments: currentAcquisitionPayments',
    );
    expect(finalization).toContain(
      'The source refund plan does not exactly cover the current acquisition payments',
    );
    expect(coverageCheck).toBeGreaterThan(-1);
    expect(ownershipUpdate).toBeGreaterThan(coverageCheck);
  });

  it('compensates the recipient without touching the source bundle', () => {
    const source = readSiblingSource('./registration-transfer-finalization.ts');
    const compensation = source.slice(
      source.indexOf('const compensateRegistrationTransferRecipient'),
      source.indexOf('const bundleSnapshotMatches'),
    );

    expect(compensation).toContain('amount: input.payment.amount');
    expect(compensation).toContain('applicationFeeRefunded: true');
    expect(compensation).toContain(
      'compensationRefundTransactionId: compensationClaim.id',
    );
    expect(compensation).toContain("status: 'compensation_pending'");
    expect(compensation).toContain("eventType: 'compensation_queued'");
    expect(compensation).not.toContain('.update(eventRegistrations)');
    expect(compensation).not.toContain('.update(eventRegistrationOptions)');
    expect(compensation).not.toContain(
      '.update(eventRegistrationAddonPurchases)',
    );
    expect(compensation).not.toContain('.update(eventAddons)');
  });

  it('expires only the recipient payment attempt and keeps reconciliation cycle-free', () => {
    const finalization = readSiblingSource(
      './registration-transfer-finalization.ts',
    );
    const reconciliation = readSiblingSource(
      './registration-transfer-refund-reconciliation.ts',
    );
    const expiry = finalization.slice(
      finalization.indexOf('export const expireRegistrationTransferCheckout'),
    );

    expect(expiry).toContain('.update(transactions)');
    expect(expiry).toContain("status: 'cancelled'");
    expect(expiry).toContain(
      'transfer.recipientRegistrationId !== transfer.sourceRegistrationId',
    );
    expect(expiry).toContain("status: 'expired'");
    expect(expiry).not.toContain('.update(eventRegistrations)');
    expect(expiry).not.toContain('.update(eventRegistrationOptions)');
    expect(expiry).not.toContain('.update(eventRegistrationAddonPurchases)');
    expect(expiry).not.toContain('.update(eventAddons)');
    expect(reconciliation).toContain('registrationTransferRefundPlanItems');
    expect(reconciliation).toContain('compensationRefundTransactionId');
    expect(reconciliation).not.toContain('registration-refund');
  });

  it('keeps webhook and refund reconciliation ordering durable', () => {
    const webhook = readSiblingSource('../http/stripe-webhook.web-handler.ts');
    const completion = readSiblingSource(
      './registration-checkout-completion.ts',
    );
    const refund = readSiblingSource('../payments/registration-refund.ts');
    const completionCase = webhook.slice(
      webhook.indexOf("case 'checkout.session.completed'"),
      webhook.indexOf("case 'checkout.session.expired'"),
    );
    const completionTransaction = completion.slice(
      completion.indexOf('export const completePaidRegistrationCheckout'),
    );
    const successfulTransaction = completionTransaction.indexOf(
      "status: 'successful'",
    );
    const transferFinalization = completionTransaction.indexOf(
      'finalizeRegistrationTransferCheckout',
    );
    const genericConfirmation = completionTransaction.indexOf(
      ".set({ status: 'CONFIRMED' })",
    );
    const expiry = webhook.slice(
      webhook.indexOf("case 'checkout.session.expired'"),
    );
    const transferExpiry = expiry.indexOf('expireRegistrationTransferCheckout');
    const genericCancellationTransition = expiry.indexOf(
      'yield* runCheckoutWebhookTransition',
      transferExpiry,
    );
    const genericCancellation = expiry.indexOf(
      "status: 'cancelled'",
      genericCancellationTransition,
    );
    const claimedRefund = refund.slice(
      refund.indexOf('const updatedClaims = yield* tx'),
    );

    expect(completionCase).toContain('completePaidRegistrationCheckout');
    expect(successfulTransaction).toBeGreaterThan(-1);
    expect(transferFinalization).toBeGreaterThan(successfulTransaction);
    expect(genericConfirmation).toBeGreaterThan(transferFinalization);
    expect(transferExpiry).toBeGreaterThan(-1);
    expect(genericCancellationTransition).toBeGreaterThan(transferExpiry);
    expect(genericCancellation).toBeGreaterThan(genericCancellationTransition);
    expect(
      claimedRefund.indexOf('reconcileRegistrationTransferRefund'),
    ).toBeGreaterThan(claimedRefund.indexOf('registrationRefundStatusUpdate('));
  });

  it('uses each persisted source account even after the tenant account rotates', () => {
    const refund = readSiblingSource('../payments/registration-refund.ts');
    const createClaim = refund.slice(
      refund.indexOf('export const createRegistrationRefundClaim'),
      refund.indexOf('export interface RequeueRegistrationRefundClaimInput'),
    );
    const requeue = refund.slice(
      refund.indexOf('export const requeueRegistrationRefundClaim'),
      refund.indexOf('const claimRegistrationRefund'),
    );

    expect(createClaim).toContain(
      'sourceTransaction.stripeAccountId !== input.stripeAccountId',
    );
    expect(createClaim).not.toContain('lockTenantStripeAccount');
    expect(requeue).not.toContain('lockTenantStripeAccount');
  });
});

describe('registration transfer claim lock source', () => {
  it('projects every tenant-scoped refund plan without exposing provider details', () => {
    const service = readSiblingSource('./registration-transfer.service.ts');
    const eventHandlers = readSiblingSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    const getClaim = service.slice(
      service.indexOf('const getClaim = Effect.fn'),
      service.indexOf('const cancel = Effect.fn'),
    );
    const activeTransfers = eventHandlers.slice(
      eventHandlers.indexOf('const activeTransfers ='),
      eventHandlers.indexOf('const addOnOptionsByRegistrationOptionId'),
    );

    expect(getClaim).toContain('eq(registrationTransfers.tenantId, tenant.id)');
    expect(getClaim).toContain('transfer.recipientUserId !== user.id');
    expect(getClaim).toContain('.from(registrationTransferRefundPlanItems)');
    expect(getClaim).toContain('transactions.tenantId');
    expect(getClaim).toContain('registrationTransferRefundPlanItems.tenantId');
    expect(activeTransfers).toContain(
      'eq(registrationTransfers.tenantId, tenant.id)',
    );
    expect(activeTransfers).toContain(
      '.from(registrationTransferRefundPlanItems)',
    );
    expect(activeTransfers).toContain(
      'resolveRegistrationTransferRefundLifecycle({',
    );
    expect(getClaim).not.toContain('stripeRefundLastError');
    expect(activeTransfers).not.toContain('stripeRefundLastError');
  });

  it('revalidates identity, eligibility, sealed fulfillment, current prices, discounts, and tax under locks', () => {
    const source = readSiblingSource('./registration-transfer.service.ts');
    const lockedClaim = source.slice(
      source.indexOf('const claimResult = yield* Database.use'),
      source.indexOf('switch (claimResult._tag)'),
    );

    expect(lockedClaim).toContain('const lockedSources');
    expect(lockedClaim).toContain('const lockedTransfers');
    expect(lockedClaim).toContain(
      '.from(registrationTransferBundleAddonPurchases)',
    );
    expect(lockedClaim).toContain('.from(eventRegistrationAddonPurchases)');
    expect(lockedClaim).toContain('snapshot.redeemedQuantity !==');
    expect(lockedClaim).toContain('snapshot.cancelledQuantity !==');
    expect(lockedClaim).toContain('eventRegistrationQuestions.required');
    expect(lockedClaim).toContain('isUserEligibleForRegistrationOption({');
    expect(lockedClaim).toContain('eventAddons.price');
    expect(lockedClaim).toContain(
      'eventRegistrationOptionDiscounts.discountedPrice',
    );
    expect(lockedClaim).toContain('tenantStripeTaxRates.stripeTaxRateId');
    expect(lockedClaim).toContain('addOn.price * addOn.purchasedQuantity');
    expect(lockedClaim).toContain(".for('update')");
  });

  it('keeps notification-only global user rows outside tenant locks', () => {
    const service = readSiblingSource('./registration-transfer.service.ts');
    const finalization = readSiblingSource(
      './registration-transfer-finalization.ts',
    );
    const claim = service.slice(
      service.indexOf('const claimResult = yield* Database.use'),
      service.indexOf('switch (claimResult._tag)'),
    );
    const recipientUserQuery = claim.slice(
      claim.indexOf('const recipientUsers'),
      claim.indexOf('const lockedRoleAssignments'),
    );
    const sourceUserQuery = claim.slice(
      claim.indexOf('const sourceUsers'),
      claim.indexOf('const sourceUser ='),
    );
    const finalizationUserQuery = finalization.slice(
      finalization.indexOf('const ownerRows'),
      finalization.indexOf('const event ='),
    );

    expect(recipientUserQuery).toContain('.from(users)');
    expect(recipientUserQuery).not.toContain(".for('update')");
    expect(sourceUserQuery).toContain('.from(users)');
    expect(sourceUserQuery).not.toContain(".for('update')");
    expect(finalizationUserQuery).toContain('.from(users)');
    expect(finalizationUserQuery).not.toContain(".for('update')");
  });

  it('cancels only the transfer-bound payment while preserving the source bundle', () => {
    const source = readSiblingSource('./registration-transfer.service.ts');
    const cancellation = source.slice(
      source.indexOf(
        "const cancel = Effect.fn('RegistrationTransferService.cancel')",
      ),
      source.indexOf(
        "const claim = Effect.fn('RegistrationTransferService.claim')",
      ),
    );
    const retry = source.slice(
      source.indexOf('const retryCheckout = Effect.fn'),
    );

    expect(cancellation).toContain(
      'eq(registrationTransfers.sourceUserId, user.id)',
    );
    expect(cancellation).toContain(
      'eq(registrationTransfers.recipientUserId, user.id)',
    );
    expect(cancellation).toContain(
      'locked.recipientRegistrationId !== locked.sourceRegistrationId',
    );
    expect(cancellation).toContain('.update(transactions)');
    expect(cancellation).not.toContain('.update(eventRegistrations)');
    expect(cancellation).not.toContain('.update(eventRegistrationOptions)');
    expect(cancellation).not.toContain(
      '.update(eventRegistrationAddonPurchases)',
    );
    expect(cancellation).not.toContain('.update(eventAddons)');
    expect(retry).toContain('retrieveHostedCheckoutSession(');
    expect(retry).toContain('completePaidRegistrationCheckout(');
    expect(retry).toContain('expireRegistrationTransferCheckout(');
  });

  it('uses deterministic locks before offer or claim writes', () => {
    const service = readSiblingSource('./registration-transfer.service.ts');
    const createOffer = service.slice(
      service.indexOf(
        "const createOffer = Effect.fn('RegistrationTransferService.createOffer')",
      ),
      service.indexOf('const getClaim = Effect.fn'),
    );
    const claim = service.slice(
      service.indexOf('const claimResult = yield* Database.use'),
      service.indexOf('switch (claimResult._tag)'),
    );

    expect(createOffer.indexOf('const lockedSources')).toBeGreaterThan(-1);
    expect(createOffer.indexOf('const lockedTenants')).toBeGreaterThan(
      createOffer.indexOf('const lockedSources'),
    );
    expect(
      createOffer.indexOf('.insert(registrationTransfers)'),
    ).toBeGreaterThan(createOffer.indexOf('const lockedTenants'));
    expect(claim.indexOf('const lockedSources')).toBeGreaterThan(-1);
    expect(claim.indexOf('const lockedTransfers')).toBeGreaterThan(
      claim.indexOf('const lockedSources'),
    );
    expect(claim.indexOf('const bundleSnapshots')).toBeGreaterThan(
      claim.indexOf('const lockedTransfers'),
    );
  });

  it('builds transfer claim and event links from the normalized tenant domain', () => {
    const service = readSiblingSource('./registration-transfer.service.ts');
    const createOffer = service.slice(
      service.indexOf(
        "const createOffer = Effect.fn('RegistrationTransferService.createOffer')",
      ),
      service.indexOf('const getClaim = Effect.fn'),
    );
    const lockedClaim = service.slice(
      service.indexOf('const claimResult = yield* Database.use'),
      service.indexOf('switch (claimResult._tag)'),
    );

    expect(service).toContain(
      "import { tenantOutboundUrl } from '../tenant-outbound-url'",
    );
    expect(service).not.toContain('canonicalRootUrl');
    expect(service).not.toContain('transferBaseUrl');
    expect(createOffer).toContain('yield* tenantOutboundUrl(');
    expect(createOffer).toContain(
      '`/registration-transfers/${encodeURIComponent(credentials.claimToken)}`',
    );
    expect(lockedClaim).toContain('domain: tenants.domain');
    expect(lockedClaim).toContain('yield* tenantOutboundUrl(');
    expect(lockedClaim).toContain(
      '`/events/${encodeURIComponent(transfer.eventId)}`',
    );
  });
});
