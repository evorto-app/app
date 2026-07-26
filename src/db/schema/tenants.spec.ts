import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { tenants } from './tenants';

describe('tenant runtime settings schema', () => {
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

  it('rejects negative registration-policy values at the database boundary', () => {
    expect(getTableConfig(tenants).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'tenants_cancellation_deadline_hours_nonnegative',
        'tenants_max_active_registrations_per_user_nonnegative',
        'tenants_transfer_deadline_hours_nonnegative',
      ]),
    );
  });
});
