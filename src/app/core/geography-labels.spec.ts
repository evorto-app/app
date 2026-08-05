import { describe, expect, it } from 'vitest';

import {
  countryLabel,
  taxRateRegionLabel,
  tenantTimezoneLabel,
  tenantTimezoneOptions,
} from './geography-labels';

describe('tenantTimezoneLabel', () => {
  it('uses readable labels without changing the stored identifiers', () => {
    expect(tenantTimezoneOptions).toEqual([
      { label: 'Prague time', value: 'Europe/Prague' },
      { label: 'Berlin time', value: 'Europe/Berlin' },
      { label: 'Brisbane time', value: 'Australia/Brisbane' },
    ]);
    expect(tenantTimezoneLabel('America/New_York')).toBe('New York time');
    expect(tenantTimezoneLabel('UTC')).toBe('Universal time');
  });

  it('surfaces invalid persisted values without displaying them', () => {
    expect(tenantTimezoneLabel('not-a-timezone')).toBe('Time zone unavailable');
  });
});

describe('countryLabel', () => {
  it('resolves country codes through the native region names', () => {
    expect(countryLabel('DE')).toBe('Germany');
    expect(countryLabel('cz')).toBe('Czechia');
  });

  it('does not leak unrecognized code-like values', () => {
    expect(countryLabel('XX')).toBe('Country name unavailable');
    expect(countryLabel('')).toBeNull();
  });
});

describe('taxRateRegionLabel', () => {
  it('combines readable country and region names', () => {
    expect(taxRateRegionLabel('DE', 'Bavaria')).toBe('Germany · Bavaria');
  });

  it('surfaces unknown region names and absent scope explicitly', () => {
    expect(taxRateRegionLabel('DE', 'BY')).toBe(
      'Germany · Region name unavailable',
    );
    expect(taxRateRegionLabel(null, null)).toBe('No region specified');
  });
});
