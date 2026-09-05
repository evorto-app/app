import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import { paymentProviderSettingsFormSchema } from './payment-provider-settings.component';

beforeEach(() => {
  TestBed.configureTestingModule({});
});

describe('paymentProviderSettingsFormSchema', () => {
  it('requires at least one receipt country', () => {
    const settings = form(
      signal({
        allowOther: false,
        buyEsnCardUrl: '',
        currency: 'EUR' as const,
        esnCardEnabled: false,
        receiptCountries: [],
        refundFeesOnCancellation: true,
      }),
      paymentProviderSettingsFormSchema,
      {
        injector: TestBed.inject(Injector),
      },
    );

    expect(
      settings
        .receiptCountries()
        .errors()
        .map((error) => error.message),
    ).toContain('Choose at least one receipt country.');
  });
});

describe('preserved receipt country validation', () => {
  it('rejects incomplete, duplicate and unsupported choices without normalizing them', () => {
    const initial = {
      allowOther: false,
      buyEsnCardUrl: '',
      currency: 'EUR' as const,
      esnCardEnabled: false,
      receiptCountries: ['DE', 'NL'],
      refundFeesOnCancellation: true,
    };
    const model = signal(initial);
    const settings = form(model, paymentProviderSettingsFormSchema, {
      injector: TestBed.inject(Injector),
    });
    for (const receiptCountries of [
      [],
      ['DE', 'DE'],
      ['de'],
      ['invalid'],
      ['OTHER'],
    ]) {
      model.set({ ...initial, receiptCountries });
      expect(settings.receiptCountries().invalid()).toBe(true);
      expect(settings.receiptCountries().value()).toEqual(receiptCountries);
    }
    model.set(initial);
    expect(settings().valid()).toBe(true);
  });
});
