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
 * - "Incl. Tax" (fallback when details unavailable)
 *
 * @param taxRate Tax rate information or null/undefined if unavailable
 * @returns Formatted inclusive tax label string
 */
export function formatInclusiveTaxLabel(taxRate?: null | TaxRateInfo): string {
  // If no tax rate info available, use fallback
  if (!taxRate || (!taxRate.percentage && !taxRate.displayName)) {
    return 'Incl. Tax';
  }

  // Handle zero percent case - show "Tax free" instead of "Incl. 0%"
  if (taxRate.percentage === '0' || taxRate.percentage === '0.0' || taxRate.percentage === '0.00') {
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

  // Fallback
  return 'Incl. Tax';
}

/**
 * Formats a price with inclusive tax label
 *
 * @param amount Price amount (in cents or smallest currency unit)
 * @param currency Currency code (default: EUR)
 * @param taxRate Tax rate information
 * @returns Formatted price with tax label, e.g. "€25.00 Incl. 19% VAT"
 */
export function formatPriceWithTax(
  amount: number,
  currency = 'EUR',
  taxRate?: null | TaxRateInfo,
): string {
  // Format the price amount
  const formatter = new Intl.NumberFormat('en-US', {
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    style: 'currency',
  });

  const formattedAmount = formatter.format(amount / 100); // Assuming amount is in cents
  const taxLabel = formatInclusiveTaxLabel(taxRate);

  return `${formattedAmount} ${taxLabel}`;
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
