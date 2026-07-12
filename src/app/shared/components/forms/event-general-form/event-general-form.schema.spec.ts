import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRegistrationOptionFormModel } from '../registration-option-form/registration-option-form.schema';
import {
  createEventGeneralFormModel,
  eventGeneralFormSchemaWithPaymentAvailability,
  resetEventGeneralFormPayments,
} from './event-general-form.schema';

describe('createEventGeneralFormModel', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('creates scheduling defaults in tenant business time', () => {
    const model = createEventGeneralFormModel({}, 'Australia/Brisbane');

    expect(model.start.zoneName).toBe('Australia/Brisbane');
    expect(model.end.zoneName).toBe('Australia/Brisbane');
  });

  it('disables paid controls until Stripe is available', () => {
    const paymentAllowed = signal(false);
    const eventForm = form(
      signal(
        createEventGeneralFormModel({
          registrationOptions: [createRegistrationOptionFormModel()],
        }),
      ),
      eventGeneralFormSchemaWithPaymentAvailability(() => paymentAllowed()),
      { injector: TestBed.inject(Injector) },
    );

    expect(eventForm.registrationOptions[0].isPaid().disabled()).toBe(true);
    expect(eventForm.registrationOptions[0].price().disabled()).toBe(true);

    paymentAllowed.set(true);

    expect(eventForm.registrationOptions[0].isPaid().disabled()).toBe(false);
    expect(eventForm.registrationOptions[0].price().disabled()).toBe(false);
  });

  it('clears only payment fields when Stripe is confirmed disconnected', () => {
    const model = createEventGeneralFormModel({
      registrationOptions: [
        createRegistrationOptionFormModel({
          esnCardDiscountedPrice: 900,
          isPaid: true,
          price: 1000,
          roleIds: ['role-1'],
          stripeTaxRateId: 'txr_1',
          title: 'Retained option',
        }),
      ],
      title: 'Retained title',
    });

    const reset = resetEventGeneralFormPayments(model);

    expect(reset).toMatchObject({ title: 'Retained title' });
    expect(reset.registrationOptions[0]).toMatchObject({
      esnCardDiscountedPrice: '',
      isPaid: false,
      price: 0,
      roleIds: ['role-1'],
      stripeTaxRateId: null,
      title: 'Retained option',
    });
  });
});
