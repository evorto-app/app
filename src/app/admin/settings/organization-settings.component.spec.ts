import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  organizationSettingsFormSchema,
  tenantTimezoneValidationError,
} from './organization-settings.component';

beforeEach(() => {
  TestBed.configureTestingModule({});
});

describe('tenantTimezoneValidationError', () => {
  it('accepts city or region timezones and rejects browser-local abbreviations', () => {
    expect(tenantTimezoneValidationError('America/New_York')).toBeUndefined();
    expect(tenantTimezoneValidationError('PST')).toEqual({
      kind: 'ianaTimezone',
      message: 'Enter a recognized city or region time zone.',
    });
  });

  it('keeps an invalid timezone visible at the form boundary', () => {
    const settings = form(
      signal({
        defaultLocation: null,
        emailSenderEmail: '',
        emailSenderName: '',
        timezone: 'PST',
      }),
      organizationSettingsFormSchema,
      {
        injector: TestBed.inject(Injector),
      },
    );

    expect(
      settings
        .timezone()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a recognized city or region time zone.');
  });
});
