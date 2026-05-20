import type { TemplateFindOneRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

export interface TemplateAddonFormModel {
  allowMultiple: boolean;
  allowPurchaseBeforeEvent: boolean;
  allowPurchaseDuringEvent: boolean;
  allowPurchaseDuringRegistration: boolean;
  description: string;
  isPaid: boolean;
  maxQuantityPerUser: number;
  price: number;
  quantity: number;
  registrationOptionKind: TemplateAddonRegistrationOptionKind;
  stripeTaxRateId: null | string;
  title: string;
  totalAvailableQuantity: number;
}

export type TemplateAddonRegistrationOptionKind = 'organizer' | 'participant';

export type TemplateAddonSubmitData = Omit<
  TemplateAddonFormModel,
  'description'
> & {
  description: null | string;
};

export const createTemplateAddonFormModel = (
  overrides: Partial<TemplateAddonFormModel> = {},
): TemplateAddonFormModel => ({
  allowMultiple: false,
  allowPurchaseBeforeEvent: true,
  allowPurchaseDuringEvent: false,
  allowPurchaseDuringRegistration: true,
  description: '',
  isPaid: false,
  maxQuantityPerUser: 1,
  price: 0,
  quantity: 1,
  registrationOptionKind: 'participant',
  stripeTaxRateId: null,
  title: '',
  totalAvailableQuantity: 20,
  ...overrides,
});

export const toTemplateAddonSubmitData = (
  addOn: TemplateAddonFormModel,
): TemplateAddonSubmitData => ({
  allowMultiple: addOn.allowMultiple,
  allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
  allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
  allowPurchaseDuringRegistration: addOn.allowPurchaseDuringRegistration,
  description: addOn.description.trim() || null,
  isPaid: addOn.isPaid,
  maxQuantityPerUser: addOn.maxQuantityPerUser,
  price: addOn.isPaid ? addOn.price : 0,
  quantity: addOn.quantity,
  registrationOptionKind: addOn.registrationOptionKind,
  stripeTaxRateId: addOn.isPaid ? addOn.stripeTaxRateId : null,
  title: addOn.title.trim(),
  totalAvailableQuantity: addOn.totalAvailableQuantity,
});

export const templateAddonOptionKindFromRecord = ({
  addOn,
  organizerRegistrationOptionId,
  participantRegistrationOptionId,
}: {
  addOn: TemplateFindOneRecord['addOns'][number];
  organizerRegistrationOptionId: string | undefined;
  participantRegistrationOptionId: string | undefined;
}): TemplateAddonRegistrationOptionKind => {
  const optionIds = new Set(
    addOn.registrationOptions.map((option) => option.registrationOptionId),
  );
  if (
    organizerRegistrationOptionId &&
    optionIds.has(organizerRegistrationOptionId)
  ) {
    return 'organizer';
  }
  if (
    participantRegistrationOptionId &&
    optionIds.has(participantRegistrationOptionId)
  ) {
    return 'participant';
  }
  return 'participant';
};

export const templateAddonQuantityFromRecord = ({
  addOn,
  organizerRegistrationOptionId,
  participantRegistrationOptionId,
  registrationOptionKind,
}: {
  addOn: TemplateFindOneRecord['addOns'][number];
  organizerRegistrationOptionId: string | undefined;
  participantRegistrationOptionId: string | undefined;
  registrationOptionKind: TemplateAddonRegistrationOptionKind;
}): number => {
  const registrationOptionId =
    registrationOptionKind === 'organizer'
      ? organizerRegistrationOptionId
      : participantRegistrationOptionId;
  const attachedOption = addOn.registrationOptions.find(
    (option) => option.registrationOptionId === registrationOptionId,
  );
  return attachedOption?.quantity ?? 1;
};

export const templateAddonRecordToFormModel = ({
  addOn,
  organizerRegistrationOptionId,
  participantRegistrationOptionId,
}: {
  addOn: TemplateFindOneRecord['addOns'][number];
  organizerRegistrationOptionId: string | undefined;
  participantRegistrationOptionId: string | undefined;
}): TemplateAddonFormModel => {
  const registrationOptionKind = templateAddonOptionKindFromRecord({
    addOn,
    organizerRegistrationOptionId,
    participantRegistrationOptionId,
  });
  return createTemplateAddonFormModel({
    allowMultiple: addOn.allowMultiple,
    allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
    allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
    allowPurchaseDuringRegistration: addOn.allowPurchaseDuringRegistration,
    description: addOn.description ?? '',
    isPaid: addOn.isPaid,
    maxQuantityPerUser: addOn.maxQuantityPerUser,
    price: addOn.price,
    quantity: templateAddonQuantityFromRecord({
      addOn,
      organizerRegistrationOptionId,
      participantRegistrationOptionId,
      registrationOptionKind,
    }),
    registrationOptionKind,
    stripeTaxRateId: addOn.stripeTaxRateId,
    title: addOn.title,
    totalAvailableQuantity: addOn.totalAvailableQuantity,
  });
};
