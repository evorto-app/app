import '@angular/compiler';

import type { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import {
  platformTemplateFormToPayload,
  platformTemplateRecordToFormModel,
} from './platform-template-editor.component';

const completeTemplate = (): TemplateGraphRecord => ({
  addOns: [
    {
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: true,
      allowPurchaseDuringRegistration: false,
      description: 'Add-on description',
      id: 'addon-1',
      isPaid: true,
      maxQuantityPerUser: 3,
      price: 450,
      registrationOptions: [
        {
          includedQuantity: 2,
          optionalPurchaseQuantity: 0,
          registrationOptionId: 'organizer-option',
        },
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 1,
          registrationOptionId: 'participant-option',
        },
      ],
      stripeTaxRateId: 'txr-addon',
      title: 'Dinner',
      totalAvailableQuantity: 40,
    },
  ],
  categoryId: 'category-1',
  description: '<p>Template description</p>',
  icon: { iconColor: 4, iconName: 'campground:fas' },
  id: 'template-1',
  location: {
    address: 'Main Street 1',
    coordinates: { lat: 52.1, lng: 4.3 },
    name: 'Student Center',
    placeId: 'google-place-1',
    type: 'google',
  },
  planningTips: 'Bring the banner',
  questions: [
    {
      description: 'Dietary needs',
      id: 'question-1',
      registrationOptionId: 'participant-option',
      required: true,
      sortOrder: 2,
      title: 'Do you have dietary requirements?',
    },
  ],
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: 48,
      closeRegistrationOffset: 12,
      description: 'Organizer description',
      esnCardDiscountedPrice: 800,
      id: 'organizer-option',
      isPaid: true,
      openRegistrationOffset: 240,
      organizingRegistration: true,
      price: 1000,
      refundFeesOnCancellation: false,
      registeredDescription: 'Organizer confirmation',
      registrationMode: 'application',
      roleIds: ['organizer-role'],
      roles: [{ id: 'organizer-role', name: 'Organizer' }],
      spots: 5,
      stripeTaxRateId: 'txr-organizer',
      title: 'Organizers',
      transferDeadlineHoursBeforeStart: 72,
    },
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 2,
      description: null,
      esnCardDiscountedPrice: null,
      id: 'participant-option',
      isPaid: false,
      openRegistrationOffset: 168,
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs',
      roleIds: ['member-role'],
      roles: [{ id: 'member-role', name: 'Member' }],
      spots: 30,
      stripeTaxRateId: null,
      title: 'Participants',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  simpleModeEnabled: false,
  title: 'Weekend trip',
  unlisted: true,
});

describe('platform template editor graph mapping', () => {
  it('round-trips every supported mode and multi-option add-on mapping', () => {
    const loadResult = platformTemplateRecordToFormModel(completeTemplate());

    expect('model' in loadResult).toBe(true);
    if (!('model' in loadResult)) return;
    expect(loadResult.model.registrationOptions[1]?.registrationMode).toBe(
      'fcfs',
    );
    expect(loadResult.model.addOns[0]?.registrationOptions).toEqual([
      {
        includedQuantity: 2,
        optionalPurchaseQuantity: 0,
        registrationOptionKey: 'organizer-option',
      },
      {
        includedQuantity: 0,
        optionalPurchaseQuantity: 1,
        registrationOptionKey: 'participant-option',
      },
    ]);

    const payload = platformTemplateFormToPayload(loadResult.model, true);

    expect(payload.registrationOptions).toEqual([
      {
        cancellationDeadlineHoursBeforeStart: 48,
        closeRegistrationOffset: 12,
        description: 'Organizer description',
        esnCardDiscountedPrice: 800,
        id: 'organizer-option',
        isPaid: true,
        key: 'organizer-option',
        openRegistrationOffset: 240,
        organizingRegistration: true,
        price: 1000,
        refundFeesOnCancellation: false,
        registeredDescription: 'Organizer confirmation',
        registrationMode: 'application',
        roleIds: ['organizer-role'],
        spots: 5,
        stripeTaxRateId: 'txr-organizer',
        title: 'Organizers',
        transferDeadlineHoursBeforeStart: 72,
      },
      {
        cancellationDeadlineHoursBeforeStart: null,
        closeRegistrationOffset: 2,
        description: null,
        esnCardDiscountedPrice: null,
        id: 'participant-option',
        isPaid: false,
        key: 'participant-option',
        openRegistrationOffset: 168,
        organizingRegistration: false,
        price: 0,
        refundFeesOnCancellation: null,
        registeredDescription: null,
        registrationMode: 'fcfs',
        roleIds: ['member-role'],
        spots: 30,
        stripeTaxRateId: null,
        title: 'Participants',
        transferDeadlineHoursBeforeStart: null,
      },
    ]);
    expect(payload.addOns[0]).toEqual({
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: true,
      allowPurchaseDuringRegistration: false,
      description: 'Add-on description',
      id: 'addon-1',
      isPaid: true,
      key: 'addon-1',
      maxQuantityPerUser: 3,
      price: 450,
      registrationOptions: [
        {
          includedQuantity: 2,
          optionalPurchaseQuantity: 0,
          registrationOptionKey: 'organizer-option',
        },
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 1,
          registrationOptionKey: 'participant-option',
        },
      ],
      stripeTaxRateId: 'txr-addon',
      title: 'Dinner',
      totalAvailableQuantity: 40,
    });
    expect(payload.questions[0]).toEqual({
      description: 'Dietary needs',
      id: 'question-1',
      key: 'question-1',
      registrationOptionKey: 'participant-option',
      required: true,
      sortOrder: 2,
      title: 'Do you have dietary requirements?',
    });
    expect({
      categoryId: payload.categoryId,
      description: payload.description,
      icon: payload.icon,
      planningTips: payload.planningTips,
      simpleModeEnabled: payload.simpleModeEnabled,
      title: payload.title,
      unlisted: payload.unlisted,
    }).toEqual({
      categoryId: 'category-1',
      description: '<p>Template description</p>',
      icon: { iconColor: 4, iconName: 'campground:fas' },
      planningTips: 'Bring the banner',
      simpleModeEnabled: false,
      title: 'Weekend trip',
      unlisted: true,
    });
  });

  it('blocks legacy random templates with an explicit deferred-mode error', () => {
    const source = completeTemplate();
    const legacyRandomTemplate: TemplateGraphRecord = {
      ...source,
      registrationOptions: source.registrationOptions.map((option, index) =>
        index === 1 ? { ...option, registrationMode: 'random' } : option,
      ),
    };

    expect(platformTemplateRecordToFormModel(legacyRandomTemplate)).toEqual({
      error:
        'This template uses random allocation, which is deferred and unsupported for the relaunch. It remains readable but cannot be edited here.',
    });
  });

  it('fails only when a persisted graph reference is genuinely corrupt', () => {
    const source = completeTemplate();
    const corrupt: TemplateGraphRecord = {
      ...source,
      questions: source.questions.map((question) => ({
        ...question,
        registrationOptionId: 'missing-option',
      })),
    };

    expect(platformTemplateRecordToFormModel(corrupt)).toEqual({
      error:
        'This template graph contains a registration-option reference that does not belong to the template.',
    });
  });
});
