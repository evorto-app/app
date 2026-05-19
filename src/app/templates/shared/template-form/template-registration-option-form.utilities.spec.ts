import { describe, expect, it } from 'vitest';

import {
  createTemplateRegistrationFormModel,
  toTemplateRegistrationSubmitData,
} from './template-registration-option-form.utilities';

describe('toTemplateRegistrationSubmitData', () => {
  it('keeps paid template registration price and tax rate', () => {
    expect(
      toTemplateRegistrationSubmitData(
        createTemplateRegistrationFormModel({
          isPaid: true,
          price: 2500,
          stripeTaxRateId: 'txr_vat_19',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        isPaid: true,
        price: 2500,
        stripeTaxRateId: 'txr_vat_19',
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
          isPaid: false,
          price: 2500,
          stripeTaxRateId: 'txr_stale',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        isPaid: false,
        price: 0,
        stripeTaxRateId: null,
      }),
    );
  });
});
