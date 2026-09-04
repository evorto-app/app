import {
  isIanaTimezone,
  supportedTenantTimezones,
} from '../../types/custom/tenant';

const countryNames = new Intl.DisplayNames(['en'], {
  fallback: 'none',
  type: 'region',
});

const supportedTimezoneLabels = {
  'Australia/Brisbane': 'Brisbane time',
  'Europe/Berlin': 'Berlin time',
  'Europe/Prague': 'Prague time',
} as const satisfies Record<(typeof supportedTenantTimezones)[number], string>;

const codeLikeValue = /^[A-Z\d_-]{1,8}$/u;
const countryCode = /^[a-z]{2}$/iu;

export const tenantTimezoneLabel = (timezone: string): string => {
  if (timezone in supportedTimezoneLabels) {
    return supportedTimezoneLabels[
      timezone as keyof typeof supportedTimezoneLabels
    ];
  }
  if (timezone === 'UTC') return 'Universal time';
  if (!isIanaTimezone(timezone)) return 'Time zone unavailable';

  const location = timezone.split('/').at(-1)?.replaceAll('_', ' ').trim();
  return location ? `${location} time` : 'Time zone unavailable';
};

export const tenantTimezoneOptions = supportedTenantTimezones.map((value) => ({
  label: supportedTimezoneLabels[value],
  value,
}));

export const countryLabel = (
  country: null | string | undefined,
): null | string => {
  const value = country?.trim();
  if (!value) return null;
  if (countryCode.test(value)) {
    return countryNames.of(value.toUpperCase()) ?? 'Country name unavailable';
  }
  return codeLikeValue.test(value) ? 'Country name unavailable' : value;
};

const subdivisionLabel = (
  subdivision: null | string | undefined,
): null | string => {
  const value = subdivision?.trim();
  if (!value) return null;
  return codeLikeValue.test(value) ? 'Region name unavailable' : value;
};

export const taxRateRegionLabel = (
  country: null | string | undefined,
  subdivision: null | string | undefined,
): string => {
  const labels = [countryLabel(country), subdivisionLabel(subdivision)].filter(
    (label): label is string => label !== null,
  );
  return labels.length > 0 ? labels.join(' · ') : 'No region specified';
};
