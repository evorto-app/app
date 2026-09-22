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
  TemplateFindOneRecord,
  TemplateGraphInput,
  TemplateGraphRecord,
} from '../../../../../shared/rpc-contracts/app-rpcs/templates.rpcs';

const validTemplateGraphInput = {
  addOns: [],
  categoryId: 'category-1',
  description: '<p>Useful event template description</p>',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  location: null,
  planningTips: null,
  questions: [],
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
      registrationMode: 'fcfs',
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
      registrationMode: 'fcfs',
      roleIds: [],
      spots: 10,
      stripeTaxRateId: null,
      title: 'Participant registration',
      transferDeadlineHoursBeforeStart: 12,
    },
  ],
  simpleModeEnabled: true,
  title: 'Template',
} satisfies TemplateGraphInput;

const validTemplateGraphAddonInput = {
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
} satisfies TemplateGraphInput['addOns'][number];

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

const validTemplateGraphQuestionInput = {
  description: 'Tell organizers about accessibility needs.',
  key: 'accessibility',
  registrationOptionKey: 'participant',
  required: false,
  sortOrder: 0,
  title: 'Accessibility needs',
} satisfies TemplateGraphInput['questions'][number];

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
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validTemplateGraphInput,
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
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validTemplateGraphInput,
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
                includedQuantity: 1,
                optionalPurchaseQuantity: 1,
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

  it('accepts reusable add-ons in template graph writes', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validTemplateGraphInput,
        addOns: [validTemplateGraphAddonInput],
      }),
    ).not.toThrow();
  });

  it('accepts registration questions in template graph writes and find-one responses', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validTemplateGraphInput,
        questions: [validTemplateGraphQuestionInput],
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

  it('rejects malformed template input locations', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validTemplateGraphInput,
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

describe('templates RPC registration policy overrides', () => {
  it('accepts nullable or nonnegative template option overrides', () => {
    const decoded = Schema.decodeUnknownSync(TemplateGraphInput)(
      validTemplateGraphInput,
    );

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

  it('rejects negative template option deadline overrides', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...validTemplateGraphInput,
        registrationOptions: validTemplateGraphInput.registrationOptions.map(
          (option, index) =>
            index === 1
              ? { ...option, transferDeadlineHoursBeforeStart: -1 }
              : option,
        ),
      }),
    ).toThrow();
  });
});

describe('templates RPC full graph schemas', () => {
  const graphInput = {
    addOns: [],
    categoryId: 'category-1',
    description: '<p>Useful event template description</p>',
    icon: {
      iconColor: 0,
      iconName: 'calendar:fas',
    },
    location: null,
    planningTips: null,
    questions: [],
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
        registrationMode: 'fcfs',
        roleIds: [],
        spots: 10,
        stripeTaxRateId: null,
        title: 'Organizer registration',
        transferDeadlineHoursBeforeStart: null,
      },
      {
        cancellationDeadlineHoursBeforeStart: null,
        closeRegistrationOffset: 24,
        description: null,
        esnCardDiscountedPrice: null,
        isPaid: false,
        key: 'participant',
        openRegistrationOffset: 168,
        organizingRegistration: false,
        price: 0,
        refundFeesOnCancellation: null,
        registeredDescription: null,
        registrationMode: 'application',
        roleIds: [],
        spots: 20,
        stripeTaxRateId: null,
        title: 'Participant registration',
        transferDeadlineHoursBeforeStart: null,
      },
    ],
    simpleModeEnabled: true,
    title: 'Template',
  } as const;

  it('accepts a writable ordinary tenant template graph', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)(graphInput),
    ).not.toThrow();
  });

  it('rejects retired random allocation in stored records and graph writes', () => {
    const persistedRecord = {
      ...validTemplateFindOneRecord,
      registrationOptions: [
        {
          cancellationDeadlineHoursBeforeStart: null,
          closeRegistrationOffset: 24,
          description: null,
          esnCardDiscountedPrice: null,
          id: 'option-1',
          isPaid: false,
          openRegistrationOffset: 168,
          organizingRegistration: false,
          price: 0,
          refundFeesOnCancellation: null,
          registeredDescription: null,
          registrationMode: 'random',
          roleIds: [],
          roles: [],
          spots: 20,
          stripeTaxRateId: null,
          title: 'Legacy random registration',
          transferDeadlineHoursBeforeStart: null,
        },
      ],
      simpleModeEnabled: false,
    };

    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphRecord)(persistedRecord),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...graphInput,
        registrationOptions: graphInput.registrationOptions.map(
          (option, index) =>
            index === 1 ? { ...option, registrationMode: 'random' } : option,
        ),
      }),
    ).toThrow();
  });

  it('rejects template structures beyond the supported registration limits', () => {
    const addOn = {
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: true,
      allowPurchaseDuringRegistration: true,
      description: null,
      isPaid: false,
      key: 'addon-1',
      maxQuantityPerUser: 1,
      price: 0,
      registrationOptions: [],
      stripeTaxRateId: null,
      title: 'Equipment',
      totalAvailableQuantity: 10,
    };

    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...graphInput,
        addOns: Array.from(
          { length: MAX_EVENT_ADDON_TYPES + 1 },
          (_, index) => ({ ...addOn, key: `addon-${index}` }),
        ),
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...graphInput,
        addOns: [
          {
            ...addOn,
            maxQuantityPerUser: MAX_REGISTRATION_ADDON_QUANTITY + 1,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplateGraphInput)({
        ...graphInput,
        questions: [
          {
            description: null,
            key: 'question-1',
            registrationOptionKey: 'participant',
            required: false,
            sortOrder: 0,
            title: 'q'.repeat(MAX_REGISTRATION_QUESTION_TITLE_LENGTH + 1),
          },
        ],
      }),
    ).toThrow();
  });
});

describe('template graph input bounds', () => {
  it('accepts exact graph collection and raw question text caps and rejects cap plus one', () => {
    const question = {
      ...validTemplateGraphQuestionInput,
      description: 'd'.repeat(MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH),
      title: 't'.repeat(MAX_REGISTRATION_QUESTION_TITLE_LENGTH),
    };
    const decode = Schema.decodeUnknownSync(TemplateGraphInput);
    expect(() => decode(validTemplateGraphInput)).not.toThrow();
    expect(() =>
      decode({
        ...validTemplateGraphInput,
        addOns: Array.from({ length: MAX_EVENT_ADDON_TYPES }, (_, index) => ({
          ...validTemplateGraphAddonInput,
          key: `addon-${index}`,
        })),
        questions: Array.from(
          { length: MAX_REGISTRATION_QUESTIONS },
          (_, index) => ({
            ...question,
            key: `question-${index}`,
            sortOrder: index,
          }),
        ),
      }),
    ).not.toThrow();
    expect(() =>
      decode({
        ...validTemplateGraphInput,
        addOns: Array.from(
          { length: MAX_EVENT_ADDON_TYPES + 1 },
          (_, index) => ({
            ...validTemplateGraphAddonInput,
            key: `addon-${index}`,
          }),
        ),
      }),
    ).toThrow();
    expect(() =>
      decode({
        ...validTemplateGraphInput,
        questions: Array.from(
          { length: MAX_REGISTRATION_QUESTIONS + 1 },
          (_, index) => ({
            ...question,
            key: `question-${index}`,
            sortOrder: index,
          }),
        ),
      }),
    ).toThrow();
    expect(() =>
      decode({
        ...validTemplateGraphInput,
        questions: [{ ...question, title: ` ${question.title}` }],
      }),
    ).toThrow();
    expect(() =>
      decode({
        ...validTemplateGraphInput,
        questions: [{ ...question, description: `${question.description} ` }],
      }),
    ).toThrow();
  });

  it('accepts zero mapped quantities and rejects invalid graph add-on quantities', () => {
    const decode = Schema.decodeUnknownSync(TemplateGraphInput);
    expect(() =>
      decode({
        ...validTemplateGraphInput,
        addOns: [
          {
            ...validTemplateGraphAddonInput,
            maxQuantityPerUser: MAX_REGISTRATION_ADDON_QUANTITY,
            registrationOptions: [
              {
                includedQuantity: 0,
                optionalPurchaseQuantity: 0,
                registrationOptionKey: 'participant',
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
    for (const quantity of [
      -1,
      0.5,
      Infinity,
      NaN,
      MAX_REGISTRATION_ADDON_QUANTITY + 1,
    ]) {
      expect(() =>
        decode({
          ...validTemplateGraphInput,
          addOns: [
            {
              ...validTemplateGraphAddonInput,
              registrationOptions:
                validTemplateGraphAddonInput.registrationOptions.map(
                  (option) => ({ ...option, includedQuantity: quantity }),
                ),
            },
          ],
        }),
      ).toThrow();
      expect(() =>
        decode({
          ...validTemplateGraphInput,
          addOns: [
            {
              ...validTemplateGraphAddonInput,
              registrationOptions:
                validTemplateGraphAddonInput.registrationOptions.map(
                  (option) => ({
                    ...option,
                    optionalPurchaseQuantity: quantity,
                  }),
                ),
            },
          ],
        }),
      ).toThrow();
      expect(() =>
        decode({
          ...validTemplateGraphInput,
          addOns: [
            { ...validTemplateGraphAddonInput, maxQuantityPerUser: quantity },
          ],
        }),
      ).toThrow();
    }
  });
});
