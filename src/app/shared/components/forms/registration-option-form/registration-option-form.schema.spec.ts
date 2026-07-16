import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createRegistrationOptionFormModel,
  registrationOptionFormSchema,
} from './registration-option-form.schema';

describe('createRegistrationOptionFormModel', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('creates registration-window defaults in tenant business time', () => {
    const model = createRegistrationOptionFormModel({}, 'America/New_York');

    expect(model.openRegistrationTime.zoneName).toBe('America/New_York');
    expect(model.closeRegistrationTime.zoneName).toBe('America/New_York');
  });

  it('inherits tenant transfer and cancellation policy by default', () => {
    expect(createRegistrationOptionFormModel()).toMatchObject({
      cancellationDeadlineHoursBeforeStart: null,
      refundFeesOnCancellation: null,
      transferDeadlineHoursBeforeStart: null,
    });
  });

  it('requires a paid registration to cost at least 0.01', () => {
    const option = form(
      signal(
        createRegistrationOptionFormModel({
          isPaid: true,
          price: 0,
          stripeTaxRateId: 'txr_test',
        }),
      ),
      registrationOptionFormSchema,
      { injector: TestBed.inject(Injector) },
    );

    expect(
      option
        .price()
        .errors()
        .map((error) => error.message),
    ).toContain('Paid registrations must cost at least 0.01.');

    option.price().value.set(1);

    expect(option.price().errors()).toEqual([]);
  });

  it('keeps a free registration with a zero price valid and hidden', () => {
    const option = form(
      signal(createRegistrationOptionFormModel({ isPaid: false, price: 0 })),
      registrationOptionFormSchema,
      { injector: TestBed.inject(Injector) },
    );

    expect(option.price().hidden()).toBe(true);
    expect(option.price().errors()).toEqual([]);
  });
});
