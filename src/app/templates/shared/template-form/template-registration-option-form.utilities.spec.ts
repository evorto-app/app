import { describe, expect, it } from 'vitest';

import {
  createTemplateRegistrationFormModel,
  mergeTemplateRegistrationFormOverrides,
  toTemplateRegistrationSubmitData,
} from './template-registration-option-form.utilities';

describe('toTemplateRegistrationSubmitData', () => {
  it('keeps paid template registration price and tax rate', () => {
    expect(
      toTemplateRegistrationSubmitData(
        createTemplateRegistrationFormModel({
          description: '<p>Public copy</p>',
          esnCardDiscountedPrice: 1900,
          isPaid: true,
          price: 2500,
          registeredDescription: '<p>Private copy</p>',
          stripeTaxRateId: 'txr_vat_19',
          title: 'Early bird',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        description: '<p>Public copy</p>',
        esnCardDiscountedPrice: 1900,
        isPaid: true,
        price: 2500,
        registeredDescription: '<p>Private copy</p>',
        stripeTaxRateId: 'txr_vat_19',
        title: 'Early bird',
      }),
    );
  });

  it('trims the option title and clears blank rich text copy before submit', () => {
    expect(
      toTemplateRegistrationSubmitData(
        createTemplateRegistrationFormModel({
          description: '   ',
          registeredDescription: '',
          title: '  Participant registration  ',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        description: '',
        registeredDescription: '',
        title: 'Participant registration',
      }),
    );
  });

  it('keeps paid registrations without a selected tax rate as a validation failure for the server', () => {
    expect(
      toTemplateRegistrationSubmitData(
        createTemplateRegistrationFormModel({
          isPaid: true,
          price: 2500,
          stripeTaxRateId: null,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        isPaid: true,
        price: 2500,
        stripeTaxRateId: null,
      }),
    );
  });

  it('clears hidden payment fields for free template registrations', () => {
    expect(
      toTemplateRegistrationSubmitData(
        createTemplateRegistrationFormModel({
          esnCardDiscountedPrice: 1900,
          isPaid: false,
          price: 2500,
          stripeTaxRateId: 'txr_stale',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        esnCardDiscountedPrice: null,
        isPaid: false,
        price: 0,
        stripeTaxRateId: null,
      }),
    );
  });

  it('normalizes a blank ESNcard discounted price to null', () => {
    expect(
      toTemplateRegistrationSubmitData(
        createTemplateRegistrationFormModel({
          esnCardDiscountedPrice: '',
          isPaid: true,
          price: 2500,
          stripeTaxRateId: 'txr_vat_19',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        esnCardDiscountedPrice: null,
        isPaid: true,
      }),
    );
  });

  it('clears ESNcard discounts when the provider is disabled', () => {
    expect(
      toTemplateRegistrationSubmitData(
        createTemplateRegistrationFormModel({
          esnCardDiscountedPrice: 1900,
          isPaid: true,
          price: 2500,
          stripeTaxRateId: 'txr_vat_19',
        }),
        { esnEnabled: false },
      ),
    ).toEqual(
      expect.objectContaining({
        esnCardDiscountedPrice: null,
        isPaid: true,
      }),
    );
  });
});

describe('mergeTemplateRegistrationFormOverrides', () => {
  it('clears a previous ESNcard discounted price when the server value is null', () => {
    expect(
      mergeTemplateRegistrationFormOverrides(
        {
          esnCardDiscountedPrice: null,
        },
        createTemplateRegistrationFormModel({
          esnCardDiscountedPrice: 1900,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        esnCardDiscountedPrice: '',
      }),
    );
  });
});
