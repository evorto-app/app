import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSiblingSource = (fileName: string): string =>
  readFileSync(new URL(fileName, import.meta.url), 'utf8');

describe('registration transfer transactional finalization source', () => {
  it('owns only the transfer capacity delta and keeps recipient confirmation before source cancellation', () => {
    const source = readSiblingSource('./registration-transfer-finalization.ts');
    const finalization = source.slice(
      source.indexOf('export const finalizeRegistrationTransferCheckout'),
      source.indexOf('export const expireRegistrationTransferCheckout'),
    );
    const confirmation = finalization.indexOf(".set({ status: 'CONFIRMED' })");
    const sourceCancellation = finalization.indexOf(
      ".set({ status: 'CANCELLED' })",
    );

    expect(finalization).toContain(
      'confirmedSpots: sql`${eventRegistrationOptions.confirmedSpots} + ${transfer.recipientSpotCount} - ${transfer.sourceSpotCount}`',
    );
    expect(finalization).toContain(
      'reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${transfer.reservedAdditionalSpots}`',
    );
    expect(finalization).not.toContain('registrationSpotCount(');
    expect(finalization).toContain('source.checkInTime !== null');
    expect(finalization).toContain('source.checkedInGuestCount !== 0');
    expect(confirmation).toBeGreaterThan(-1);
    expect(sourceCancellation).toBeGreaterThan(confirmation);
  });

  it('compensates a paid recipient with one full application-fee refund and one transfer-owned delta release', () => {
    const source = readSiblingSource('./registration-transfer-finalization.ts');
    const compensation = source.slice(
      source.indexOf('const compensateRegistrationTransferRecipient'),
      source.indexOf('export const finalizeRegistrationTransferCheckout'),
    );

    expect(compensation).toContain('amount: input.payment.amount');
    expect(compensation).toContain('applicationFeeRefunded: true');
    expect(compensation).toContain("status: 'compensation_pending'");
    expect(compensation).toContain("eventType: 'compensation_queued'");
    expect(compensation).toContain("eventType: 'recipient_cancelled'");
    expect(
      compensation.match(
        /reservedSpots: sql`\$\{eventRegistrationOptions\.reservedSpots\} - \$\{input\.transfer\.reservedAdditionalSpots\}`/g,
      ),
    ).toHaveLength(1);
  });

  it('keeps checkout expiry source-safe and refund reconciliation cycle-free', () => {
    const finalization = readSiblingSource(
      './registration-transfer-finalization.ts',
    );
    const reconciliation = readSiblingSource(
      './registration-transfer-refund-reconciliation.ts',
    );
    const expiry = finalization.slice(
      finalization.indexOf('export const expireRegistrationTransferCheckout'),
    );

    expect(expiry).toContain(".set({ status: 'CANCELLED' })");
    expect(expiry).toContain('reservedAdditionalSpots');
    expect(expiry).toContain("status: 'expired'");
    expect(expiry).not.toContain('sourceRegistrationId');
    expect(reconciliation).toContain("'compensation_failed'");
    expect(reconciliation).toContain("'compensated'");
    expect(reconciliation).toContain("'refund_failed'");
    expect(reconciliation).toContain("'completed'");
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
    ).toBeGreaterThan(claimedRefund.indexOf('.set(refundStatusUpdate'));
  });
});

describe('registration transfer claim lock source', () => {
  it('revalidates account, currency, eligibility, pricing, tax, questions, and add-ons under locks', () => {
    const source = readSiblingSource('./registration-transfer.service.ts');
    const transactionStart = source.indexOf(
      'const claimResult = yield* Database.use',
    );
    const lockedClaim = source.slice(transactionStart);

    expect(lockedClaim).toContain('lockTenantStripeAccount(');
    expect(lockedClaim).toContain('currency: tenants.currency');
    expect(lockedClaim).toContain('rolesToTenantUsers.roleId');
    expect(lockedClaim).toContain(".for('update')");
    expect(lockedClaim).toContain('eventRegistrationQuestions.required');
    expect(lockedClaim).toContain(
      'addonToEventRegistrationOptions.includedQuantity',
    );
    expect(lockedClaim).toContain(
      'addonToEventRegistrationOptions.optionalPurchaseQuantity',
    );
    expect(lockedClaim).toContain(
      'eventAddons.allowPurchaseDuringRegistration',
    );
    expect(lockedClaim).toContain('addOn.selectedQuantity');
    expect(lockedClaim).toContain('addOn.fulfilledQuantity');
    expect(lockedClaim).toContain(
      'eventRegistrationOptionDiscounts.discountedPrice',
    );
    expect(lockedClaim).toContain('tenantStripeTaxRates.stripeTaxRateId');
    expect(lockedClaim).toContain(
      'appliedDiscountType: discountResolution.appliedDiscountType',
    );
    expect(lockedClaim).toContain('currency: paymentClaim.currency');
  });

  it('reconciles persisted Checkout status and authorizes only transfer-bound cancellation', () => {
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
    expect(cancellation).toContain('locked.reservedAdditionalSpots');
    expect(cancellation).not.toContain('registrationSpotCount(');
    expect(retry).toContain('retrieveHostedCheckoutSession(');
    expect(retry).toContain('row.stripeAccountId');
    expect(retry).toContain("checkoutSession.status === 'open'");
    expect(retry).toContain('completePaidRegistrationCheckout(');
    expect(retry).toContain('expireRegistrationTransferCheckout(');
  });

  it('uses registration-first lock ordering for offer creation, claim, and expiry', () => {
    const service = readSiblingSource('./registration-transfer.service.ts');
    const finalization = readSiblingSource(
      './registration-transfer-finalization.ts',
    );
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
    const expiry = finalization.slice(
      finalization.indexOf('export const expireRegistrationTransferCheckout'),
    );

    expect(createOffer.indexOf('const lockedSources')).toBeGreaterThan(-1);
    expect(createOffer.indexOf('const lockedTenants')).toBeGreaterThan(
      createOffer.indexOf('const lockedSources'),
    );
    expect(createOffer.indexOf('yield* tenantOutboundUrl(')).toBeGreaterThan(
      createOffer.indexOf('const lockedTenants'),
    );
    expect(
      createOffer.indexOf('.insert(registrationTransfers)'),
    ).toBeGreaterThan(createOffer.indexOf('yield* tenantOutboundUrl('));
    expect(claim.indexOf('const lockedSources')).toBeGreaterThan(-1);
    expect(claim.indexOf('const lockedTransfers')).toBeGreaterThan(
      claim.indexOf('const lockedSources'),
    );
    expect(expiry.indexOf('const recipientRows')).toBeGreaterThan(-1);
    expect(expiry.indexOf('const paymentRows')).toBeGreaterThan(
      expiry.indexOf('const recipientRows'),
    );
    expect(expiry.indexOf('const transferRows')).toBeGreaterThan(
      expiry.indexOf('const paymentRows'),
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
    const lockedTenantQuery = createOffer.slice(
      createOffer.indexOf('const lockedTenants'),
      createOffer.indexOf('const lockedTenant ='),
    );

    expect(service).toContain(
      "import { tenantOutboundUrl } from '../tenant-outbound-url'",
    );
    expect(service).toContain("| 'domain'");
    expect(service).not.toContain('canonicalRootUrl');
    expect(service).not.toContain('transferBaseUrl');
    expect(service).not.toContain('serverConfig');
    expect(createOffer).toContain('yield* tenantOutboundUrl(');
    expect(createOffer).toContain('domain: tenants.domain');
    expect(createOffer).toContain('lockedTenant,');
    expect(lockedTenantQuery).toContain(".for('update')");
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
