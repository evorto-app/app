import type { WritableRegistrationMode } from '@shared/registration-modes';

import {
  resetAddOnPayment,
  resetRegistrationPayment,
} from '../payment-configuration';

export interface TemplateGraphAddonFormModel {
  allowMultiple: boolean;
  allowPurchaseBeforeEvent: boolean;
  allowPurchaseDuringEvent: boolean;
  allowPurchaseDuringRegistration: boolean;
  description: string;
  id: string;
  isPaid: boolean;
  key: string;
  maxQuantityPerUser: number;
  price: number;
  registrationOptions: TemplateGraphAddonMappingFormModel[];
  stripeTaxRateId: string;
  title: string;
  totalAvailableQuantity: number;
}
export interface TemplateGraphAddonMappingFormModel {
  includedQuantity: number;
  optionalPurchaseQuantity: number;
  registrationOptionKey: string;
}
export interface TemplateGraphFormModel {
  addOns: TemplateGraphAddonFormModel[];
  categoryId: string;
  description: string;
  iconColor: number;
  iconName: string;
  location: TemplateGraphLocationFormModel;
  planningTips: string;
  questions: TemplateGraphQuestionFormModel[];
  registrationOptions: TemplateGraphRegistrationOptionFormModel[];
  simpleModeEnabled: boolean;
  title: string;
  unlisted: boolean;
}

export interface TemplateGraphLocationFormModel {
  address: string;
  latitude: TemplateGraphNullableNumberField;
  longitude: TemplateGraphNullableNumberField;
  meetingInstructions: string;
  meetingProvider: 'googleMeet' | 'other' | 'teams' | 'zoom';
  meetingUrl: string;
  name: string;
  placeId: string;
  type: TemplateGraphLocationType;
}

export type TemplateGraphLocationType =
  'coordinate' | 'google' | 'none' | 'online';

export type TemplateGraphNullableNumberField = '' | number;

export interface TemplateGraphQuestionFormModel {
  description: string;
  id: string;
  key: string;
  registrationOptionKey: string;
  required: boolean;
  sortOrder: number;
  title: string;
}

export type TemplateGraphRefundFeesChoice =
  'default' | 'doNotRefund' | 'refund';

export interface TemplateGraphRegistrationOptionFormModel {
  cancellationDeadlineHoursBeforeStart: TemplateGraphNullableNumberField;
  closeRegistrationOffset: number;
  description: string;
  esnCardDiscountedPrice: TemplateGraphNullableNumberField;
  id: string;
  isPaid: boolean;
  key: string;
  openRegistrationOffset: number;
  organizingRegistration: boolean;
  price: number;
  refundFeesOnCancellation: TemplateGraphRefundFeesChoice;
  registeredDescription: string;
  registrationMode: WritableRegistrationMode;
  roleIds: string[];
  spots: number;
  stripeTaxRateId: string;
  title: string;
  transferDeadlineHoursBeforeStart: TemplateGraphNullableNumberField;
}

export const createTemplateGraphKey = (): string =>
  globalThis.crypto.randomUUID();

export const createTemplateGraphLocationFormModel =
  (): TemplateGraphLocationFormModel => ({
    address: '',
    latitude: '',
    longitude: '',
    meetingInstructions: '',
    meetingProvider: 'other',
    meetingUrl: '',
    name: '',
    placeId: '',
    type: 'none',
  });

export const createTemplateGraphRegistrationOptionFormModel = (
  title: string,
  spots: number,
  organizingRegistration: boolean,
  key = createTemplateGraphKey(),
): TemplateGraphRegistrationOptionFormModel => ({
  cancellationDeadlineHoursBeforeStart: '',
  closeRegistrationOffset: 1,
  description: '',
  esnCardDiscountedPrice: '',
  id: '',
  isPaid: false,
  key,
  openRegistrationOffset: 168,
  organizingRegistration,
  price: 0,
  refundFeesOnCancellation: 'default',
  registeredDescription: '',
  registrationMode: 'fcfs',
  roleIds: [],
  spots,
  stripeTaxRateId: '',
  title,
  transferDeadlineHoursBeforeStart: '',
});

export const createTemplateGraphFormModel = (): TemplateGraphFormModel => ({
  addOns: [],
  categoryId: '',
  description: '',
  iconColor: 0,
  iconName: 'calendar:fas',
  location: createTemplateGraphLocationFormModel(),
  planningTips: '',
  questions: [],
  registrationOptions: [
    createTemplateGraphRegistrationOptionFormModel(
      'Organizer registration',
      1,
      true,
    ),
    createTemplateGraphRegistrationOptionFormModel(
      'Participant registration',
      20,
      false,
    ),
  ],
  simpleModeEnabled: true,
  title: '',
  unlisted: false,
});

export const createTemplateGraphAddonFormModel = (
  registrationOptionKey?: string,
): TemplateGraphAddonFormModel => ({
  allowMultiple: false,
  allowPurchaseBeforeEvent: false,
  allowPurchaseDuringEvent: false,
  allowPurchaseDuringRegistration: true,
  description: '',
  id: '',
  isPaid: false,
  key: createTemplateGraphKey(),
  maxQuantityPerUser: 1,
  price: 0,
  registrationOptions: registrationOptionKey
    ? [
        {
          includedQuantity: 1,
          optionalPurchaseQuantity: 0,
          registrationOptionKey,
        },
      ]
    : [],
  stripeTaxRateId: '',
  title: '',
  totalAvailableQuantity: 20,
});

export const createTemplateGraphQuestionFormModel = (
  registrationOptionKey: string,
): TemplateGraphQuestionFormModel => ({
  description: '',
  id: '',
  key: createTemplateGraphKey(),
  registrationOptionKey,
  required: true,
  sortOrder: 0,
  title: '',
});

export const resetTemplateGraphPayments = <
  Model extends Pick<TemplateGraphFormModel, 'addOns' | 'registrationOptions'>,
>(
  model: Model,
): Model => {
  const addOns = model.addOns.map((addOn) => resetAddOnPayment(addOn, ''));
  const registrationOptions = model.registrationOptions.map((option) =>
    resetRegistrationPayment(option, '', ''),
  );
  const unchanged =
    addOns.every((addOn, index) => addOn === model.addOns[index]) &&
    registrationOptions.every(
      (option, index) => option === model.registrationOptions[index],
    );

  return unchanged ? model : { ...model, addOns, registrationOptions };
};
