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
export const OTHER_RECEIPT_COUNTRY_LABEL = 'Other country';

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

export const isCanonicalReceiptCountryCode = (value: string): boolean =>
  normalizeReceiptCountryCode(value) === value;

export const resolveReceiptCountrySettings = (configuredSettings: {
  allowOther: boolean;
  receiptCountries: readonly string[];
}): ReceiptCountrySettings => {
  if (configuredSettings.receiptCountries.length === 0) {
    throw new Error('At least one receipt country must be configured');
  }

  const receiptCountries = configuredSettings.receiptCountries.map(
    (country) => {
      if (!isCanonicalReceiptCountryCode(country)) {
        throw new Error(
          'Receipt countries must use supported uppercase two-letter codes',
        );
      }
      return country;
    },
  );

  if (new Set(receiptCountries).size !== receiptCountries.length) {
    throw new Error('Receipt countries must not contain duplicates');
  }

  return {
    allowOther: configuredSettings.allowOther,
    receiptCountries,
  };
};

export const buildSelectableReceiptCountries = (
  settings: ReceiptCountrySettings,
): string[] =>
  settings.allowOther
    ? [...settings.receiptCountries, OTHER_RECEIPT_COUNTRY_CODE]
    : [...settings.receiptCountries];

export const firstReceiptCountry = (countries: readonly string[]): string => {
  const first = countries[0];
  if (!first) {
    throw new Error('At least one receipt country must be configured');
  }
  return first;
};
