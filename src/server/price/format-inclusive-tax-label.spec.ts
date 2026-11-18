import { formatInclusiveTaxLabel } from '@shared/price/format-inclusive-tax-label';
import { describe, expect, it } from 'vitest';

describe('formatInclusiveTaxLabel', () => {
  it('formats percentage and display name when both are available', () => {
    expect(
      formatInclusiveTaxLabel({
        displayName: 'VAT',
        percentage: '19',
      }),
    ).toBe('19% VAT included in the shown price');
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
