import type { WritableRegistrationMode } from '@shared/registration-modes';
import type {
  TemplateGraphInput,
  TemplateGraphRecord,
} from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import type { EventLocationType } from '../../../../../types/location';

import {
  createTemplateGraphLocationFormModel,
  type TemplateGraphFormModel,
  type TemplateGraphLocationFormModel,
  type TemplateGraphNullableNumberField,
  type TemplateGraphRefundFeesChoice,
  type TemplateGraphRegistrationOptionFormModel,
} from './template-graph-form.model';

export const legacyRandomTemplateEditMessage =
  'Random allocation is unavailable. Create a new template using First come, first served or Manual approval instead.';

export type TemplateGraphAdvancedCompatibilityReason =
  'registrationOptionCount' | 'registrationOptionKinds';

export type TemplateGraphEditClassification =
  | {
      kind: 'advancedCompatible';
      reasons: readonly TemplateGraphAdvancedCompatibilityReason[];
    }
  | { kind: 'legacyRandomBlocked'; message: string }
  | { kind: 'simpleCompatible' };

export type TemplateGraphFormLoadResult =
  { error: string } | { model: TemplateGraphFormModel };
type TemplateGraphRegistrationOptionRecord =
  TemplateGraphRecord['registrationOptions'][number];

type WritableTemplateGraphRegistrationOptionRecord = Omit<
  TemplateGraphRegistrationOptionRecord,
  'registrationMode'
> & {
  registrationMode: WritableRegistrationMode;
};

export const isSimpleCompatibleRegistrationOptions = (
  options: readonly { organizingRegistration: boolean }[],
): boolean =>
  options.length === 2 &&
  options.filter((option) => option.organizingRegistration).length === 1;

export const classifyTemplateGraphRecord = (
  template: TemplateGraphRecord,
): TemplateGraphEditClassification => {
  if (
    template.registrationOptions.some(
      (option) => option.registrationMode === 'random',
    )
  ) {
    return {
      kind: 'legacyRandomBlocked',
      message: legacyRandomTemplateEditMessage,
    };
  }

  const reasons = new Set<TemplateGraphAdvancedCompatibilityReason>();
  if (template.registrationOptions.length !== 2) {
    reasons.add('registrationOptionCount');
  }

  const organizerOptionCount = template.registrationOptions.filter(
    (option) => option.organizingRegistration,
  ).length;
  const participantOptionCount =
    template.registrationOptions.length - organizerOptionCount;
  if (organizerOptionCount !== 1 || participantOptionCount !== 1) {
    reasons.add('registrationOptionKinds');
  }

  return reasons.size === 0
    ? { kind: 'simpleCompatible' }
    : { kind: 'advancedCompatible', reasons: [...reasons] };
};

const refundFeesChoice = (
  value: boolean | null,
): TemplateGraphRefundFeesChoice => {
  if (value === null) return 'default';
  return value ? 'refund' : 'doNotRefund';
};

export const templateGraphLocationValueToFormModel = (
  location: EventLocationType | null,
): TemplateGraphLocationFormModel => {
  if (!location) return createTemplateGraphLocationFormModel();

  switch (location.type) {
    case 'coordinate': {
      return {
        ...createTemplateGraphLocationFormModel(),
        address: location.address ?? '',
        latitude: location.coordinates.lat,
        longitude: location.coordinates.lng,
        name: location.name,
        type: 'coordinate',
      };
    }
    case 'google': {
      return {
        ...createTemplateGraphLocationFormModel(),
        address: location.address ?? '',
        latitude: location.coordinates.lat,
        longitude: location.coordinates.lng,
        name: location.name,
        placeId: location.placeId,
        type: 'google',
      };
    }
    case 'online': {
      return {
        ...createTemplateGraphLocationFormModel(),
        meetingInstructions: location.meetingInstructions ?? '',
        meetingProvider: location.meetingProvider,
        meetingUrl: location.meetingUrl,
        name: location.name,
        type: 'online',
      };
    }
  }
};

const registrationRecordToFormModel = (
  registration: WritableTemplateGraphRegistrationOptionRecord,
): TemplateGraphRegistrationOptionFormModel => ({
  cancellationDeadlineHoursBeforeStart:
    registration.cancellationDeadlineHoursBeforeStart ?? '',
  closeRegistrationOffset: registration.closeRegistrationOffset,
  description: registration.description ?? '',
  esnCardDiscountedPrice: registration.esnCardDiscountedPrice ?? '',
  id: registration.id,
  isPaid: registration.isPaid,
  key: registration.id,
  openRegistrationOffset: registration.openRegistrationOffset,
  organizingRegistration: registration.organizingRegistration,
  price: registration.price,
  refundFeesOnCancellation: refundFeesChoice(
    registration.refundFeesOnCancellation,
  ),
  registeredDescription: registration.registeredDescription ?? '',
  registrationMode: registration.registrationMode,
  roleIds: [...registration.roleIds],
  spots: registration.spots,
  stripeTaxRateId: registration.stripeTaxRateId ?? '',
  title: registration.title,
  transferDeadlineHoursBeforeStart:
    registration.transferDeadlineHoursBeforeStart ?? '',
});

export const templateGraphRecordToFormModel = (
  template: TemplateGraphRecord,
): TemplateGraphFormLoadResult => {
  const classification = classifyTemplateGraphRecord(template);
  if (classification.kind === 'legacyRandomBlocked') {
    return { error: classification.message };
  }

  const registrationOptionIds = new Set(
    template.registrationOptions.map((option) => option.id),
  );
  const invalidReference =
    template.addOns.some((addOn) =>
      addOn.registrationOptions.some(
        (mapping) => !registrationOptionIds.has(mapping.registrationOptionId),
      ),
    ) ||
    template.questions.some(
      (question) => !registrationOptionIds.has(question.registrationOptionId),
    );
  if (invalidReference) {
    return {
      error:
        'This template graph contains a registration-option reference that does not belong to the template.',
    };
  }

  const writableRegistrationOptions = template.registrationOptions.filter(
    (option): option is WritableTemplateGraphRegistrationOptionRecord =>
      option.registrationMode !== 'random',
  );

  return {
    model: {
      addOns: template.addOns.map((addOn) => ({
        allowMultiple: addOn.allowMultiple,
        allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
        allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
        allowPurchaseDuringRegistration: addOn.allowPurchaseDuringRegistration,
        description: addOn.description ?? '',
        id: addOn.id,
        isPaid: addOn.isPaid,
        key: addOn.id,
        maxQuantityPerUser: addOn.maxQuantityPerUser,
        price: addOn.price,
        registrationOptions: addOn.registrationOptions.map((mapping) => ({
          includedQuantity: mapping.includedQuantity,
          optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
          registrationOptionKey: mapping.registrationOptionId,
        })),
        stripeTaxRateId: addOn.stripeTaxRateId ?? '',
        title: addOn.title,
        totalAvailableQuantity: addOn.totalAvailableQuantity,
      })),
      categoryId: template.categoryId,
      description: template.description,
      iconColor: template.icon.iconColor,
      iconName: template.icon.iconName,
      location: templateGraphLocationValueToFormModel(template.location),
      planningTips: template.planningTips ?? '',
      questions: template.questions.map((question) => ({
        description: question.description ?? '',
        id: question.id,
        key: question.id,
        registrationOptionKey: question.registrationOptionId,
        required: question.required,
        sortOrder: question.sortOrder,
        title: question.title,
      })),
      registrationOptions: writableRegistrationOptions.map((option) =>
        registrationRecordToFormModel(option),
      ),
      simpleModeEnabled: template.simpleModeEnabled,
      title: template.title,
      unlisted: template.unlisted,
    },
  };
};

const nullableNumber = (
  value: TemplateGraphNullableNumberField,
): null | number => (value === '' ? null : value);

const optionalText = (value: string): null | string => value.trim() || null;

const refundFeesValue = (
  choice: TemplateGraphRefundFeesChoice,
): boolean | null => {
  if (choice === 'default') return null;
  return choice === 'refund';
};

export const templateGraphLocationFormModelToValue = (
  location: TemplateGraphLocationFormModel,
): EventLocationType | null => {
  const address = optionalText(location.address);
  if (location.type === 'none') return null;
  if (location.type === 'online') {
    const meetingInstructions = optionalText(location.meetingInstructions);
    return {
      ...(meetingInstructions && { meetingInstructions }),
      meetingProvider: location.meetingProvider,
      meetingUrl: location.meetingUrl.trim(),
      name: location.name.trim(),
      type: 'online',
    };
  }

  const coordinates = {
    lat: location.latitude === '' ? 0 : location.latitude,
    lng: location.longitude === '' ? 0 : location.longitude,
  };
  if (location.type === 'google') {
    return {
      ...(address && { address }),
      coordinates,
      name: location.name.trim(),
      placeId: location.placeId.trim(),
      type: 'google',
    };
  }
  return {
    ...(address && { address }),
    coordinates,
    name: location.name.trim(),
    type: 'coordinate',
  };
};

const registrationFormToPayload = (
  registration: TemplateGraphRegistrationOptionFormModel,
  esnCardEnabled: boolean,
): TemplateGraphInput['registrationOptions'][number] => ({
  cancellationDeadlineHoursBeforeStart: nullableNumber(
    registration.cancellationDeadlineHoursBeforeStart,
  ),
  closeRegistrationOffset: registration.closeRegistrationOffset,
  description: optionalText(registration.description),
  esnCardDiscountedPrice:
    registration.isPaid &&
    esnCardEnabled &&
    registration.esnCardDiscountedPrice !== ''
      ? registration.esnCardDiscountedPrice
      : null,
  ...(registration.id && { id: registration.id }),
  isPaid: registration.isPaid,
  key: registration.key,
  openRegistrationOffset: registration.openRegistrationOffset,
  organizingRegistration: registration.organizingRegistration,
  price: registration.isPaid ? registration.price : 0,
  refundFeesOnCancellation: refundFeesValue(
    registration.refundFeesOnCancellation,
  ),
  registeredDescription: optionalText(registration.registeredDescription),
  registrationMode: registration.registrationMode,
  roleIds: [...registration.roleIds],
  spots: registration.spots,
  stripeTaxRateId:
    registration.isPaid && registration.stripeTaxRateId
      ? registration.stripeTaxRateId
      : null,
  title: registration.title.trim(),
  transferDeadlineHoursBeforeStart: nullableNumber(
    registration.transferDeadlineHoursBeforeStart,
  ),
});

export const templateGraphFormToPayload = (
  model: TemplateGraphFormModel,
  esnCardEnabled: boolean,
): TemplateGraphInput => ({
  addOns: model.addOns.map((addOn) => ({
    allowMultiple: addOn.allowMultiple,
    allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
    allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
    allowPurchaseDuringRegistration: addOn.allowPurchaseDuringRegistration,
    description: optionalText(addOn.description),
    ...(addOn.id && { id: addOn.id }),
    isPaid: addOn.isPaid,
    key: addOn.key,
    maxQuantityPerUser: addOn.maxQuantityPerUser,
    price: addOn.isPaid ? addOn.price : 0,
    registrationOptions: addOn.registrationOptions.map((mapping) => ({
      includedQuantity: mapping.includedQuantity,
      optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
      registrationOptionKey: mapping.registrationOptionKey,
    })),
    stripeTaxRateId:
      addOn.isPaid && addOn.stripeTaxRateId ? addOn.stripeTaxRateId : null,
    title: addOn.title.trim(),
    totalAvailableQuantity: addOn.totalAvailableQuantity,
  })),
  categoryId: model.categoryId,
  description: model.description,
  icon: {
    iconColor: model.iconColor,
    iconName: model.iconName.trim(),
  },
  location: templateGraphLocationFormModelToValue(model.location),
  planningTips: optionalText(model.planningTips),
  questions: model.questions.map((question) => ({
    description: optionalText(question.description),
    ...(question.id && { id: question.id }),
    key: question.key,
    registrationOptionKey: question.registrationOptionKey,
    required: question.required,
    sortOrder: question.sortOrder,
    title: question.title.trim(),
  })),
  registrationOptions: model.registrationOptions.map((registration) =>
    registrationFormToPayload(registration, esnCardEnabled),
  ),
  simpleModeEnabled: model.simpleModeEnabled,
  title: model.title.trim(),
  unlisted: model.unlisted,
});
