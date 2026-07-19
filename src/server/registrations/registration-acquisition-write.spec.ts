import { describe, expect, it } from '@effect/vitest';

import {
  type AcquisitionPaymentInput,
  acquisitionPaymentSourceMatches,
  resolveRegistrationAcquisitionEpoch,
  resolveRequestedAcquisitionReplay,
  settleAcquisitionComponentTerms,
  type SettledAcquisitionComponent,
} from './registration-acquisition-write';

type PersistedReplayComponent = Parameters<
  typeof resolveRequestedAcquisitionReplay
>[0]['persistedComponents'][number];

const persistedReplayComponent = (input: {
  readonly acquisitionPaymentId: null | string;
  readonly component: SettledAcquisitionComponent;
  readonly id: string;
}): PersistedReplayComponent => ({
  acquisitionPaymentId: input.acquisitionPaymentId,
  allocationKey: input.component.allocationKey,
  applicationFeeAmount: input.component.applicationFeeAmount,
  baseAmount: input.component.baseAmount,
  currency: 'EUR',
  grossAmount: input.component.grossAmount,
  id: input.id,
  kind: input.component.kind,
  netAmount: input.component.netAmount,
  purchaseId:
    input.component.kind === 'addon_lot' ? input.component.purchaseId : null,
  purchaseLotId:
    input.component.kind === 'addon_lot' ? input.component.purchaseLotId : null,
  quantity: input.component.quantity,
  stripeFeeAmount: input.component.stripeFeeAmount,
  taxAmount: input.component.taxAmount,
  taxRateDisplayName: input.component.taxRateDisplayName,
  taxRateInclusive: input.component.taxRateInclusive,
  taxRatePercentage: input.component.taxRatePercentage,
});

const payment = {
  settlement: {
    applicationFeeAmount: 3,
    grossAmount: 100,
    stripeFeeAmount: 2,
    stripeNetAmount: 95,
  },
  stripeAccountId: 'acct_owner',
  stripeChargeId: 'ch_owner',
  stripePaymentIntentId: 'pi_owner',
  transactionId: 'transaction-owner',
  type: 'registration',
} satisfies AcquisitionPaymentInput;

const matchingSource = {
  amount: 100,
  appFee: 3,
  currency: 'EUR' as const,
  eventId: 'event-1',
  method: 'stripe' as const,
  registrationId: 'registration-1',
  status: 'successful' as const,
  stripeAccountId: payment.stripeAccountId,
  stripeChargeId: payment.stripeChargeId,
  stripeFee: 2,
  stripeNetAmount: 95,
  stripePaymentIntentId: payment.stripePaymentIntentId,
  targetUserId: 'user-1',
  tenantId: 'tenant-1',
  type: 'registration' as const,
};

const sourceMatches = (
  source: typeof matchingSource,
  paymentInput: AcquisitionPaymentInput = payment,
) =>
  acquisitionPaymentSourceMatches({
    currency: 'EUR',
    eventId: 'event-1',
    ownerUserId: 'user-1',
    payment: paymentInput,
    registrationId: 'registration-1',
    source,
    tenantId: 'tenant-1',
  });

describe('registration acquisition settlement', () => {
  it('keeps a zero-value inherited lot separate from the paid component', () => {
    const settled = settleAcquisitionComponentTerms({
      payment: payment.settlement,
      terms: [
        {
          allocationKey: 'registration-initial:registration-1',
          baseAmount: 100,
          id: 'registration',
          kind: 'registration',
          quantity: 1,
          taxRateDisplayName: null,
          taxRateInclusive: null,
          taxRatePercentage: null,
        },
        {
          allocationKey: 'addon-lot:free',
          baseAmount: 0,
          id: 'free-addon',
          kind: 'addon_lot',
          purchaseId: 'purchase-free',
          purchaseLotId: 'lot-free',
          quantity: 2,
          taxRateDisplayName: null,
          taxRateInclusive: null,
          taxRatePercentage: null,
        },
      ],
    });

    expect(settled).toEqual([
      expect.objectContaining({
        applicationFeeAmount: 3,
        grossAmount: 100,
        id: 'registration',
        netAmount: 95,
        stripeFeeAmount: 2,
      }),
      expect.objectContaining({
        applicationFeeAmount: 0,
        grossAmount: 0,
        id: 'free-addon',
        netAmount: 0,
        stripeFeeAmount: 0,
      }),
    ]);
  });

  it('uses stable component ids to break multi-component rounding ties', () => {
    const settled = settleAcquisitionComponentTerms({
      payment: {
        applicationFeeAmount: 5,
        grossAmount: 302,
        stripeFeeAmount: 4,
        stripeNetAmount: 293,
      },
      terms: [
        {
          allocationKey: 'registration',
          baseAmount: 101,
          id: 'a-registration',
          kind: 'registration',
          quantity: 1,
          taxRateDisplayName: null,
          taxRateInclusive: null,
          taxRatePercentage: null,
        },
        {
          allocationKey: 'addon-b',
          baseAmount: 101,
          id: 'b-addon',
          kind: 'addon_lot',
          purchaseId: 'purchase-b',
          purchaseLotId: 'lot-b',
          quantity: 1,
          taxRateDisplayName: null,
          taxRateInclusive: null,
          taxRatePercentage: null,
        },
        {
          allocationKey: 'addon-c',
          baseAmount: 100,
          id: 'c-addon',
          kind: 'addon_lot',
          purchaseId: 'purchase-c',
          purchaseLotId: 'lot-c',
          quantity: 1,
          taxRateDisplayName: null,
          taxRateInclusive: null,
          taxRatePercentage: null,
        },
      ],
    });

    expect(
      settled?.map(({ applicationFeeAmount, id, stripeFeeAmount }) => ({
        applicationFeeAmount,
        id,
        stripeFeeAmount,
      })),
    ).toEqual([
      {
        applicationFeeAmount: 2,
        id: 'a-registration',
        stripeFeeAmount: 2,
      },
      { applicationFeeAmount: 2, id: 'b-addon', stripeFeeAmount: 1 },
      { applicationFeeAmount: 1, id: 'c-addon', stripeFeeAmount: 1 },
    ]);
  });

  it('finds an idempotent operation even after a later acquisition epoch', () => {
    const initial = {
      operationKey: 'registration-initial:registration-1',
      ordinal: 0,
    };
    const later = {
      operationKey: 'registration-transfer:transfer-1',
      ordinal: 1,
    };

    expect(
      resolveRegistrationAcquisitionEpoch(
        [later, initial],
        initial.operationKey,
      ),
    ).toEqual({ current: later, existing: initial });
  });

  it('replays a free initial acquisition after a paid add-on was appended to the same epoch', () => {
    const initialRegistration = {
      allocationKey: 'registration-initial:registration-free',
      applicationFeeAmount: 0,
      baseAmount: 0,
      grossAmount: 0,
      id: 'requested-free-registration',
      kind: 'registration',
      netAmount: 0,
      quantity: 1,
      stripeFeeAmount: 0,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
    } satisfies SettledAcquisitionComponent;
    const initialIncludedAddon = {
      allocationKey: 'addon-lot:initial-included',
      applicationFeeAmount: 0,
      baseAmount: 0,
      grossAmount: 0,
      id: 'requested-initial-included-addon',
      kind: 'addon_lot',
      netAmount: 0,
      purchaseId: 'purchase-initial-included',
      purchaseLotId: 'lot-initial-included',
      quantity: 1,
      stripeFeeAmount: 0,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
    } satisfies SettledAcquisitionComponent;
    const laterPaidAddon = {
      allocationKey: 'addon-lot:later-paid',
      applicationFeeAmount: 1,
      baseAmount: 50,
      grossAmount: 50,
      id: 'later-paid-addon',
      kind: 'addon_lot',
      netAmount: 48,
      purchaseId: 'purchase-later-paid',
      purchaseLotId: 'lot-later-paid',
      quantity: 1,
      stripeFeeAmount: 1,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
    } satisfies SettledAcquisitionComponent;

    expect(
      resolveRequestedAcquisitionReplay({
        currency: 'EUR',
        persistedComponents: [
          persistedReplayComponent({
            acquisitionPaymentId: 'payment-later-addon',
            component: laterPaidAddon,
            id: 'component-later-addon',
          }),
          persistedReplayComponent({
            acquisitionPaymentId: null,
            component: initialRegistration,
            id: 'component-initial-registration',
          }),
          persistedReplayComponent({
            acquisitionPaymentId: null,
            component: initialIncludedAddon,
            id: 'component-initial-included-addon',
          }),
        ],
        persistedPayments: [
          {
            id: 'payment-later-addon',
            transactionId: 'transaction-later-addon',
          },
        ],
        requestedComponents: [initialRegistration, initialIncludedAddon],
      }),
    ).toEqual({
      componentIds: [
        'component-initial-registration',
        'component-initial-included-addon',
      ],
    });
  });

  it('replays a paid initial acquisition after another payment and component were appended', () => {
    const initialRegistration = {
      allocationKey: 'registration-initial:registration-paid',
      applicationFeeAmount: 3,
      baseAmount: 100,
      grossAmount: 100,
      id: 'requested-paid-registration',
      kind: 'registration',
      netAmount: 95,
      quantity: 1,
      stripeFeeAmount: 2,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
    } satisfies SettledAcquisitionComponent;
    const initialIncludedAddon = {
      allocationKey: 'addon-lot:paid-initial-included',
      applicationFeeAmount: 0,
      baseAmount: 0,
      grossAmount: 0,
      id: 'requested-paid-initial-included-addon',
      kind: 'addon_lot',
      netAmount: 0,
      purchaseId: 'purchase-paid-initial-included',
      purchaseLotId: 'lot-paid-initial-included',
      quantity: 2,
      stripeFeeAmount: 0,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
    } satisfies SettledAcquisitionComponent;
    const laterPaidAddon = {
      allocationKey: 'addon-lot:paid-later',
      applicationFeeAmount: 1,
      baseAmount: 40,
      grossAmount: 40,
      id: 'paid-later-addon',
      kind: 'addon_lot',
      netAmount: 38,
      purchaseId: 'purchase-paid-later',
      purchaseLotId: 'lot-paid-later',
      quantity: 1,
      stripeFeeAmount: 1,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
    } satisfies SettledAcquisitionComponent;

    expect(
      resolveRequestedAcquisitionReplay({
        currency: 'EUR',
        persistedComponents: [
          persistedReplayComponent({
            acquisitionPaymentId: 'payment-later-addon',
            component: laterPaidAddon,
            id: 'component-later-addon',
          }),
          persistedReplayComponent({
            acquisitionPaymentId: null,
            component: initialIncludedAddon,
            id: 'component-initial-included-addon',
          }),
          persistedReplayComponent({
            acquisitionPaymentId: 'payment-initial',
            component: initialRegistration,
            id: 'component-initial-registration',
          }),
        ],
        persistedPayments: [
          {
            id: 'payment-later-addon',
            transactionId: 'transaction-later-addon',
          },
          {
            id: 'payment-initial',
            transactionId: 'transaction-initial',
          },
        ],
        requestedComponents: [initialRegistration, initialIncludedAddon],
        requestedPaymentTransactionId: 'transaction-initial',
      }),
    ).toEqual({
      componentIds: [
        'component-initial-registration',
        'component-initial-included-addon',
      ],
      paymentId: 'payment-initial',
    });
  });

  it('rejects target, connected-account, charge, and payment-intent drift', () => {
    expect(sourceMatches(matchingSource)).toBe(true);
    expect(sourceMatches({ ...matchingSource, targetUserId: 'user-2' })).toBe(
      false,
    );
    expect(
      sourceMatches({ ...matchingSource, stripeAccountId: 'acct_rotated' }),
    ).toBe(false);
    expect(
      sourceMatches({ ...matchingSource, stripeChargeId: 'ch_replayed' }),
    ).toBe(false);
    expect(
      sourceMatches({
        ...matchingSource,
        stripePaymentIntentId: 'pi_replayed',
      }),
    ).toBe(false);
  });
});
