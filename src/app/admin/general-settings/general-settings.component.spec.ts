import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createGeneralSettingsFormModel,
  generalSettingsBrandAssetUploadDisabled,
  generalSettingsFormSchema,
  generalSettingsSaveDisabled,
  tenantTimezoneValidationError,
} from './general-settings.component';

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
  it('requires both deadline values before settings can be saved', () => {
    const model = createGeneralSettingsFormModel();
    Reflect.set(model, 'cancellationDeadlineHoursBeforeStart', null);
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
        .transferDeadlineHoursBeforeStart()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a transfer deadline.');
  });
});
