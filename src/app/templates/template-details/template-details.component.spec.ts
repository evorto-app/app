import type { TemplateFindOneRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  templateAddonPurchaseTiming,
  templateEsnDiscountVisible,
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

const templateDetailsTemplate = () =>
  readFileSync(
    path.join(
      process.cwd(),
      'src/app/templates/template-details/template-details.component.html',
    ),
    'utf8',
  );

describe('template detail add-on helpers', () => {
  it('shows ESNcard template discounts only when the tenant provider is enabled', () => {
    expect(
      templateEsnDiscountVisible({
        discountedPrice: 1200,
        esnEnabled: true,
      }),
    ).toBe(true);
    expect(
      templateEsnDiscountVisible({
        discountedPrice: 1200,
        esnEnabled: false,
      }),
    ).toBe(false);
    expect(
      templateEsnDiscountVisible({
        discountedPrice: null,
        esnEnabled: true,
      }),
    ).toBe(false);
  });

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

describe('TemplateDetailsComponent template', () => {
  it('shows edit and create actions only for loaded template data', () => {
    const template = templateDetailsTemplate();

    expect(template).toContain(
      '@if (templateQuery.isSuccess() && templateQuery.data())',
    );
    expect(template).toContain('@if (template) {');
    expect(template).toContain('routerLink="edit"');
    expect(template).toContain('routerLink="create-event"');
  });
});
