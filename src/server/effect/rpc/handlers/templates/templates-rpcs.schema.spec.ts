import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  TemplateFindOneRecord,
  TemplateSimpleInput,
} from '../../../../../shared/rpc-contracts/app-rpcs/templates.rpcs';

const validSimpleTemplateInput = {
  categoryId: 'category-1',
  description: '<p>Useful event template description</p>',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  location: null,
  organizerRegistration: {
    closeRegistrationOffset: 24,
    isPaid: false,
    openRegistrationOffset: 168,
    price: 0,
    registrationMode: 'fcfs' as const,
    roleIds: [],
    spots: 10,
    stripeTaxRateId: null,
    title: 'Organizer registration',
  },
  participantRegistration: {
    closeRegistrationOffset: 24,
    isPaid: false,
    openRegistrationOffset: 168,
    price: 0,
    registrationMode: 'fcfs' as const,
    roleIds: [],
    spots: 10,
    stripeTaxRateId: null,
    title: 'Participant registration',
  },
  title: 'Template',
};

const validSimpleTemplateAddonInput = {
  allowMultiple: true,
  allowPurchaseBeforeEvent: true,
  allowPurchaseDuringEvent: false,
  allowPurchaseDuringRegistration: true,
  description: 'Optional dinner ticket',
  isPaid: true,
  maxQuantityPerUser: 2,
  price: 1200,
  quantity: 1,
  registrationOptionKind: 'participant' as const,
  stripeTaxRateId: 'txr-1',
  title: 'Dinner',
  totalAvailableQuantity: 40,
};

const validTemplateFindOneRecord = {
  addOns: [],
  categoryId: 'category-1',
  description: '<p>Useful event template description</p>',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  id: 'template-1',
  location: null,
  planningTips: 'Bring printed waiver forms.',
  questions: [],
  registrationOptions: [],
  title: 'Template',
};

const validSimpleTemplateQuestionInput = {
  description: 'Tell organizers about accessibility needs.',
  registrationOptionKind: 'participant' as const,
  required: false,
  title: 'Accessibility needs',
};

const validGoogleLocation = {
  address: 'Example Street 1',
  coordinates: {
    lat: 52.37,
    lng: 4.9,
  },
  name: 'Example Place',
  placeId: 'place-1',
  type: 'google' as const,
};

describe('templates RPC location schema', () => {
  it('accepts organizer planning tips in template input and find-one responses', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateSimpleInput)({
        ...validSimpleTemplateInput,
        planningTips: 'Bring printed waiver forms.',
      }),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateFindOneRecord)({
        ...validTemplateFindOneRecord,
        planningTips: 'Bring printed waiver forms.',
      }),
    ).not.toThrow();
  });

  it('accepts structured template input locations', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateSimpleInput)({
        ...validSimpleTemplateInput,
        location: validGoogleLocation,
      }),
    ).not.toThrow();
  });

  it('accepts reusable add-ons in template find-one responses', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateFindOneRecord)({
        ...validTemplateFindOneRecord,
        addOns: [
          {
            allowMultiple: true,
            allowPurchaseBeforeEvent: true,
            allowPurchaseDuringEvent: false,
            allowPurchaseDuringRegistration: true,
            description: 'Optional dinner ticket',
            id: 'addon-1',
            isPaid: true,
            maxQuantityPerUser: 2,
            price: 1200,
            registrationOptions: [
              {
                quantity: 1,
                registrationOptionId: 'template-option-1',
              },
            ],
            stripeTaxRateId: 'txr-1',
            title: 'Dinner',
            totalAvailableQuantity: 40,
          },
        ],
      }),
    ).not.toThrow();
  });

  it('accepts optional reusable add-ons in simple template writes', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateSimpleInput)({
        ...validSimpleTemplateInput,
        addOns: [validSimpleTemplateAddonInput],
      }),
    ).not.toThrow();
  });

  it('accepts optional registration questions in simple template writes and find-one responses', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateSimpleInput)({
        ...validSimpleTemplateInput,
        questions: [validSimpleTemplateQuestionInput],
      }),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateFindOneRecord)({
        ...validTemplateFindOneRecord,
        questions: [
          {
            description: 'Tell organizers about accessibility needs.',
            id: 'question-1',
            registrationOptionId: 'template-option-1',
            required: false,
            sortOrder: 0,
            title: 'Accessibility needs',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects registration questions without a simple registration option target', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateSimpleInput)({
        ...validSimpleTemplateInput,
        questions: [
          {
            ...validSimpleTemplateQuestionInput,
            registrationOptionKind: 'vip',
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects reusable add-ons without a simple registration option target', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateSimpleInput)({
        ...validSimpleTemplateInput,
        addOns: [
          {
            ...validSimpleTemplateAddonInput,
            registrationOptionKind: 'vip',
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects malformed template input locations', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateSimpleInput)({
        ...validSimpleTemplateInput,
        location: {
          name: 'Broken Place',
          placeId: 'place-1',
          type: 'google',
        },
      }),
    ).toThrow();
  });

  it('rejects malformed template response locations', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateFindOneRecord)({
        ...validTemplateFindOneRecord,
        location: {
          meetingProvider: 'zoom',
          name: 'Broken Place',
          type: 'online',
        },
      }),
    ).toThrow();
  });
});
