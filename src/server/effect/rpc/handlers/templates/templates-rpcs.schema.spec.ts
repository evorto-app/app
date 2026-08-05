import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  TemplateGraphInput,
  TemplateGraphRecord,
} from '../../../../../shared/rpc-contracts/app-rpcs/templates.rpcs';

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

const validGraphInput = {
  addOns: [
    {
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      description: 'Optional dinner ticket',
      isPaid: true,
      key: 'dinner',
      maxQuantityPerUser: 2,
      price: 1200,
      registrationOptions: [
        {
          includedQuantity: 1,
          optionalPurchaseQuantity: 1,
          registrationOptionKey: 'participant',
        },
      ],
      stripeTaxRateId: 'txr-1',
      title: 'Dinner',
      totalAvailableQuantity: 40,
    },
  ],
  categoryId: 'category-1',
  description: '<p>Useful event template description</p>',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  location: null,
  planningTips: 'Bring printed waiver forms.',
  questions: [
    {
      description: 'Tell organizers about accessibility needs.',
      key: 'accessibility',
      registrationOptionKey: 'participant',
      required: false,
      sortOrder: 0,
      title: 'Accessibility needs',
    },
  ],
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 24,
      description: null,
      esnCardDiscountedPrice: null,
      isPaid: false,
      key: 'organizer',
      openRegistrationOffset: 168,
      organizingRegistration: true,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs' as const,
      roleIds: [],
      spots: 10,
      stripeTaxRateId: null,
      title: 'Organizer registration',
      transferDeadlineHoursBeforeStart: null,
    },
    {
      cancellationDeadlineHoursBeforeStart: 96,
      closeRegistrationOffset: 24,
      description: null,
      esnCardDiscountedPrice: null,
      isPaid: false,
      key: 'participant',
      openRegistrationOffset: 168,
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: false,
      registeredDescription: null,
      registrationMode: 'application' as const,
      roleIds: [],
      spots: 20,
      stripeTaxRateId: null,
      title: 'Participant registration',
      transferDeadlineHoursBeforeStart: 12,
    },
  ],
  simpleModeEnabled: true,
  title: 'Template',
};

const validGraphRecord = {
  ...validGraphInput,
  addOns: validGraphInput.addOns.map((addOn) => ({
    ...addOn,
    id: 'addon-1',
    registrationOptions: addOn.registrationOptions.map((option) => ({
      includedQuantity: option.includedQuantity,
      optionalPurchaseQuantity: option.optionalPurchaseQuantity,
      registrationOptionId: 'option-participant',
    })),
  })),
  id: 'template-1',
  questions: validGraphInput.questions.map((question) => ({
    ...question,
    id: 'question-1',
    registrationOptionId: 'option-participant',
  })),
  registrationOptions: validGraphInput.registrationOptions.map(
    ({ key: _key, ...option }, index) => ({
      ...option,
      id: index === 0 ? 'option-organizer' : 'option-participant',
      roleIds: [],
      roles: [],
    }),
  ),
};

describe('templates RPC graph schemas', () => {
  it('accepts the complete canonical write graph', () => {
    const decoded =
      Schema.decodeUnknownSync(TemplateGraphInput)(validGraphInput);

    expect(decoded.planningTips).toBe('Bring printed waiver forms.');
    expect(decoded.registrationOptions).toHaveLength(2);
    expect(decoded.addOns).toHaveLength(1);
    expect(decoded.questions).toHaveLength(1);
  });

  it('accepts structured locations in writes and records', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validGraphInput,
        location: validGoogleLocation,
      }),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphRecord)({
        ...validGraphRecord,
        location: validGoogleLocation,
      }),
    ).not.toThrow();
  });

  it('preserves nullable and explicit registration policy overrides', () => {
    const decoded =
      Schema.decodeUnknownSync(TemplateGraphInput)(validGraphInput);

    expect(decoded.registrationOptions[0]).toMatchObject({
      cancellationDeadlineHoursBeforeStart: null,
      refundFeesOnCancellation: null,
      transferDeadlineHoursBeforeStart: null,
    });
    expect(decoded.registrationOptions[1]).toMatchObject({
      cancellationDeadlineHoursBeforeStart: 96,
      refundFeesOnCancellation: false,
      transferDeadlineHoursBeforeStart: 12,
    });
  });

  it('rejects negative registration policy overrides', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validGraphInput,
        registrationOptions: validGraphInput.registrationOptions.map(
          (option) =>
            option.key === 'participant'
              ? { ...option, transferDeadlineHoursBeforeStart: -1 }
              : option,
        ),
      }),
    ).toThrow();
  });

  it('rejects malformed input and response locations', () => {
    const malformedLocation = {
      name: 'Broken Place',
      placeId: 'place-1',
      type: 'google',
    };

    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validGraphInput,
        location: malformedLocation,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphRecord)({
        ...validGraphRecord,
        location: malformedLocation,
      }),
    ).toThrow();
  });

  it('accepts a complete persisted graph record', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphRecord)(validGraphRecord),
    ).not.toThrow();
  });

  it('bounds add-on quantities and add-on type count', () => {
    const addOn = validGraphInput.addOns[0];
    if (!addOn) throw new Error('Missing add-on fixture');
    const atLimit = {
      ...validGraphInput,
      addOns: Array.from({ length: MAX_EVENT_ADDON_TYPES }, (_, index) => ({
        ...addOn,
        key: `addon-${index}`,
        maxQuantityPerUser: MAX_REGISTRATION_ADDON_QUANTITY,
        registrationOptions: [
          {
            includedQuantity: MAX_REGISTRATION_ADDON_QUANTITY,
            optionalPurchaseQuantity: 0,
            registrationOptionKey: 'participant',
          },
        ],
      })),
    };

    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)(atLimit),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...atLimit,
        addOns: [...atLimit.addOns, { ...addOn, key: 'addon-over-limit' }],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...atLimit,
        addOns: [
          {
            ...addOn,
            maxQuantityPerUser: MAX_REGISTRATION_ADDON_QUANTITY + 1,
          },
        ],
      }),
    ).toThrow();
  });

  it('bounds registration question count and text', () => {
    const question = validGraphInput.questions[0];
    if (!question) throw new Error('Missing question fixture');

    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validGraphInput,
        questions: Array.from(
          { length: MAX_REGISTRATION_QUESTIONS },
          (_, index) => ({
            ...question,
            description: 'd'.repeat(
              MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
            ),
            key: `question-${index}`,
            title: 't'.repeat(MAX_REGISTRATION_QUESTION_TITLE_LENGTH),
          }),
        ),
      }),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validGraphInput,
        questions: Array.from(
          { length: MAX_REGISTRATION_QUESTIONS + 1 },
          (_, index) => ({ ...question, key: `question-${index}` }),
        ),
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validGraphInput,
        questions: [
          {
            ...question,
            title: 't'.repeat(MAX_REGISTRATION_QUESTION_TITLE_LENGTH + 1),
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validGraphInput,
        questions: [
          {
            ...question,
            description: 'd'.repeat(
              MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH + 1,
            ),
          },
        ],
      }),
    ).toThrow();
  });
});
