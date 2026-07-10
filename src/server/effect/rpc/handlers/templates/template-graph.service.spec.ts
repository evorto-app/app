import type {
  TemplateGraphInput,
  TemplateGraphRecord,
} from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { describe, expect, it } from '@effect/vitest';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';

import { validateTemplateGraphStructure } from './template-graph.service';

const validGraph = (): TemplateGraphInput => ({
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

const persistedGraph = (simpleModeEnabled: boolean): TemplateGraphRecord => {
  const source = validGraph();
  return {
    ...source,
    addOns: [],
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

const updateInputFrom = (before: TemplateGraphRecord): TemplateGraphInput => ({
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
      input.registrationOptions.every(
        (option) => option.registrationMode !== 'random',
      ),
    ).toBe(true);
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

  it('requires the persisted advanced template to have the simple shape before conversion', () => {
    const before = persistedGraph(false);
    const participant = before.registrationOptions[1];
    if (!participant) throw new Error('Missing participant fixture');
    before.registrationOptions = [
      ...before.registrationOptions,
      { ...participant, id: 'option-guest', title: 'Guest' },
    ];
    const input = updateInputFrom(before);
    input.simpleModeEnabled = true;

    expect(
      validateTemplateGraphStructure({ before, esnCardEnabled: false, input }),
    ).toMatchObject({
      reason: 'templateAdvancedToSimpleRequiresPersistedSimpleShape',
    });
  });

  it('preserves every persisted option ID when changing template mode', () => {
    const before = persistedGraph(true);
    const input = updateInputFrom(before);
    input.simpleModeEnabled = false;
    input.registrationOptions = input.registrationOptions.map((option) => ({
      ...option,
      id: undefined,
    }));

    expect(
      validateTemplateGraphStructure({ before, esnCardEnabled: false, input }),
    ).toMatchObject({
      reason: 'templateModeTransitionMustPreserveOptionIds',
    });

    input.registrationOptions = updateInputFrom(before).registrationOptions;
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
});
