import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { localeEnum, tenants } from './tenants';

describe('tenant runtime settings schema', () => {
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
      domain: 'new-york.example.com',
      name: 'New York Section',
      timezone: 'America/New_York',
    } satisfies typeof tenants.$inferInsert;
    expect(tenantInsert.timezone).toBe('America/New_York');
  });
});
