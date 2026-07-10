import { signal } from '@angular/core';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import {
  resolveTenantRuntimeTimezone,
  tenantCurrencyCode,
  tenantDatePipeConfig,
  tenantNow,
  toTenantDateTime,
} from './tenant-runtime';

describe('tenant runtime time configuration', () => {
  it('uses Europe/Berlin until tenant context is available', () => {
    expect(resolveTenantRuntimeTimezone(undefined)).toBe('Europe/Berlin');
    expect(tenantDatePipeConfig({ tenantSignal: signal(null) })).toEqual({
      timezone: 'Europe/Berlin',
    });
    expect(tenantCurrencyCode({ tenantSignal: signal(null) })).toBe('EUR');
  });

  it('provides the tenant IANA timezone to Angular DatePipe', () => {
    expect(
      tenantDatePipeConfig({
        tenantSignal: signal({
          currency: 'AUD',
          timezone: 'America/New_York',
        }),
      }),
    ).toEqual({ timezone: 'America/New_York' });
    expect(
      tenantCurrencyCode({
        tenantSignal: signal({
          currency: 'AUD',
          timezone: 'America/New_York',
        }),
      }),
    ).toBe('AUD');
  });

  it('converts an instant into tenant business time without changing it', () => {
    const instant = new Date('2026-01-15T23:30:00.000Z');
    const tenantDateTime = toTenantDateTime(instant, 'Australia/Brisbane');

    expect(tenantDateTime.zoneName).toBe('Australia/Brisbane');
    expect(tenantDateTime.toFormat('yyyy-MM-dd HH:mm')).toBe(
      '2026-01-16 09:30',
    );
    expect(tenantDateTime.toJSDate().toISOString()).toBe(
      '2026-01-15T23:30:00.000Z',
    );
  });

  it('creates tenant-local defaults from the same clock instant', () => {
    const instant = DateTime.fromISO('2026-07-10T22:30:00.000Z', {
      zone: 'utc',
    });

    expect(
      tenantNow('Europe/Berlin', instant).toFormat('yyyy-MM-dd HH:mm'),
    ).toBe('2026-07-11 00:30');
  });
});
