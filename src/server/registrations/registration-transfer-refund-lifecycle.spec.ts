import { describe, expect, it } from 'vitest';

import { resolveRegistrationTransferRefundLifecycle } from './registration-transfer-refund-lifecycle';

const pendingRefund = () => ({
  manuallyCreated: false,
  method: 'stripe' as const,
  status: 'pending' as const,
  stripeRefundAttempts: 1,
  stripeRefundClaimLeaseExpiresAt: null,
  stripeRefundClaimLeaseId: null,
  stripeRefundMaxAttempts: 8,
  stripeRefundNextAttemptAt: new Date('2026-07-12T12:10:00.000Z'),
  stripeRefundStatus: 'pending' as const,
});

const succeededRefund = () => ({
  ...pendingRefund(),
  status: 'successful' as const,
  stripeRefundNextAttemptAt: null,
  stripeRefundStatus: 'succeeded' as const,
});

describe('resolveRegistrationTransferRefundLifecycle', () => {
  it('keeps only scheduled or leased automatic claims in processing', () => {
    expect(
      resolveRegistrationTransferRefundLifecycle({
        refunds: [pendingRefund(), succeededRefund()],
        transferStatus: 'refund_pending',
      })?.state,
    ).toBe('processing');
    expect(
      resolveRegistrationTransferRefundLifecycle({
        refunds: [
          {
            ...pendingRefund(),
            stripeRefundAttempts: 8,
            stripeRefundClaimLeaseExpiresAt: new Date(
              '2026-07-12T12:10:00.000Z',
            ),
            stripeRefundClaimLeaseId: 'lease-1',
            stripeRefundNextAttemptAt: null,
          },
        ],
        transferStatus: 'compensation_pending',
      })?.state,
    ).toBe('processing');
  });

  it('keeps provider action distinct from automatic processing', () => {
    expect(
      resolveRegistrationTransferRefundLifecycle({
        refunds: [
          succeededRefund(),
          pendingRefund(),
          {
            ...pendingRefund(),
            stripeRefundAttempts: 8,
            stripeRefundNextAttemptAt: null,
            stripeRefundStatus: 'requires_action',
          },
        ],
        transferStatus: 'refund_pending',
      })?.state,
    ).toBe('actionRequired');
  });

  it.each([
    { reason: 'missing claim', refunds: [null] },
    { reason: 'empty claim set', refunds: [] },
    {
      reason: 'exhausted claim',
      refunds: [{ ...pendingRefund(), stripeRefundAttempts: 8 }],
    },
    {
      reason: 'orphaned claim',
      refunds: [{ ...pendingRefund(), stripeRefundNextAttemptAt: null }],
    },
    {
      reason: 'partial lease',
      refunds: [
        {
          ...pendingRefund(),
          stripeRefundClaimLeaseId: 'partial-lease',
        },
      ],
    },
  ])('fails closed for a $reason', ({ refunds }) => {
    expect(
      resolveRegistrationTransferRefundLifecycle({
        refunds,
        transferStatus: 'refund_pending',
      })?.state,
    ).toBe('needsAttention');
  });

  it('uses needs-attention before action, processing, and success', () => {
    expect(
      resolveRegistrationTransferRefundLifecycle({
        refunds: [
          succeededRefund(),
          {
            ...pendingRefund(),
            stripeRefundStatus: 'requires_action',
          },
          pendingRefund(),
          { ...pendingRefund(), stripeRefundAttempts: 8 },
        ],
        transferStatus: 'refund_pending',
      })?.state,
    ).toBe('needsAttention');
    expect(
      resolveRegistrationTransferRefundLifecycle({
        refunds: [
          {
            ...succeededRefund(),
            stripeRefundStatus: 'failed',
          },
        ],
        transferStatus: 'refund_pending',
      })?.state,
    ).toBe('needsAttention');
  });

  it('projects terminal transfer and refund outcomes safely', () => {
    expect(
      resolveRegistrationTransferRefundLifecycle({
        refunds: [succeededRefund()],
        transferStatus: 'compensation_failed',
      })?.state,
    ).toBe('needsAttention');
    expect(
      resolveRegistrationTransferRefundLifecycle({
        refunds: [succeededRefund(), succeededRefund()],
        transferStatus: 'refund_pending',
      })?.state,
    ).toBe('succeeded');
    expect(
      resolveRegistrationTransferRefundLifecycle({
        refunds: [],
        transferStatus: 'completed',
      }),
    ).toBeNull();
  });
});
