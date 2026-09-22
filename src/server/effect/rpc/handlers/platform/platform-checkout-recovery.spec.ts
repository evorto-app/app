import { describe, expect, it } from '@effect/vitest';
import {
  PlatformFinanceCheckoutRecoveryQueueInput,
  PlatformFinanceRecoverCheckoutInput,
} from '@shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';
import { Schema } from 'effect';

import {
  stripeCheckoutSessionResponse,
  stripeLineItemFixture,
  stripeTaxRateFixture,
} from '../../../../testing/stripe-test-fixtures';
import {
  checkoutRecoveryVersion,
  recoveryLineItemsOwnClaim,
  recoverySessionOwnsClaim,
} from './platform-checkout-recovery';

const createdAt = new Date(1_900_000_000_000);
const snapshot = {
  customerEmail: 'attendee@example.org',
  eventTitle: 'City tour',
  eventUrl: 'https://tenant.example/events/event-1',
  expiresAt: 1_900_003_600,
  lineItems: [
    {
      kind: 'registration',
      name: 'Registration',
      quantity: 1,
      taxRateId: 'txr_fixture_zero',
      unitAmount: 1000,
    },
  ],
  notificationEmail: 'attendee@example.org',
} satisfies Parameters<typeof recoverySessionOwnsClaim>[0]['snapshot'];

const candidate: Parameters<typeof checkoutRecoveryVersion>[0] = {
  attendeeFirstName: 'Ada',
  attendeeLastName: 'Lovelace',
  claim: {
    amount: 1000,
    appFee: 100,
    comment: null,
    createdAt,
    currency: 'EUR',
    eventId: 'event-1',
    eventRegistrationId: 'registration-1',
    executiveUserId: 'user-1',
    id: 'claim-1',
    manuallyCreated: false,
    method: 'stripe',
    refundOperationKey: null,
    sourceTransactionId: null,
    status: 'pending',
    stripeAccountId: 'acct_owned',
    stripeChargeId: null,
    stripeCheckoutCancellationRequestedAt: null,
    stripeCheckoutIncidentSessionId: null,
    stripeCheckoutReconcileAttempts: 0,
    stripeCheckoutReconcileLastError: null,
    stripeCheckoutReconcileLeaseExpiresAt: null,
    stripeCheckoutReconcileLeaseId: null,
    stripeCheckoutReconcileNextAt: null,
    stripeCheckoutRequest: snapshot,
    stripeCheckoutSessionId: null,
    stripeCheckoutUrl: null,
    stripeFee: null,
    stripeNetAmount: null,
    stripePaymentIntentId: null,
    stripeRefundApplicationFee: null,
    stripeRefundAttempts: 0,
    stripeRefundClaimLeaseExpiresAt: null,
    stripeRefundClaimLeaseId: null,
    stripeRefundGeneration: 0,
    stripeRefundHistory: [],
    stripeRefundId: null,
    stripeRefundLastError: null,
    stripeRefundLastRequeueReason: null,
    stripeRefundMaxAttempts: 8,
    stripeRefundNextAttemptAt: null,
    stripeRefundRequeuedAt: null,
    stripeRefundStatus: null,
    targetUserId: 'user-1',
    tenantId: 'tenant-1',
    type: 'registration',
    updatedAt: createdAt,
  },
  eventTitle: 'City tour',
  registration: {
    appliedDiscountedPrice: null,
    appliedDiscountType: null,
    basePriceAtRegistration: 1000,
    checkedInGuestCount: 0,
    checkInTime: null,
    createdAt,
    discountAmount: 0,
    eventId: 'event-1',
    guestCount: 0,
    id: 'registration-1',
    paymentId: null,
    registrationOptionId: 'option-1',
    status: 'PENDING',
    stripeTaxRateId: 'txr_fixture_zero',
    taxRateDisplayName: 'VAT',
    taxRateInclusive: true,
    taxRatePercentage: '0',
    tenantId: 'tenant-1',
    updatedAt: createdAt,
    userId: 'user-1',
  },
  registrationMode: 'fcfs',
  stripeAccountId: 'acct_owned',
};
const claim: Parameters<typeof recoverySessionOwnsClaim>[0] = {
  appFee: 100,
  candidate,
  identity: {
    registrationId: 'registration-1',
    tenantId: 'tenant-1',
    transactionId: 'claim-1',
    userId: 'user-1',
  },
  snapshot,
  stripeAccountId: 'acct_owned',
};
const session = stripeCheckoutSessionResponse({
  amount_subtotal: 1000,
  amount_total: 1000,
  cancel_url: `${snapshot.eventUrl}?registrationStatus=cancel`,
  created: 1_900_000_000,
  customer_email: snapshot.customerEmail,
  expires_at: snapshot.expiresAt,
  metadata: claim.identity,
  payment_intent: null,
  payment_status: 'unpaid',
  status: 'open',
  success_url: `${snapshot.eventUrl}?registrationStatus=success`,
});

describe('existing Checkout recovery validation', () => {
  it('requires an exact original session and does not treat a matching amount as ownership', () => {
    expect(recoverySessionOwnsClaim(claim, session)).toBe(true);
    for (const overrides of [
      { amount_total: 999 },
      { currency: 'usd' },
      { customer_email: 'other@example.org' },
      { expires_at: snapshot.expiresAt + 1 },
      { success_url: 'https://other.example' },
      { cancel_url: 'https://other.example' },
      { url: 'https://other.example/pay' },
      { metadata: { ...claim.identity, userId: 'other-user' } },
      { metadata: { ...claim.identity, transferId: 'transfer-1' } },
      { created: 1_899_000_000 },
    ])
      expect(
        recoverySessionOwnsClaim(claim, { ...session, ...overrides }),
      ).toBe(false);
  });

  it('checks quantities, item prices and exact inclusive tax identities including zero-percent tax', () => {
    const line = stripeLineItemFixture();
    expect(recoveryLineItemsOwnClaim(claim, [line])).toBe(true);
    expect(recoveryLineItemsOwnClaim(claim, [])).toBe(false);
    expect(recoveryLineItemsOwnClaim(claim, [line, line])).toBe(false);
    for (const changed of [
      stripeLineItemFixture({ quantity: 2 }),
      stripeLineItemFixture({ amount_total: 999 }),
      stripeLineItemFixture({ description: 'Other purchase' }),
      stripeLineItemFixture({ amount_discount: 100 }),
      stripeLineItemFixture({ taxes: [] }),
      stripeLineItemFixture({
        taxes: [
          {
            amount: 0,
            rate: stripeTaxRateFixture({ id: 'txr_other' }),
            taxability_reason: null,
            taxable_amount: 1000,
          },
        ],
      }),
      stripeLineItemFixture({
        taxes: [
          {
            amount: 0,
            rate: stripeTaxRateFixture({ inclusive: false }),
            taxability_reason: null,
            taxable_amount: 1000,
          },
        ],
      }),
    ])
      expect(recoveryLineItemsOwnClaim(claim, [changed])).toBe(false);
  });

  it('changes the reviewed version when payment ownership, held registration or approval mode changes', () => {
    const original = checkoutRecoveryVersion(candidate);
    expect(original).toMatch(/^[a-f0-9]{64}$/u);
    for (const changed of [
      { ...candidate, claim: { ...candidate.claim, appFee: 200 } },
      {
        ...candidate,
        claim: {
          ...candidate.claim,
          stripeCheckoutIncidentSessionId: 'cs_other',
        },
      },
      {
        ...candidate,
        registration: { ...candidate.registration, guestCount: 1 },
      },
      { ...candidate, stripeAccountId: 'acct_other' },
    ])
      expect(checkoutRecoveryVersion(changed)).not.toBe(original);
    expect(
      checkoutRecoveryVersion({
        ...candidate,
        registrationMode: 'application',
      }),
    ).not.toBe(original);
  });

  it('validates the target, reviewed version, bounded page and operational reason at the RPC boundary', () => {
    const valid = {
      claimId: 'claim-1',
      expectedVersion: checkoutRecoveryVersion(candidate),
      reason: 'Restore original payment',
      targetTenantId: 'tenant-1',
    };
    expect(
      Schema.decodeUnknownSync(PlatformFinanceRecoverCheckoutInput)(valid),
    ).toEqual(valid);
    for (const invalid of [
      { ...valid, reason: ' ' },
      { ...valid, reason: 'Use acct_private for this' },
      { ...valid, expectedVersion: '' },
      { ...valid, expectedVersion: 'x'.repeat(64) },
      { ...valid, targetTenantId: '' },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(PlatformFinanceRecoverCheckoutInput)(invalid),
      ).toThrow();
    }
    for (const limit of [0, 101])
      expect(() =>
        Schema.decodeUnknownSync(PlatformFinanceCheckoutRecoveryQueueInput)({
          limit,
          offset: 0,
          targetTenantId: 'tenant-1',
        }),
      ).toThrow();
  });
});
