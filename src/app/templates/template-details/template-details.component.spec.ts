import type { TemplateFindOneRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { describe, expect, it } from 'vitest';

import {
  templateAddonPurchaseTiming,
  templateRegistrationOptionTitle,
} from './template-details.component';

const createTemplate = (): TemplateFindOneRecord => ({
  addOns: [],
  categoryId: 'category-1',
  description: '<p>Template description</p>',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  id: 'template-1',
  location: null,
  planningTips: null,
  questions: [],
  registrationOptions: [
    {
      closeRegistrationOffset: 24,
      description: null,
      esnCardDiscountedPrice: null,
      id: 'template-option-1',
      isPaid: false,
      openRegistrationOffset: 168,
      organizingRegistration: false,
      price: 0,
      registeredDescription: null,
      registrationMode: 'fcfs',
      roleIds: [],
      roles: [],
      spots: 20,
      stripeTaxRateId: null,
      title: 'Participant registration',
    },
  ],
  title: 'Template',
});

describe('template detail add-on helpers', () => {
  it('formats enabled purchase timing windows', () => {
    expect(
      templateAddonPurchaseTiming({
        allowMultiple: true,
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: true,
        description: null,
        id: 'addon-1',
        isPaid: false,
        maxQuantityPerUser: 1,
        price: 0,
        registrationOptions: [],
        stripeTaxRateId: null,
        title: 'Dinner',
        totalAvailableQuantity: 40,
      }),
    ).toBe('During registration, Before event');
  });

  it('marks add-ons without purchase windows as unavailable', () => {
    expect(
      templateAddonPurchaseTiming({
        allowMultiple: false,
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: false,
        description: null,
        id: 'addon-1',
        isPaid: false,
        maxQuantityPerUser: 1,
        price: 0,
        registrationOptions: [],
        stripeTaxRateId: null,
        title: 'Dinner',
        totalAvailableQuantity: 40,
      }),
    ).toBe('Unavailable');
  });

  it('resolves add-on registration option labels from the template record', () => {
    expect(
      templateRegistrationOptionTitle(createTemplate(), 'template-option-1'),
    ).toBe('Participant registration');
  });

  it('keeps missing add-on registration option labels explicit', () => {
    expect(
      templateRegistrationOptionTitle(createTemplate(), 'missing-option'),
    ).toBe('Unknown registration option');
  });
});
