import {
  formatInclusiveTaxLabel,
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

  it('surfaces unavailable tax details instead of implying a tax result', () => {
    expect(formatInclusiveTaxLabel(null)).toBe('Tax details unavailable');
    expect(formatInclusiveTaxLabel({ stripeTaxRateId: 'txr_1' })).toBe(
      'Tax details unavailable',
    );
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
