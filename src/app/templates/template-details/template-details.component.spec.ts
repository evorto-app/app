import type { TemplateFindOneRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  templateAddonPurchaseTiming,
  templateDetailsErrorMessage,
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
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 24,
      description: null,
      esnCardDiscountedPrice: null,
      id: 'template-option-1',
      isPaid: false,
      openRegistrationOffset: 168,
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs',
      roleIds: [],
      roles: [],
      spots: 20,
      stripeTaxRateId: null,
      title: 'Participant registration',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  title: 'Template',
});

describe('template detail add-on helpers', () => {
  it('shows registration-time purchase timing only', () => {
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
    ).toBe('During sign-up');
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
    ).toBe('Sign-up choice unavailable');
  });

  it('shows a missing template without exposing internal failures', () => {
    expect(
      templateDetailsErrorMessage({
        _tag: 'TemplateSimpleNotFoundError',
        message: 'This template could not be found.',
      }),
    ).toBe('This template could not be found.');
    expect(
      templateDetailsErrorMessage({
        _tag: 'TemplateSimpleInternalError',
        message: 'database failed',
      }),
    ).toBe('The template could not be loaded. Try again.');
  });

  it('surfaces unavailable tax details instead of treating the provider result as empty', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/templates/template-details/template-details.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/templates/template-details/template-details.component.html',
      ),
      'utf8',
    );

    expect(source).toContain(
      'if (!this.taxRatesQuery.isSuccess()) return null',
    );
    expect(template).toContain('Tax details could not be loaded.');
    expect(template).toContain('taxRatesQuery.refetch()');
  });
});
