import { describe, expect, it } from 'vitest';

import {
  firstReceiptCountry,
  resolveReceiptCountrySettings,
} from './finance/receipt-countries';
import {
  createDefaultTenantDiscountProviders,
  resolveTenantDiscountProviders,
} from './tenant-config';

describe('tenant persisted configuration', () => {
  it('decodes the complete discount-provider shape without filling omissions', () => {
    expect(
      resolveTenantDiscountProviders(createDefaultTenantDiscountProviders()),
    ).toEqual({
      esnCard: {
        config: {},
        status: 'disabled',
      },
    });

    for (const invalid of [
      undefined,
      null,
      {},
      { esnCard: {} },
      { esnCard: { config: {} } },
    ]) {
      expect(() => resolveTenantDiscountProviders(invalid)).toThrow();
    }
  });

  it('accepts only canonical HTTPS buy-card URLs from persistence', () => {
    expect(
      resolveTenantDiscountProviders({
        esnCard: {
          config: {
            buyEsnCardUrl: 'https://cards.example.org/buy',
          },
          status: 'enabled',
        },
      }),
    ).toMatchObject({
      esnCard: {
        config: {
          buyEsnCardUrl: 'https://cards.example.org/buy',
        },
      },
    });

    for (const buyEsnCardUrl of [
      'not-a-url',
      'http://cards.example.org/buy',
      ' https://cards.example.org/buy ',
      'https://cards.example.org',
    ]) {
      expect(() =>
        resolveTenantDiscountProviders({
          esnCard: {
            config: { buyEsnCardUrl },
            status: 'enabled',
          },
        }),
      ).toThrow();
    }
  });

  it('keeps explicit receipt settings and rejects unsupported country codes', () => {
    expect(
      resolveReceiptCountrySettings({
        allowOther: true,
        receiptCountries: ['DE', 'CZ'],
      }),
    ).toEqual({
      allowOther: true,
      receiptCountries: ['DE', 'CZ'],
    });

    expect(() =>
      resolveReceiptCountrySettings({
        allowOther: false,
        receiptCountries: ['DE', 'invalid'],
      }),
    ).toThrow(
      'Receipt countries must use supported uppercase two-letter codes',
    );
    expect(() =>
      resolveReceiptCountrySettings({
        allowOther: false,
        receiptCountries: [],
      }),
    ).toThrow('At least one receipt country must be configured');
    expect(() =>
      resolveReceiptCountrySettings({
        allowOther: false,
        receiptCountries: ['DE', 'DE'],
      }),
    ).toThrow('Receipt countries must not contain duplicates');
    expect(firstReceiptCountry(['NL', 'DE'])).toBe('NL');
    expect(() => firstReceiptCountry([])).toThrow(
      'At least one receipt country must be configured',
    );
  });
});
