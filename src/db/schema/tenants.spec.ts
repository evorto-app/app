import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { localeEnum, tenants } from './tenants';

describe('tenant runtime settings schema', () => {
  it('requires a canonical root URL tied to the primary domain', () => {
    const table = getTableConfig(tenants);
    const canonicalRootUrlColumn = table.columns.find(
      (column) => column.name === 'canonical_root_url',
    );

    expect(canonicalRootUrlColumn?.notNull).toBe(true);
    expect(
      table.checks.some(
        (constraint) =>
          constraint.name === 'tenants_canonical_root_url_matches_domain',
      ),
    ).toBe(true);

    const tenantInsert = {
      canonicalRootUrl: 'https://new-york.example.com',
      domain: 'new-york.example.com',
      name: 'New York Section',
    } satisfies typeof tenants.$inferInsert;
    expect(tenantInsert.canonicalRootUrl).toBe('https://new-york.example.com');
  });

  it('defaults new tenants to the fixed formatting locale', () => {
    const localeColumn = getTableConfig(tenants).columns.find(
      (column) => column.name === 'locale',
    );

    expect(localeEnum.enumValues).toContain('de-DE');
    expect(localeColumn?.default).toBe('de-DE');
  });

  it('stores arbitrary validated IANA timezone names with the Berlin default', () => {
    const timezoneColumn = getTableConfig(tenants).columns.find(
      (column) => column.name === 'timezone',
    );

    expect(timezoneColumn?.getSQLType()).toBe('varchar(64)');
    expect(timezoneColumn?.notNull).toBe(true);
    expect(timezoneColumn?.default).toBe('Europe/Berlin');

    const tenantInsert = {
      canonicalRootUrl: 'https://new-york.example.com',
      domain: 'new-york.example.com',
      name: 'New York Section',
      timezone: 'America/New_York',
    } satisfies typeof tenants.$inferInsert;
    expect(tenantInsert.timezone).toBe('America/New_York');
  });
});
