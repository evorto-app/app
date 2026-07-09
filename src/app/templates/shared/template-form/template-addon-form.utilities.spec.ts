import { describe, expect, it } from 'vitest';

import {
  createTemplateAddonFormModel,
  templateAddonRecordToFormModel,
  toTemplateAddonSubmitData,
} from './template-addon-form.utilities';

const templateAddOnRecord = {
  allowMultiple: true,
  allowPurchaseBeforeEvent: true,
  allowPurchaseDuringEvent: false,
  allowPurchaseDuringRegistration: true,
  description: 'Dinner ticket',
  id: 'addon-1',
  isPaid: true,
  maxQuantityPerUser: 2,
  price: 1200,
  registrationOptions: [
    {
      quantity: 1,
      registrationOptionId: 'participant-option-1',
    },
  ],
  stripeTaxRateId: 'txr_vat_19',
  title: 'Dinner',
  totalAvailableQuantity: 40,
};

describe('template add-on form utilities', () => {
  it('clears hidden payment fields for free add-ons before submit', () => {
    expect(
      toTemplateAddonSubmitData(
        createTemplateAddonFormModel({
          isPaid: false,
          price: 1200,
          stripeTaxRateId: 'txr_vat_19',
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

  it('trims add-on title and description before submit', () => {
    expect(
      toTemplateAddonSubmitData(
        createTemplateAddonFormModel({
          description: '  Optional dinner ticket  ',
          title: '  Dinner  ',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        description: 'Optional dinner ticket',
        title: 'Dinner',
      }),
    );
  });

  it('submits template add-ons as registration-time purchases only', () => {
    expect(
      toTemplateAddonSubmitData(
        createTemplateAddonFormModel({
          allowPurchaseBeforeEvent: true,
          allowPurchaseDuringEvent: true,
          allowPurchaseDuringRegistration: false,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: true,
      }),
    );
  });

  it('keeps paid add-ons without tax rates visible to validation/server checks', () => {
    expect(
      toTemplateAddonSubmitData(
        createTemplateAddonFormModel({
          isPaid: true,
          price: 1200,
          stripeTaxRateId: null,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        isPaid: true,
        price: 1200,
        stripeTaxRateId: null,
      }),
    );
  });

  it('maps read-model attachments back to the simple add-on form shape', () => {
    expect(
      templateAddonRecordToFormModel({
        addOn: templateAddOnRecord,
        organizerRegistrationOptionId: 'organizer-option-1',
        participantRegistrationOptionId: 'participant-option-1',
      }),
    ).toEqual(
      expect.objectContaining({
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: true,
        quantity: 1,
        registrationOptionKind: 'participant',
        stripeTaxRateId: 'txr_vat_19',
        title: 'Dinner',
      }),
    );
  });
});
