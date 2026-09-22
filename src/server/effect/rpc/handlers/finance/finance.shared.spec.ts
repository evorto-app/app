import { describe, expect, it } from 'vitest';

import {
  normalizeFinanceTransactionRecord,
  resolveTenantSelectableReceiptCountries,
  validateReceiptCountryForTenant,
} from './finance.shared';

describe('normalizeFinanceTransactionRecord', () => {
  it('retains the currency recorded with the immutable transaction', () => {
    expect(
      normalizeFinanceTransactionRecord({
        amount: 25_000,
        appFee: 500,
        comment: 'Event registration',
        createdAt: new Date('2026-07-10T10:00:00.000Z'),
        currency: 'CZK',
        id: 'transaction-1',
        method: 'stripe',
        status: 'successful',
        stripeFee: 750,
      }),
    ).toMatchObject({
      amount: 25_000,
      currency: 'CZK',
      id: 'transaction-1',
    });
  });
});

describe('required tenant receipt settings', () => {
  it('rejects malformed persisted Other flags before using the receipt policy', () => {
    for (const allowOther of [null, 'true', 'false', 0, 1, {}, []]) {
      const tenant = {
        receiptSettings: { allowOther, receiptCountries: ['DE'] },
      };
      const message = 'Receipt country allowOther setting must be a boolean';
      expect(() => resolveTenantSelectableReceiptCountries(tenant)).toThrow(
        message,
      );
      expect(() => validateReceiptCountryForTenant(tenant, 'OTHER')).toThrow(
        message,
      );
      expect(() => validateReceiptCountryForTenant(tenant, 'DE')).toThrow(
        message,
      );
    }
  });

  it('fails instead of inventing countries or the Other policy', () => {
    for (const receiptSettings of [
      undefined,
      null,
      {},
      { allowOther: false },
      { receiptCountries: ['DE'] },
      { allowOther: false, receiptCountries: [] },
      { allowOther: false, receiptCountries: ['DE', 'DE'] },
      { allowOther: false, receiptCountries: ['de'] },
    ]) {
      expect(() =>
        resolveTenantSelectableReceiptCountries({ receiptSettings }),
      ).toThrow();
    }
  });
  it.each([
    {
      countries: [],
      message: 'At least one receipt country must be configured',
    },
    {
      countries: ['DE', 'DE'],
      message: 'Receipt countries must not contain duplicates',
    },
    {
      countries: ['de'],
      message:
        'Receipt countries must use supported uppercase two-letter codes',
    },
  ])(
    'preserves the shared validation error: $message',
    ({ countries, message }) => {
      const tenant = {
        receiptSettings: { allowOther: false, receiptCountries: countries },
      };
      expect(() => resolveTenantSelectableReceiptCountries(tenant)).toThrow(
        message,
      );
      expect(() => validateReceiptCountryForTenant(tenant, 'OTHER')).toThrow(
        message,
      );
      expect(() => validateReceiptCountryForTenant(tenant, 'DE')).toThrow(
        message,
      );
    },
  );

  it('uses the explicit country list and Other policy', () => {
    const tenant = {
      receiptSettings: { allowOther: true, receiptCountries: ['NL', 'DE'] },
    };
    expect(resolveTenantSelectableReceiptCountries(tenant)).toEqual([
      'NL',
      'DE',
      'OTHER',
    ]);
    expect(validateReceiptCountryForTenant(tenant, 'nl')).toBe('NL');
    expect(validateReceiptCountryForTenant(tenant, 'US')).toBeNull();
    expect(
      validateReceiptCountryForTenant(
        { receiptSettings: { ...tenant.receiptSettings, allowOther: false } },
        'OTHER',
      ),
    ).toBeNull();
  });
});
