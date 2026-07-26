/**
 * Tax rate information for formatting inclusive labels
 */
export interface TaxRateInfo {
  displayName?: null | string;
  percentage?: null | string;
  stripeTaxRateId?: null | string;
}

/**
 * Formats an inclusive tax label based on tax rate information
 *
 * Examples:
 * - "Incl. 19% VAT"
 * - "Tax free" (for 0%)
 * - "Tax details unavailable" when a paid price has no validated tax metadata
 *
 * @param taxRate Tax rate information or null/undefined if unavailable
 * @returns Formatted inclusive tax label string
 */
export function formatInclusiveTaxLabel(taxRate?: null | TaxRateInfo): string {
  // Missing metadata is invalid for a paid price. Surface it rather than
  // implying that an unspecified tax was included.
  if (!taxRate || (!taxRate.percentage && !taxRate.displayName)) {
    return 'Tax details unavailable';
  }

  // Handle zero percent case - show "Tax free" instead of "Incl. 0%"
  if (
    taxRate.percentage === '0' ||
    taxRate.percentage === '0.0' ||
    taxRate.percentage === '0.00'
  ) {
    return 'Tax free';
  }

  // Try to build specific label with percentage and name
  if (taxRate.percentage && taxRate.displayName) {
    return `Incl. ${taxRate.percentage}% ${taxRate.displayName}`;
  }

  // If only percentage available
  if (taxRate.percentage) {
    return `Incl. ${taxRate.percentage}%`;
  }

  // If only name available (rare case)
  if (taxRate.displayName) {
    return `Incl. ${taxRate.displayName}`;
  }

  return 'Tax details unavailable';
}

/**
 * Validates that a tax rate info object has minimum required data for labeling
 */
export function hasValidTaxRateInfo(taxRate?: null | TaxRateInfo): boolean {
  if (!taxRate) return false;

  // Valid if we have either percentage or display name
  return !!(taxRate.percentage || taxRate.displayName);
}

/**
 * Checks if a tax rate should be considered as zero/free
 */
export function isZeroTaxRate(taxRate?: null | TaxRateInfo): boolean {
  if (!taxRate?.percentage) return false;

  const percentage = Number.parseFloat(taxRate.percentage);
  return percentage === 0;
}
