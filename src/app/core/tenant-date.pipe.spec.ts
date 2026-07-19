import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Settings } from 'luxon';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TENANT_DATE_PIPE_TIMEZONE, TenantDatePipe } from './tenant-date.pipe';

describe('TenantDatePipe', () => {
  const originalDefaultZone = Settings.defaultZone;

  beforeAll(() => registerLocaleData(localeDe));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TenantDatePipe,
        { provide: LOCALE_ID, useValue: 'de-DE' },
        {
          provide: TENANT_DATE_PIPE_TIMEZONE,
          useValue: 'Europe/Berlin',
        },
      ],
    });
  });

  afterEach(() => {
    Settings.defaultZone = originalDefaultZone;
    TestBed.resetTestingModule();
  });

  it('applies the tenant IANA timezone with the offset for each instant', () => {
    const pipe = TestBed.inject(TenantDatePipe);

    expect(pipe.transform('2026-01-15T23:30:45.000Z', 'medium')).toBe(
      '16.01.2026, 00:30:45',
    );
    expect(pipe.transform('2026-07-15T22:30:45.000Z', 'medium')).toBe(
      '16.07.2026, 00:30:45',
    );
  });

  it('renders the same output for server and browser host timezones', () => {
    const pipe = TestBed.inject(TenantDatePipe);

    Settings.defaultZone = 'UTC';
    const serverOutput = pipe.transform(
      '2026-07-15T22:30:45.000Z',
      'yyyy-MM-dd HH:mm',
    );
    Settings.defaultZone = 'America/Los_Angeles';
    const browserOutput = pipe.transform(
      '2026-07-15T22:30:45.000Z',
      'yyyy-MM-dd HH:mm',
    );

    expect(serverOutput).toBe('2026-07-16 00:30');
    expect(browserOutput).toBe(serverOutput);
  });

  it('uses the injected tenant timezone for zone-less business dates', () => {
    const pipe = TestBed.inject(TenantDatePipe);

    expect(pipe.transform('2026-01-16T00:30:00', 'shortTime')).toBe('00:30');
    expect(pipe.transform('2026-01-16', 'mediumDate')).toBe('16.01.2026');
  });
});
