import type {
  TemplateGraphInput,
  TemplateGraphRecord,
} from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { describe, expect, it } from '@effect/vitest';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';

import { validateTemplateGraphStructure } from './template-graph.service';

type MutableFixture<T> = { -readonly [Key in keyof T]: MutableFixture<T[Key]> };

const validGraph = (): MutableFixture<TemplateGraphInput> => ({
  addOns: [
    {
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      description: null,
      isPaid: false,
      key: 'addon-key',
      maxQuantityPerUser: 2,
      price: 0,
      registrationOptions: [
        {
          includedQuantity: 1,
          optionalPurchaseQuantity: 1,
          registrationOptionKey: 'organizer-key',
        },
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 2,
          registrationOptionKey: 'participant-key',
        },
      ],
      stripeTaxRateId: null,
      title: 'Shared add-on',
      totalAvailableQuantity: 10,
    },
  ],
  categoryId: 'category-1',
  description: '<p>Complete template graph</p>',
  icon: { iconColor: 0, iconName: 'calendar:fas' },
  location: null,
  planningTips: null,
  questions: [
    {
      description: null,
      key: 'question-key',
      registrationOptionKey: 'participant-key',
      required: true,
      sortOrder: 0,
      title: 'Question',
    },
  ],
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 24,
      description: null,
      esnCardDiscountedPrice: null,
      isPaid: false,
      key: 'organizer-key',
      openRegistrationOffset: 168,
      organizingRegistration: true,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'application',
      roleIds: ['organizer-role'],
      spots: 5,
      stripeTaxRateId: null,
      title: 'Organizers',
      transferDeadlineHoursBeforeStart: null,
    },
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 12,
      description: null,
      esnCardDiscountedPrice: null,
      isPaid: false,
      key: 'participant-key',
      openRegistrationOffset: 240,
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs',
      roleIds: ['participant-role'],
      spots: 30,
      stripeTaxRateId: null,
      title: 'Participants',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  simpleModeEnabled: false,
  title: 'Advanced template',
  unlisted: false,
});

const persistedGraph = (
  simpleModeEnabled: boolean,
): MutableFixture<TemplateGraphRecord> => {
  const source = validGraph();
  return {
    ...source,
    addOns: [],
    id: 'template-1',
    questions: [],
    registrationOptions: source.registrationOptions.map((option, index) => {
      const { key: _key, ...record } = option;
      return {
        ...record,
        id: index === 0 ? 'option-organizer' : 'option-participant',
        roles: record.roleIds.map((id) => ({ id, name: id })),
      };
    }),
    simpleModeEnabled,
  };
};

const updateInputFrom = (
  before: TemplateGraphRecord,
): MutableFixture<TemplateGraphInput> => ({
  ...validGraph(),
  addOns: [],
  questions: [],
  registrationOptions: before.registrationOptions.map((option) => {
    const { roles: _roles, ...record } = option;
    return {
      ...record,
      key: option.id,
      registrationMode:
        option.registrationMode === 'random' ? 'fcfs' : option.registrationMode,
      roleIds: [...option.roleIds],
    };
  }),
  simpleModeEnabled: before.simpleModeEnabled,
});

describe('TemplateGraphService structural validation', () => {
  it('accepts supported modes and multi-option add-on mappings', () => {
    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input: validGraph(),
      }),
    ).toBeNull();
  });

  it('rejects random allocation even when an untrusted caller bypasses RPC decoding', () => {
    const source = validGraph();
    const input = {
      ...source,
      registrationOptions: source.registrationOptions.map((option, index) =>
        index === 1 ? { ...option, registrationMode: 'random' } : option,
      ),
    };

    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input,
      }),
    ).toMatchObject({
      reason: 'unsupportedTemplateRegistrationMode',
    });
  });

  it('keeps a persisted legacy random template read-only when the payload changes it to fcfs', () => {
    const before = persistedGraph(false);
    before.registrationOptions = before.registrationOptions.map(
      (option, index) =>
        index === 1 ? { ...option, registrationMode: 'random' } : option,
    );
    const input = updateInputFrom(before);

    expect(
      input.registrationOptions.map((option) => option.registrationMode),
    ).not.toContain('random');
    const error = validateTemplateGraphStructure({
      before,
      esnCardEnabled: false,
      input,
    });

    expect(error).toBeInstanceOf(RpcBadRequestError);
    expect(error).toMatchObject({
      _tag: 'RpcBadRequestError',
      reason: 'unsupportedTemplateRegistrationMode',
    });
  });

  it('accepts simple mode only with one organizer and one participant option', () => {
    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input: { ...validGraph(), simpleModeEnabled: true },
      }),
    ).toBeNull();

    const source = validGraph();
    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input: {
          ...source,
          registrationOptions: source.registrationOptions.map((option) => ({
            ...option,
            organizingRegistration: true,
          })),
          simpleModeEnabled: true,
        },
      }),
    ).toMatchObject({
      reason: 'invalidSimpleTemplateConfiguration',
    });
  });

  it('rejects an advanced-to-simple transition until the graph has exactly one option in each category', () => {
    const source = validGraph();

    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input: {
          ...source,
          registrationOptions: source.registrationOptions.slice(0, 1),
          simpleModeEnabled: true,
        },
      }),
    ).toMatchObject({
      reason: 'invalidSimpleTemplateConfiguration',
    });
  });

  it('allows extra advanced choices to be removed while switching to simple setup in one save', () => {
    const before = persistedGraph(false);
    const participant = before.registrationOptions[1];
    if (!participant) throw new Error('Missing participant fixture');
    before.registrationOptions = [
      ...before.registrationOptions,
      { ...participant, id: 'option-guest', title: 'Guest' },
    ];
    const input = updateInputFrom(before);
    input.registrationOptions = input.registrationOptions.filter(
      (option) => option.id !== 'option-guest',
    );
    input.simpleModeEnabled = true;

    expect(
      validateTemplateGraphStructure({ before, esnCardEnabled: false, input }),
    ).toBeNull();
  });

  it('allows choices to be replaced while switching to advanced setup in one save', () => {
    const before = persistedGraph(true);
    const input = updateInputFrom(before);
    input.simpleModeEnabled = false;
    input.registrationOptions = input.registrationOptions.map((option) => ({
      ...option,
      id: undefined,
    }));

    expect(
      validateTemplateGraphStructure({ before, esnCardEnabled: false, input }),
    ).toBeNull();
  });

  it('allows a persisted two-option advanced template to switch to simple without replacing IDs', () => {
    const before = persistedGraph(false);
    const input = updateInputFrom(before);
    input.simpleModeEnabled = true;

    expect(
      validateTemplateGraphStructure({ before, esnCardEnabled: false, input }),
    ).toBeNull();
  });

  it('allows advanced operational templates with no registration options', () => {
    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input: {
          ...validGraph(),
          addOns: [],
          questions: [],
          registrationOptions: [],
          simpleModeEnabled: false,
        },
      }),
    ).toBeNull();
  });

  it('rejects an oversubscribed add-on against every mapped quantity', () => {
    const source = validGraph();
    const input: TemplateGraphInput = {
      ...source,
      addOns: source.addOns.map((addOn) => ({
        ...addOn,
        totalAvailableQuantity: 1,
      })),
    };

    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input,
      }),
    ).toMatchObject({
      reason: 'invalidTemplateAddon',
    });
  });

  it('rejects a paid registration option with a zero price as a typed bad request', () => {
    const source = validGraph();
    const input: TemplateGraphInput = {
      ...source,
      registrationOptions: source.registrationOptions.map((option, index) =>
        index === 1 ? { ...option, isPaid: true, price: 0 } : option,
      ),
    };

    const error = validateTemplateGraphStructure({
      esnCardEnabled: false,
      input,
    });

    expect(error).toBeInstanceOf(RpcBadRequestError);
    expect(error).toMatchObject({
      _tag: 'RpcBadRequestError',
      reason: 'paidTemplateRegistrationOptionRequiresPositivePrice',
    });
  });

  it('rejects a paid add-on with a zero price as a typed bad request', () => {
    const source = validGraph();
    const input: TemplateGraphInput = {
      ...source,
      addOns: source.addOns.map((addOn) => ({
        ...addOn,
        isPaid: true,
        price: 0,
      })),
    };

    const error = validateTemplateGraphStructure({
      esnCardEnabled: false,
      input,
    });

    expect(error).toBeInstanceOf(RpcBadRequestError);
    expect(error).toMatchObject({
      _tag: 'RpcBadRequestError',
      reason: 'paidTemplateAddonRequiresPositivePrice',
    });
  });

  it('rejects dangling and duplicate graph references', () => {
    const source = validGraph();
    const input: TemplateGraphInput = {
      ...source,
      addOns: source.addOns.map((addOn) => ({
        ...addOn,
        registrationOptions: [
          {
            includedQuantity: 0,
            optionalPurchaseQuantity: 1,
            registrationOptionKey: 'missing-option',
          },
        ],
      })),
    };

    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input,
      }),
    ).toMatchObject({
      reason: 'invalidTemplateAddon',
    });
  });

  it('accepts the add-on type cap and rejects cap plus one', () => {
    const input = validGraph();
    const addOn = input.addOns[0];
    if (!addOn) throw new Error('Missing add-on fixture');
    input.addOns = Array.from(
      { length: MAX_EVENT_ADDON_TYPES },
      (_, index) => ({
        ...addOn,
        key: `addon-${index}`,
      }),
    );

    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input,
      }),
    ).toBeNull();
    input.addOns.push({ ...addOn, key: 'addon-over-limit' });
    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input,
      }),
    ).toMatchObject({ reason: 'templateAddonTypeLimitExceeded' });
  });

  it('rejects a mapped add-on quantity above the per-registration cap', () => {
    const input = validGraph();
    const addOn = input.addOns[0];
    if (!addOn) throw new Error('Missing add-on fixture');
    addOn.maxQuantityPerUser = MAX_REGISTRATION_ADDON_QUANTITY;
    addOn.registrationOptions = [
      {
        includedQuantity: MAX_REGISTRATION_ADDON_QUANTITY,
        optionalPurchaseQuantity: 1,
        registrationOptionKey: 'participant-key',
      },
    ];

    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input,
      }),
    ).toMatchObject({ reason: 'invalidTemplateAddon' });
  });
});

describe('template question input bounds', () => {
  it('accepts exact count and raw text caps and rejects cap plus one', () => {
    const input = validGraph();
    const question = {
      ...input.questions[0],
      description: 'd'.repeat(MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH),
      title: 't'.repeat(MAX_REGISTRATION_QUESTION_TITLE_LENGTH),
    };
    const questions = Array.from(
      { length: MAX_REGISTRATION_QUESTIONS },
      (_, index) => ({ ...question, key: `question-${index}` }),
    );
    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input: { ...input, questions },
      }),
    ).toBeNull();
    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input: {
          ...input,
          questions: [...questions, { ...question, key: 'question-overflow' }],
        },
      }),
    ).toBeInstanceOf(RpcBadRequestError);
    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input: {
          ...input,
          questions: [{ ...question, title: ` ${question.title}` }],
        },
      }),
    ).toBeInstanceOf(RpcBadRequestError);
    expect(
      validateTemplateGraphStructure({
        esnCardEnabled: false,
        input: {
          ...input,
          questions: [{ ...question, description: `${question.description} ` }],
        },
      }),
    ).toBeInstanceOf(RpcBadRequestError);
  });
});
