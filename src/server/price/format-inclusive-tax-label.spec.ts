import {
  formatInclusiveTaxLabel,
  formatPriceWithTax,
  hasValidTaxRateInfo,
  isZeroTaxRate,
} from '@shared/price/format-inclusive-tax-label';
import { describe, expect, it } from 'vitest';

describe('formatInclusiveTaxLabel', () => {
  it('formats percentage and display name when both are available', () => {
    expect(
      formatInclusiveTaxLabel({
        displayName: 'VAT',
        percentage: '19',
      }),
    ).toBe('Incl. 19% VAT');
  });

  it('uses Tax free for zero percent tax rates', () => {
    expect(
      formatInclusiveTaxLabel({
        displayName: 'VAT',
        percentage: '0.00',
      }),
    ).toBe('Tax free');
  });

  it('falls back when tax rate details are unavailable', () => {
    expect(formatInclusiveTaxLabel(null)).toBe('Incl. Tax');
    expect(formatInclusiveTaxLabel({ stripeTaxRateId: 'txr_1' })).toBe(
      'Incl. Tax',
    );
  });
});

describe('formatPriceWithTax', () => {
  it('formats cents with the inclusive tax label', () => {
    expect(
      formatPriceWithTax(2500, 'EUR', {
        displayName: 'VAT',
        percentage: '19',
      }),
    ).toBe('€25.00 Incl. 19% VAT');
  });
});

describe('tax rate label helpers', () => {
  it('detects whether labelable tax information is available', () => {
    expect(hasValidTaxRateInfo()).toBe(false);
    expect(hasValidTaxRateInfo({ displayName: 'VAT' })).toBe(true);
    expect(hasValidTaxRateInfo({ percentage: '19' })).toBe(true);
  });

  it('detects zero percent tax rates numerically', () => {
    expect(isZeroTaxRate({ percentage: '0.00' })).toBe(true);
    expect(isZeroTaxRate({ percentage: '19' })).toBe(false);
    expect(isZeroTaxRate({ displayName: 'VAT' })).toBe(false);
  });
});
