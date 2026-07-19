import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { registrationTransferSourceRefundAggregate } from './registration-transfer-refund-reconciliation';

const sourceRefund = (
  overrides: Partial<
    Parameters<typeof registrationTransferSourceRefundAggregate>[0][number]
  > = {},
) => ({
  refundAmountDue: 1000,
  refundTransactionId: 'refund-1',
  status: 'pending' as const,
  stripeRefundStatus: 'pending' as const,
  ...overrides,
});

describe('registrationTransferSourceRefundAggregate', () => {
  it('succeeds only after every positive refund item succeeds', () => {
    expect(
      registrationTransferSourceRefundAggregate([
        sourceRefund({ refundAmountDue: 0, refundTransactionId: null }),
        sourceRefund({
          status: 'successful',
          stripeRefundStatus: 'succeeded',
        }),
        sourceRefund({
          refundTransactionId: 'refund-2',
          status: 'successful',
          stripeRefundStatus: 'succeeded',
        }),
      ]),
    ).toBe('succeeded');
  });

  it('stays pending while any sibling claim is unfinished', () => {
    expect(
      registrationTransferSourceRefundAggregate([
        sourceRefund({
          status: 'successful',
          stripeRefundStatus: 'succeeded',
        }),
        sourceRefund({ refundTransactionId: 'refund-2' }),
      ]),
    ).toBe('pending');
  });

  it.each([
    { status: 'successful' as const, stripeRefundStatus: 'pending' as const },
    { status: 'pending' as const, stripeRefundStatus: 'succeeded' as const },
  ])(
    'does not complete for inconsistent success state %#',
    ({ status, stripeRefundStatus }) => {
      expect(
        registrationTransferSourceRefundAggregate([
          sourceRefund({ status, stripeRefundStatus }),
        ]),
      ).toBe('pending');
    },
  );

  it.each([
    sourceRefund({ refundTransactionId: null, status: null }),
    sourceRefund({ status: 'cancelled' }),
    sourceRefund({ stripeRefundStatus: 'canceled' }),
    sourceRefund({ stripeRefundStatus: 'failed' }),
  ])('fails closed for a missing or terminal sibling claim', (item) => {
    expect(
      registrationTransferSourceRefundAggregate([
        sourceRefund({
          status: 'successful',
          stripeRefundStatus: 'succeeded',
        }),
        item,
      ]),
    ).toBe('failed');
  });
});

describe('registration transfer refund reconciliation source', () => {
  it('maps source claims through tenant-scoped plan items and aggregates siblings', () => {
    const source = readFileSync(
      new URL(
        'registration-transfer-refund-reconciliation.ts',
        import.meta.url,
      ),
      'utf8',
    );

    expect(source).toContain('registrationTransferRefundPlanItems.transferId');
    expect(source).toContain(
      'registrationTransferRefundPlanItems.refundTransactionId',
    );
    expect(source).toContain('registrationTransferRefundPlanItems.tenantId');
    expect(source).toContain('loadSourceRefundPlanItemStates');
    expect(source).toContain('registrationTransferSourceRefundAggregate');
    expect(source).not.toContain('registrationTransfers.refundTransactionId');
  });

  it('locks only the matched transfer row during operator recovery', () => {
    const source = readFileSync(
      new URL(
        'registration-transfer-refund-reconciliation.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const recoveryLock = source.slice(
      source.indexOf('export const lockRegistrationTransferRefundForRecovery'),
      source.indexOf('const loadRegistrationTransferRefundMapping'),
    );

    expect(recoveryLock).toContain('.from(registrationTransfers)');
    expect(recoveryLock).toContain(
      '.from(registrationTransferRefundPlanItems)',
    );
    expect(recoveryLock).toContain(".for('update')");
    expect(recoveryLock).not.toContain('.leftJoin(');
  });

  it('requires the requeue mutation to retain the locked transfer identity', () => {
    const source = readFileSync(
      new URL(
        'registration-transfer-refund-reconciliation.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const requeueMutation = source.slice(
      source.indexOf('export const markRegistrationTransferRefundRequeued'),
      source.indexOf('const reconcileCompensationRefund'),
    );

    expect(requeueMutation).toContain('input.expectedTransfer.kind');
    expect(requeueMutation).toContain('input.expectedTransfer.transferId');
    expect(requeueMutation).toContain(
      'mapping.transfer.id !== input.expectedTransfer.transferId',
    );
  });

  it('keeps compensation singular and tenant scoped on the parent transfer', () => {
    const source = readFileSync(
      new URL(
        'registration-transfer-refund-reconciliation.ts',
        import.meta.url,
      ),
      'utf8',
    );

    expect(source).toContain(
      'registrationTransfers.compensationRefundTransactionId',
    );
    expect(source).toContain(
      'eq(transactions.tenantId, registrationTransfers.tenantId)',
    );
    expect(source).toContain(
      'eq(registrationTransfers.tenantId, transfer.tenantId)',
    );
  });
});
