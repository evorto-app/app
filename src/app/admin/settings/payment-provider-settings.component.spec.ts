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
