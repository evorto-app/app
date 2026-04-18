export interface ReceiptCountryOption {
  code: string;
  label: string;
}

export interface ReceiptCountrySettings {
  allowOther: boolean;
  receiptCountries: string[];
}

export const RECEIPT_COUNTRY_OPTIONS: readonly ReceiptCountryOption[] = [
  { code: 'AT', label: 'Austria' },
  { code: 'AU', label: 'Australia' },
  { code: 'BE', label: 'Belgium' },
  { code: 'BG', label: 'Bulgaria' },
  { code: 'BR', label: 'Brazil' },
  { code: 'CA', label: 'Canada' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'CY', label: 'Cyprus' },
  { code: 'CZ', label: 'Czechia' },
  { code: 'DE', label: 'Germany' },
  { code: 'DK', label: 'Denmark' },
  { code: 'EE', label: 'Estonia' },
  { code: 'ES', label: 'Spain' },
  { code: 'FI', label: 'Finland' },
  { code: 'FR', label: 'France' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'GR', label: 'Greece' },
  { code: 'HR', label: 'Croatia' },
  { code: 'HU', label: 'Hungary' },
  { code: 'IE', label: 'Ireland' },
  { code: 'IT', label: 'Italy' },
  { code: 'LT', label: 'Lithuania' },
  { code: 'LU', label: 'Luxembourg' },
  { code: 'LV', label: 'Latvia' },
  { code: 'MT', label: 'Malta' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'NO', label: 'Norway' },
  { code: 'PL', label: 'Poland' },
  { code: 'PT', label: 'Portugal' },
  { code: 'RO', label: 'Romania' },
  { code: 'SE', label: 'Sweden' },
  { code: 'SI', label: 'Slovenia' },
  { code: 'SK', label: 'Slovakia' },
  { code: 'US', label: 'United States' },
];

export const OTHER_RECEIPT_COUNTRY_CODE = 'OTHER';
export const OTHER_RECEIPT_COUNTRY_LABEL =
  'Other (outside configured countries)';

export const DEFAULT_RECEIPT_COUNTRIES: readonly string[] = [
  'DE',
  'CZ',
  'AT',
  'PL',
  'NL',
];

const knownCountryCodes = new Set(
  RECEIPT_COUNTRY_OPTIONS.map((country) => country.code),
);

export const normalizeReceiptCountryCode = (value: string): null | string => {
  const normalized = value.trim().toUpperCase();
  if (normalized.length !== 2 || !knownCountryCodes.has(normalized)) {
    return null;
  }

  return normalized;
};

export const resolveAllowedReceiptCountries = (
  configuredCountries: readonly string[] | undefined,
): string[] => {
  const normalized = (configuredCountries ?? [])
    .map((country) => normalizeReceiptCountryCode(country))
    .filter((country): country is string => country !== null);

  if (normalized.length > 0) {
    return [...new Set(normalized)];
  }

  return [...DEFAULT_RECEIPT_COUNTRIES];
};

export const resolveReceiptCountrySettings = (
  configuredSettings:
    | undefined
    | {
        allowOther?: boolean | undefined;
        receiptCountries?: readonly string[] | undefined;
      },
): ReceiptCountrySettings => ({
  allowOther: configuredSettings?.allowOther === true,
  receiptCountries: resolveAllowedReceiptCountries(
    configuredSettings?.receiptCountries,
  ),
});

export const buildSelectableReceiptCountries = (
  settings: ReceiptCountrySettings,
): string[] =>
  settings.allowOther
    ? [...settings.receiptCountries, OTHER_RECEIPT_COUNTRY_CODE]
    : [...settings.receiptCountries];
