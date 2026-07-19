import { describe, expect, it } from 'vitest';

import { isSafeReceiptPreviewUrl } from '../shared/receipt-preview-dialog/receipt-preview-dialog.component';
import {
  receiptReimbursementCanRecord,
  receiptReimbursementGroupKey,
  receiptReimbursementHasPayoutDetails,
  receiptReimbursementManualNotice,
  receiptReimbursementMissingPayoutNotice,
  receiptReimbursementPayoutDetailLabel,
  receiptReimbursementReceiptSelectionLabel,
  receiptReimbursementRecordDisabled,
  receiptReimbursementSelectAllLabel,
  receiptReimbursementSelectedTotal,
} from './receipt-refund-list.component';

describe('isSafeReceiptPreviewUrl', () => {
  it('allows app-relative and trusted signed HTTP preview URLs', () => {
    expect(isSafeReceiptPreviewUrl('/receipt-preview/file.pdf')).toBe(true);
    expect(
      isSafeReceiptPreviewUrl(
        'https://receipt-bucket.s3.fr-par.scw.cloud/signed/file.pdf?token=abc',
      ),
    ).toBe(true);
    expect(isSafeReceiptPreviewUrl('http://localhost:9000/receipt.pdf')).toBe(
      true,
    );
  });

  it('rejects non-network preview URLs before they can be trusted for rendering', () => {
    expect(isSafeReceiptPreviewUrl(null)).toBe(false);
    expect(isSafeReceiptPreviewUrl('javascript:alert(1)')).toBe(false);
    expect(
      isSafeReceiptPreviewUrl('data:application/pdf;base64,JVBERi0='),
    ).toBe(false);
    expect(isSafeReceiptPreviewUrl('local-unavailable://receipt')).toBe(false);
    expect(isSafeReceiptPreviewUrl('https://evil.example.test/receipt')).toBe(
      false,
    );
    expect(
      isSafeReceiptPreviewUrl('https://objects.example.test/receipt.pdf'),
    ).toBe(false);
  });
});

describe('receiptReimbursementManualNotice', () => {
  it('keeps reimbursement copy honest about manual money movement', () => {
    expect(receiptReimbursementManualNotice).toBe(
      'Recording a reimbursement creates the Evorto finance transaction only. Transfer the money manually through the selected payout method.',
    );
  });
});

describe('receiptReimbursementCanRecord', () => {
  it('requires at least one selected receipt', () => {
    expect(
      receiptReimbursementCanRecord(
        [],
        { iban: 'DE123', paypalEmail: null },
        'iban',
      ),
    ).toBe(false);
  });

  it('requires the selected payout detail to exist', () => {
    expect(
      receiptReimbursementCanRecord(
        ['receipt-1'],
        { iban: null, paypalEmail: 'pay@example.com' },
        'iban',
      ),
    ).toBe(false);
    expect(
      receiptReimbursementCanRecord(
        ['receipt-1'],
        { iban: null, paypalEmail: 'pay@example.com' },
        'paypal',
      ),
    ).toBe(true);
  });
});

describe('receiptReimbursementHasPayoutDetails', () => {
  it('reports whether the recipient has at least one usable payout method', () => {
    expect(
      receiptReimbursementHasPayoutDetails({
        iban: null,
        paypalEmail: null,
      }),
    ).toBe(false);
    expect(
      receiptReimbursementHasPayoutDetails({
        iban: 'DE123',
        paypalEmail: null,
      }),
    ).toBe(true);
    expect(receiptReimbursementMissingPayoutNotice).toContain(
      'before recording a reimbursement',
    );
  });
});

describe('receipt reimbursement selection labels', () => {
  it('identifies the recipient, currency, receipt, and event for checkbox controls', () => {
    expect(
      receiptReimbursementSelectAllLabel({
        currency: 'EUR',
        submittedByFirstName: 'Ada',
        submittedByLastName: 'Lovelace',
      }),
    ).toBe('Select all EUR receipts for Ada Lovelace');
    expect(
      receiptReimbursementReceiptSelectionLabel({
        attachmentFileName: 'receipt.pdf',
        eventTitle: 'Welcome Week',
      }),
    ).toBe('Select receipt receipt.pdf for Welcome Week');
  });
});

describe('receiptReimbursementRecordDisabled', () => {
  it('disables reimbursement recording when the selected group cannot be recorded', () => {
    expect(
      receiptReimbursementRecordDisabled({
        canRecord: false,
        mutationPending: false,
      }),
    ).toBe(true);
  });

  it('disables reimbursement recording while a refund mutation is pending', () => {
    expect(
      receiptReimbursementRecordDisabled({
        canRecord: true,
        mutationPending: true,
      }),
    ).toBe(true);
  });

  it('allows reimbursement recording only when the selection and mutation are ready', () => {
    expect(
      receiptReimbursementRecordDisabled({
        canRecord: true,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('receiptReimbursementPayoutDetailLabel', () => {
  it('labels configured and missing payout details', () => {
    expect(receiptReimbursementPayoutDetailLabel('iban', 'DE123')).toBe(
      'IBAN: DE123',
    );
    expect(receiptReimbursementPayoutDetailLabel('paypal', null)).toBe(
      'PayPal: not set',
    );
  });
});

describe('receiptReimbursementSelectedTotal', () => {
  it('sums only selected receipt rows', () => {
    expect(
      receiptReimbursementSelectedTotal(
        [
          { id: 'receipt-1', totalAmount: 1299 },
          { id: 'receipt-2', totalAmount: 2500 },
          { id: 'receipt-3', totalAmount: 999 },
        ],
        ['receipt-1', 'receipt-3'],
      ),
    ).toBe(2298);
  });
});

describe('receiptReimbursementGroupKey', () => {
  it("keeps one recipient's reimbursement state separate per currency", () => {
    expect(
      receiptReimbursementGroupKey({
        currency: 'EUR',
        submittedByUserId: 'user-1',
      }),
    ).not.toBe(
      receiptReimbursementGroupKey({
        currency: 'CZK',
        submittedByUserId: 'user-1',
      }),
    );
  });
});
