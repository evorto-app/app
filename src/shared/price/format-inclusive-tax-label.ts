/**
 * Tax rate information for formatting inclusive labels
 */
export interface TaxRateInfo {
  displayName?: null | string;
  percentage?: null | string;
  stripeTaxRateId?: null | string;
}

/**
 * Formats a plain-language label for tax included in a displayed price.
 *
 * Examples:
 * - "19% VAT included in the shown price"
 * - "Tax free" (for 0%)
 * - "Tax details unavailable" when a paid price has no validated tax metadata
 *
 * @param taxRate Tax rate information or null/undefined if unavailable
 * @returns Formatted tax label string
 */
export function formatInclusiveTaxLabel(taxRate?: null | TaxRateInfo): string {
  // Missing metadata is invalid for a paid price. Surface it rather than
  // implying that an unspecified tax was included.
  if (!taxRate || (!taxRate.percentage && !taxRate.displayName)) {
    return 'Tax details unavailable';
  }

  // A zero-percent rate is clearer as "Tax free".
  if (
    taxRate.percentage === '0' ||
    taxRate.percentage === '0.0' ||
    taxRate.percentage === '0.00'
  ) {
    return 'Tax free';
  }

  if (taxRate.percentage && taxRate.displayName) {
    return `${taxRate.percentage}% ${taxRate.displayName} included in the shown price`;
  }

  if (taxRate.percentage) {
    return `${taxRate.percentage}% tax included in the shown price`;
  }

  if (taxRate.displayName) {
    return `${taxRate.displayName} included in the shown price`;
  }

  return 'Tax details unavailable';
}

export function hasValidTaxRateInfo(taxRate?: null | TaxRateInfo): boolean {
  if (!taxRate) return false;

  return !!(taxRate.percentage || taxRate.displayName);
}

export function isZeroTaxRate(taxRate?: null | TaxRateInfo): boolean {
  if (!taxRate?.percentage) return false;

  const percentage = Number.parseFloat(taxRate.percentage);
  return percentage === 0;
}
