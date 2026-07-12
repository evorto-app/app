import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { RegistrationTransfersRpcError } from './registration-transfers.errors';
import {
  RegistrationTransferClaimInput,
  RegistrationTransferClaimRecord,
  RegistrationTransferClaimResult,
  RegistrationTransferCredential,
  RegistrationTransferOfferResult,
  RegistrationTransferRetryCheckoutResult,
  RegistrationTransfersClaim,
  RegistrationTransfersCreateOffer,
  RegistrationTransfersGetClaim,
  RegistrationTransfersRetryCheckout,
} from './registration-transfers.rpcs';

const validClaimRecord = {
  bundle: {
    addOns: [
      {
        cancelledQuantity: 1,
        currentUnitPrice: 500,
        description: 'Includes equipment rental.',
        id: 'addon-1',
        includedQuantity: 1,
        purchasedQuantity: 3,
        quantity: 4,
        redeemedQuantity: 1,
        remainingQuantity: 2,
        title: 'Workshop kit',
      },
    ],
    checkedInGuestCount: 1,
    checkInTime: '2026-08-20T18:15:00.000Z',
    guestCount: 1,
    guestUnitPrice: 3000,
  },
  event: {
    end: '2026-08-20T22:00:00.000Z',
    id: 'event-1',
    start: '2026-08-20T18:00:00.000Z',
    title: 'Welcome event',
  },
  expiresAt: '2026-08-20T18:00:00.000Z',
  refundLifecycle: null,
  registrationOption: {
    currency: 'EUR',
    currentPrice: 2500,
    description: 'Participant admission',
    id: 'option-1',
    isPaid: true,
    questions: [
      {
        description: 'Tell us about your accessibility needs.',
        id: 'question-1',
        required: false,
        title: 'Accessibility',
      },
    ],
    title: 'Participant',
  },
  status: 'open',
  transferId: 'transfer-1',
} satisfies Parameters<typeof RegistrationTransferClaimRecord.make>[0];

const validOfferResult = {
  claimCode: 'claim-code',
  claimUrl: '/registration-transfers/claim/claim-code',
  expiresAt: '2026-08-20T18:00:00.000Z',
  status: 'open',
} satisfies Parameters<typeof RegistrationTransferOfferResult.make>[0];

const validClaimResult = {
  eventId: 'event-1',
  registrationId: 'registration-2',
  status: 'confirmed',
} satisfies Parameters<typeof RegistrationTransferClaimResult.make>[0];

const validRetryCheckoutResult = {
  status: 'reconciled',
} satisfies Parameters<typeof RegistrationTransferRetryCheckoutResult.make>[0];

describe('registration transfer credential schema', () => {
  it('accepts non-empty opaque credentials up to 512 characters', () => {
    expect(
      Schema.decodeUnknownSync(RegistrationTransferCredential)('x'.repeat(512)),
    ).toHaveLength(512);
  });

  it.each(['', 'x'.repeat(513)])(
    'rejects an empty or overlong credential',
    (credential) => {
      expect(() =>
        Schema.decodeUnknownSync(RegistrationTransferCredential)(credential),
      ).toThrow();
    },
  );
});

describe('registration transfer offer schema', () => {
  it('encodes a schema-backed offer result for RPC transport', () => {
    const rpcSuccess = RegistrationTransferOfferResult.make(validOfferResult);

    expect(
      Schema.encodeUnknownSync(RegistrationTransfersCreateOffer.successSchema)(
        rpcSuccess,
      ),
    ).toEqual(validOfferResult);
  });

  it('accepts only a newly opened offer result', () => {
    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransferOfferResult)(
        validOfferResult,
      ),
    ).not.toThrow();

    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransferOfferResult)({
        ...validOfferResult,
        status: 'completed',
      }),
    ).toThrow();
  });
});

describe('registration transfer claim record schema', () => {
  it('encodes a schema-backed claim result for RPC transport', () => {
    const rpcSuccess = RegistrationTransferClaimRecord.make(validClaimRecord);

    expect(
      Schema.encodeUnknownSync(RegistrationTransfersGetClaim.successSchema)(
        rpcSuccess,
      ),
    ).toEqual(validClaimRecord);
  });

  it('decodes the event, recipient price, questions, fixed bundle, and state', () => {
    const decoded = Schema.decodeUnknownSync(RegistrationTransferClaimRecord)({
      ...validClaimRecord,
      credential: 'must-not-be-returned',
      sourceUserId: 'source-user-1',
    });

    expect(decoded).toMatchObject(validClaimRecord);
    expect(decoded).not.toHaveProperty('credential');
    expect(decoded).not.toHaveProperty('sourceUserId');
  });

  it('preserves registration check-in and add-on fulfillment history', () => {
    const decoded = Schema.decodeUnknownSync(RegistrationTransferClaimRecord)(
      validClaimRecord,
    );

    expect(decoded.bundle).toMatchObject({
      checkedInGuestCount: 1,
      checkInTime: '2026-08-20T18:15:00.000Z',
    });
    expect(decoded.bundle.addOns[0]).toMatchObject({
      cancelledQuantity: 1,
      redeemedQuantity: 1,
      remainingQuantity: 2,
    });
  });

  it('exposes only participant-safe refund lifecycle states', () => {
    const decoded = Schema.decodeUnknownSync(RegistrationTransferClaimRecord)({
      ...validClaimRecord,
      refundLifecycle: { state: 'actionRequired' },
      status: 'refund_pending',
      stripeRefundId: 'must-not-be-returned',
      stripeRefundLastError: 'must-not-be-returned',
    });

    expect(decoded.refundLifecycle?.state).toBe('actionRequired');
    expect(decoded).not.toHaveProperty('stripeRefundId');
    expect(decoded).not.toHaveProperty('stripeRefundLastError');
  });

  it('accepts every durable transfer status', () => {
    for (const status of [
      'open',
      'checkout_pending',
      'refund_pending',
      'refund_failed',
      'compensation_pending',
      'compensation_failed',
      'compensated',
      'completed',
      'cancelled',
      'expired',
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(RegistrationTransferClaimRecord)({
          ...validClaimRecord,
          status,
        }),
      ).not.toThrow();
    }
  });

  it('rejects invalid current prices and fixed bundle quantities', () => {
    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransferClaimRecord)({
        ...validClaimRecord,
        registrationOption: {
          ...validClaimRecord.registrationOption,
          currentPrice: -1,
        },
      }),
    ).toThrow();

    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransferClaimRecord)({
        ...validClaimRecord,
        bundle: {
          ...validClaimRecord.bundle,
          addOns: [
            {
              ...validClaimRecord.bundle.addOns[0],
              quantity: 0,
            },
          ],
        },
      }),
    ).toThrow();

    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransferClaimRecord)({
        ...validClaimRecord,
        bundle: {
          ...validClaimRecord.bundle,
          guestCount: 0.5,
        },
      }),
    ).toThrow();

    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransferClaimRecord)({
        ...validClaimRecord,
        bundle: {
          ...validClaimRecord.bundle,
          addOns: [
            {
              ...validClaimRecord.bundle.addOns[0],
              remainingQuantity: -1,
            },
          ],
        },
      }),
    ).toThrow();

    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransferClaimRecord)({
        ...validClaimRecord,
        bundle: {
          ...validClaimRecord.bundle,
          checkedInGuestCount: -1,
        },
      }),
    ).toThrow();
  });
});

describe('registration transfer claim input schema', () => {
  const validClaimInput = {
    answers: [{ answer: 'No accessibility needs', questionId: 'question-1' }],
    credential: 'claim-token',
  };

  it('requires recipient answers and the claim credential', () => {
    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransferClaimInput)(validClaimInput),
    ).not.toThrow();

    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransferClaimInput)({
        credential: 'claim-token',
      }),
    ).toThrow();
  });

  it('does not accept caller-selected bundle quantities', () => {
    const decoded = Schema.decodeUnknownSync(RegistrationTransferClaimInput)({
      ...validClaimInput,
      addOns: [{ addOnId: 'addon-1', quantity: 0 }],
      guestCount: 0,
    });

    expect(decoded).toEqual(validClaimInput);
    expect(decoded).not.toHaveProperty('addOns');
    expect(decoded).not.toHaveProperty('guestCount');
  });
});

describe('registration transfer outcome schemas', () => {
  it('encodes a schema-backed claim outcome for RPC transport', () => {
    const rpcSuccess = RegistrationTransferClaimResult.make(validClaimResult);

    expect(
      Schema.encodeUnknownSync(RegistrationTransfersClaim.successSchema)(
        rpcSuccess,
      ),
    ).toEqual(validClaimResult);
  });

  it('encodes a schema-backed retry outcome for RPC transport', () => {
    const rpcSuccess = RegistrationTransferRetryCheckoutResult.make(
      validRetryCheckoutResult,
    );

    expect(
      Schema.encodeUnknownSync(
        RegistrationTransfersRetryCheckout.successSchema,
      )(rpcSuccess),
    ).toEqual(validRetryCheckoutResult);
  });

  it.each(['confirmed', 'paymentPending'])(
    'accepts the supported claim outcome',
    (status) => {
      expect(() =>
        Schema.decodeUnknownSync(RegistrationTransferClaimResult)({
          ...(status === 'paymentPending' && {
            checkoutUrl: 'https://checkout.stripe.test/transfer',
          }),
          eventId: 'event-1',
          registrationId: 'registration-2',
          status,
        }),
      ).not.toThrow();
    },
  );

  it.each(['paymentPending', 'reconciled'])(
    'accepts the supported retry outcome',
    (status) => {
      expect(() =>
        Schema.decodeUnknownSync(RegistrationTransferRetryCheckoutResult)({
          ...(status === 'paymentPending' && {
            checkoutUrl: 'https://checkout.stripe.test/transfer',
          }),
          status,
        }),
      ).not.toThrow();
    },
  );

  it('rejects outcomes outside the public contract', () => {
    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransferClaimResult)({
        eventId: 'event-1',
        registrationId: 'registration-2',
        status: 'pending',
      }),
    ).toThrow();
  });
});

describe('registration transfer error schema', () => {
  it.each([
    'RegistrationTransferConflictError',
    'RegistrationTransferInternalError',
    'RegistrationTransferNotFoundError',
    'RegistrationTransferUnauthorizedError',
  ])('decodes the dedicated %s error', (_tag) => {
    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransfersRpcError)({
        _tag,
        message: 'Safe transfer error',
      }),
    ).not.toThrow();
  });

  it('rejects unrelated RPC error tags', () => {
    expect(() =>
      Schema.decodeUnknownSync(RegistrationTransfersRpcError)({
        _tag: 'RpcUnauthorizedError',
        message: 'Unauthorized',
      }),
    ).toThrow();
  });
});
