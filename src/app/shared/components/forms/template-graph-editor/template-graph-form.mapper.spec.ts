import type { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import {
  classifyTemplateGraphRecord,
  legacyRandomTemplateEditMessage,
  templateGraphRecordToFormModel,
} from './template-graph-form.mapper';

const registrationOption = ({
  id,
  organizingRegistration,
}: {
  id: string;
  organizingRegistration: boolean;
}): TemplateGraphRecord['registrationOptions'][number] => ({
  cancellationDeadlineHoursBeforeStart: null,
  closeRegistrationOffset: 1,
  description: null,
  esnCardDiscountedPrice: null,
  id,
  isPaid: false,
  openRegistrationOffset: 168,
  organizingRegistration,
  price: 0,
  refundFeesOnCancellation: null,
  registeredDescription: null,
  registrationMode: 'fcfs',
  roleIds: [`role-${id}`],
  roles: [{ id: `role-${id}`, name: `Role ${id}` }],
  spots: organizingRegistration ? 1 : 20,
  stripeTaxRateId: null,
  title: organizingRegistration ? 'Organizers' : 'Participants',
  transferDeadlineHoursBeforeStart: null,
});

const simpleTemplate = (): TemplateGraphRecord => ({
  addOns: [
    {
      allowMultiple: false,
      allowPurchaseBeforeEvent: false,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      description: null,
      id: 'addon-1',
      isPaid: false,
      maxQuantityPerUser: 1,
      price: 0,
      registrationOptions: [
        {
          includedQuantity: 1,
          optionalPurchaseQuantity: 0,
          registrationOptionId: 'participant-option',
        },
      ],
      stripeTaxRateId: null,
      title: 'Lunch',
      totalAvailableQuantity: 20,
    },
  ],
  categoryId: 'category-1',
  description: 'Template description',
  icon: { iconColor: 0, iconName: 'calendar:fas' },
  id: 'template-1',
  location: null,
  planningTips: null,
  questions: [
    {
      description: null,
      id: 'question-1',
      registrationOptionId: 'participant-option',
      required: true,
      sortOrder: 0,
      title: 'Dietary requirements?',
    },
  ],
  registrationOptions: [
    registrationOption({
      id: 'organizer-option',
      organizingRegistration: true,
    }),
    registrationOption({
      id: 'participant-option',
      organizingRegistration: false,
    }),
  ],
  simpleModeEnabled: true,
  title: 'Simple template',
  unlisted: false,
});

describe('template graph edit classification', () => {
  it('requires exactly one organizer and one non-organizer option for simple compatibility', () => {
    expect(classifyTemplateGraphRecord(simpleTemplate())).toEqual({
      kind: 'simpleCompatible',
    });

    const source = simpleTemplate();
    expect(
      classifyTemplateGraphRecord({
        ...source,
        registrationOptions: source.registrationOptions.map((option) => ({
          ...option,
          organizingRegistration: true,
        })),
      }),
    ).toEqual({
      kind: 'advancedCompatible',
      reasons: ['registrationOptionKinds'],
    });

    expect(
      classifyTemplateGraphRecord({
        ...source,
        registrationOptions: source.registrationOptions.slice(0, 1),
      }),
    ).toEqual({
      kind: 'advancedCompatible',
      reasons: ['registrationOptionCount', 'registrationOptionKinds'],
    });
  });

  it('preserves multi-mapped add-ons without blocking simple compatibility', () => {
    const source = simpleTemplate();
    const [addOn] = source.addOns;
    if (!addOn) throw new Error('Expected the add-on fixture');
    const multiMapped: TemplateGraphRecord = {
      ...source,
      addOns: [
        {
          ...addOn,
          registrationOptions: [
            ...addOn.registrationOptions,
            {
              includedQuantity: 0,
              optionalPurchaseQuantity: 1,
              registrationOptionId: 'organizer-option',
            },
          ],
        },
      ],
    };

    expect(classifyTemplateGraphRecord(multiMapped)).toEqual({
      kind: 'simpleCompatible',
    });
    const formResult = templateGraphRecordToFormModel(multiMapped);
    expect('model' in formResult).toBe(true);
    if (!('model' in formResult)) return;
    expect(formResult.model.addOns[0]?.registrationOptions).toEqual([
      {
        includedQuantity: 1,
        optionalPurchaseQuantity: 0,
        registrationOptionKey: 'participant-option',
      },
      {
        includedQuantity: 0,
        optionalPurchaseQuantity: 1,
        registrationOptionKey: 'organizer-option',
      },
    ]);
  });

  it('blocks a legacy random graph before constructing an editable form', () => {
    const source = simpleTemplate();
    const legacyRandom: TemplateGraphRecord = {
      ...source,
      registrationOptions: source.registrationOptions.map((option, index) =>
        index === 1 ? { ...option, registrationMode: 'random' } : option,
      ),
    };

    expect(classifyTemplateGraphRecord(legacyRandom)).toEqual({
      kind: 'legacyRandomBlocked',
      message: legacyRandomTemplateEditMessage,
    });
    expect(templateGraphRecordToFormModel(legacyRandom)).toEqual({
      error: legacyRandomTemplateEditMessage,
    });
  });
});
