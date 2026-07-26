import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createGeneralSettingsFormModel,
  generalSettingsBrandAssetUploadDisabled,
  generalSettingsFormSchema,
  generalSettingsSaveDisabled,
  nonNegativeIntegerValidationError,
  tenantTimezoneValidationError,
} from './general-settings.component';

const template = readFileSync(
  nodePath.join(
    process.cwd(),
    'src/app/admin/general-settings/general-settings.component.html',
  ),
  'utf8',
);

beforeEach(() => {
  TestBed.configureTestingModule({});
});

describe('generalSettingsSaveDisabled', () => {
  it('blocks tenant settings saves while invalid, submitting, or mutation-pending', () => {
    expect(
      generalSettingsSaveDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('generalSettingsBrandAssetUploadDisabled', () => {
  it('blocks brand asset uploads while any upload is active or mutation-pending', () => {
    expect(
      generalSettingsBrandAssetUploadDisabled({
        mutationPending: false,
        uploadingBrandAsset: 'logo',
      }),
    ).toBe(true);
    expect(
      generalSettingsBrandAssetUploadDisabled({
        mutationPending: true,
        uploadingBrandAsset: null,
      }),
    ).toBe(true);
    expect(
      generalSettingsBrandAssetUploadDisabled({
        mutationPending: false,
        uploadingBrandAsset: null,
      }),
    ).toBe(false);
  });
});

describe('tenantTimezoneValidationError', () => {
  it('accepts city or region timezones and rejects browser-local abbreviations', () => {
    expect(tenantTimezoneValidationError('America/New_York')).toBeUndefined();
    expect(tenantTimezoneValidationError('PST')).toEqual({
      kind: 'ianaTimezone',
      message: 'Enter a recognized city or region timezone.',
    });
  });
});

describe('tenant policy deadline validation', () => {
  it('requires every numeric policy value before settings can be saved', () => {
    const model = createGeneralSettingsFormModel();
    Reflect.set(model, 'cancellationDeadlineHoursBeforeStart', null);
    Reflect.set(model, 'maxActiveRegistrationsPerUser', null);
    Reflect.set(model, 'transferDeadlineHoursBeforeStart', null);
    const settings = form(signal(model), generalSettingsFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(
      settings
        .cancellationDeadlineHoursBeforeStart()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a cancellation deadline.');
    expect(
      settings
        .maxActiveRegistrationsPerUser()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter an active registration limit.');
    expect(
      settings
        .transferDeadlineHoursBeforeStart()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a transfer deadline.');
  });

  it.each([
    {
      expected: undefined,
      value: 0,
    },
    {
      expected: undefined,
      value: 12,
    },
    {
      expected: {
        kind: 'integer',
        message: 'Enter a whole number.',
      },
      value: 1.5,
    },
    {
      expected: {
        kind: 'nonNegative',
        message: 'Enter zero or more.',
      },
      value: -1,
    },
  ])('validates $value without changing it', ({ expected, value }) => {
    expect(nonNegativeIntegerValidationError(value)).toEqual(expected);
  });

  it('rejects fractional and negative settings in the form schema', () => {
    const settings = form(
      signal({
        ...createGeneralSettingsFormModel(),
        cancellationDeadlineHoursBeforeStart: -1,
        maxActiveRegistrationsPerUser: 1.5,
        transferDeadlineHoursBeforeStart: 2.5,
      }),
      generalSettingsFormSchema,
      {
        injector: TestBed.inject(Injector),
      },
    );

    expect(
      settings
        .maxActiveRegistrationsPerUser()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a whole number.');
    expect(
      settings
        .cancellationDeadlineHoursBeforeStart()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter zero or more.');
    expect(
      settings
        .transferDeadlineHoursBeforeStart()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a whole number.');
  });

  it('renders each numeric setting error at its field', () => {
    expect(template).toContain(
      'settingsForm.maxActiveRegistrationsPerUser().errors()',
    );
    expect(template).toContain(
      'settingsForm.transferDeadlineHoursBeforeStart().errors()',
    );
    expect(template).toMatch(
      /settingsForm\s*\.cancellationDeadlineHoursBeforeStart\(\)\s*\.errors\(\)/,
    );
  });
});
