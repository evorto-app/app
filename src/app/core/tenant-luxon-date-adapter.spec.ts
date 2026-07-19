import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { Settings } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfigService } from './config.service';
import { TenantLuxonDateAdapter } from './tenant-luxon-date-adapter';

describe('TenantLuxonDateAdapter', () => {
  let adapter: TenantLuxonDateAdapter;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TenantLuxonDateAdapter,
        {
          provide: ConfigService,
          useValue: {
            tenantSignal: signal({ timezone: 'Australia/Brisbane' }),
          },
        },
        { provide: MAT_DATE_LOCALE, useValue: 'de-DE' },
      ],
    });
    adapter = TestBed.inject(TenantLuxonDateAdapter);
  });

  it('creates and formats calendar values in the tenant timezone and fixed locale', () => {
    const date = adapter.createDate(2026, 0, 2);

    expect(date.zoneName).toBe('Australia/Brisbane');
    expect(date.toISO()).toBe('2026-01-02T00:00:00.000+10:00');
    expect(adapter.format(date, 'dd. LLLL yyyy')).toBe('02. Januar 2026');
  });

  it('presents an immutable UTC instant in tenant business time', () => {
    const date = adapter.parse('2026-01-02T00:30:00.000Z', 'D');

    expect(date?.zoneName).toBe('Australia/Brisbane');
    expect(date?.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-01-02 10:30');
    expect(date?.toJSDate().toISOString()).toBe('2026-01-02T00:30:00.000Z');
  });

  it('does not mutate Luxon global defaults shared by concurrent SSR requests', () => {
    const originalZone = Settings.defaultZone;

    adapter.today();
    adapter.deserialize('2026-07-10T12:00:00.000Z');

    expect(Settings.defaultZone).toBe(originalZone);
  });
});
