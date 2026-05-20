import { describe, expect, it } from 'vitest';

import {
  createTemplateFormModel,
  mergeTemplateFormOverrides,
  templateWriteSubmitDisabled,
} from './template-form.utilities';

describe('templateWriteSubmitDisabled', () => {
  it('disables template writes while the form is invalid', () => {
    expect(
      templateWriteSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
  });

  it('disables template writes while the form is submitting', () => {
    expect(
      templateWriteSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
  });

  it('disables template writes while the create or update mutation is pending', () => {
    expect(
      templateWriteSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
  });

  it('allows template writes only when the form and mutation are idle', () => {
    expect(
      templateWriteSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('template form add-on model', () => {
  it('keeps simple mode to one organizer and one participant registration block', () => {
    expect(createTemplateFormModel()).toEqual(
      expect.objectContaining({
        organizerRegistration: expect.objectContaining({
          spots: 1,
          title: 'Organizer Registration',
        }),
        participantRegistration: expect.objectContaining({
          spots: 20,
          title: 'Participant Registration',
        }),
      }),
    );
  });

  it('starts new simple templates without reusable add-ons', () => {
    expect(createTemplateFormModel().addOns).toEqual([]);
  });

  it('keeps existing add-ons when later overrides only refresh defaults', () => {
    const previous = createTemplateFormModel({
      addOns: [
        {
          allowMultiple: false,
          allowPurchaseBeforeEvent: true,
          allowPurchaseDuringEvent: false,
          allowPurchaseDuringRegistration: true,
          description: '',
          isPaid: false,
          maxQuantityPerUser: 1,
          price: 0,
          quantity: 1,
          registrationOptionKind: 'participant',
          stripeTaxRateId: null,
          title: 'Dinner',
          totalAvailableQuantity: 20,
        },
      ],
    });

    expect(
      mergeTemplateFormOverrides({ categoryId: 'category-2' }, previous),
    ).toEqual(
      expect.objectContaining({
        addOns: expect.arrayContaining([
          expect.objectContaining({ title: 'Dinner' }),
        ]),
        categoryId: 'category-2',
      }),
    );
  });
});

describe('template form question model', () => {
  it('starts new simple templates without registration questions', () => {
    expect(createTemplateFormModel().questions).toEqual([]);
  });

  it('keeps existing questions when later overrides only refresh defaults', () => {
    const previous = createTemplateFormModel({
      questions: [
        {
          description: '',
          registrationOptionKind: 'participant',
          required: true,
          title: 'Dietary requirements',
        },
      ],
    });

    expect(
      mergeTemplateFormOverrides({ categoryId: 'category-2' }, previous),
    ).toEqual(
      expect.objectContaining({
        categoryId: 'category-2',
        questions: expect.arrayContaining([
          expect.objectContaining({ title: 'Dietary requirements' }),
        ]),
      }),
    );
  });
});
