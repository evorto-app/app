import type { TemplateGraphInput } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { describe, expect, it } from '@effect/vitest';

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
