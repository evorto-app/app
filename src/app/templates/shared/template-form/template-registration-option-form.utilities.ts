import {
  type RegistrationMode,
  requireWritableRegistrationMode,
  type WritableRegistrationMode,
} from '@shared/registration-modes';

export interface TemplateRegistrationFormModel {
  cancellationDeadlineHoursBeforeStart: null | number;
  closeRegistrationOffset: number;
  description: string;
  esnCardDiscountedPrice: '' | number;
  isPaid: boolean;
  openRegistrationOffset: number;
  price: '' | number;
  refundFeesOnCancellation: boolean | null;
  registeredDescription: string;
  registrationMode: RegistrationMode;
  roleIds: string[];
  spots: number;
  stripeTaxRateId: null | string;
  title: string;
  transferDeadlineHoursBeforeStart: null | number;
}

export type TemplateRegistrationFormOverrides = Partial<
  Omit<TemplateRegistrationFormModel, 'esnCardDiscountedPrice'>
> & {
  esnCardDiscountedPrice?: '' | null | number;
};

export type TemplateRegistrationSubmitData = Omit<
  TemplateRegistrationFormModel,
  'esnCardDiscountedPrice' | 'price' | 'registrationMode'
> & {
  esnCardDiscountedPrice: null | number;
  price: number;
  registrationMode: WritableRegistrationMode;
};

export const toTemplateRegistrationSubmitData = (
  registration: TemplateRegistrationFormModel,
  options?: { esnEnabled: boolean },
): TemplateRegistrationSubmitData => ({
  cancellationDeadlineHoursBeforeStart:
    registration.cancellationDeadlineHoursBeforeStart,
  closeRegistrationOffset: registration.closeRegistrationOffset,
  description: registration.description?.trim() ? registration.description : '',
  esnCardDiscountedPrice:
    (options?.esnEnabled ?? true) &&
    registration.isPaid &&
    registration.esnCardDiscountedPrice !== ''
      ? registration.esnCardDiscountedPrice
      : null,
  isPaid: registration.isPaid,
  openRegistrationOffset: registration.openRegistrationOffset,
  price:
    registration.isPaid && registration.price !== '' ? registration.price : 0,
  refundFeesOnCancellation: registration.refundFeesOnCancellation,
  registeredDescription: registration.registeredDescription?.trim()
    ? registration.registeredDescription
    : '',
  registrationMode: requireWritableRegistrationMode(
    registration.registrationMode,
  ),
  roleIds: registration.roleIds,
  spots: registration.spots,
  stripeTaxRateId: registration.isPaid ? registration.stripeTaxRateId : null,
  title: registration.title.trim(),
  transferDeadlineHoursBeforeStart:
    registration.transferDeadlineHoursBeforeStart,
});

export const createTemplateRegistrationFormModel = (
  overrides: Partial<TemplateRegistrationFormModel> = {},
): TemplateRegistrationFormModel => ({
  cancellationDeadlineHoursBeforeStart: null,
  closeRegistrationOffset: 1,
  description: '',
  esnCardDiscountedPrice: '',
  isPaid: false,
  openRegistrationOffset: 168,
  price: 0,
  refundFeesOnCancellation: null,
  registeredDescription: '',
  registrationMode: 'fcfs',
  roleIds: [],
  spots: 1,
  stripeTaxRateId: null,
  title: '',
  transferDeadlineHoursBeforeStart: null,
  ...overrides,
});

export const mergeTemplateRegistrationFormOverrides = (
  overrides: TemplateRegistrationFormOverrides,
  previous?: TemplateRegistrationFormModel,
): TemplateRegistrationFormModel => {
  const base = previous ?? createTemplateRegistrationFormModel();
  return createTemplateRegistrationFormModel({
    cancellationDeadlineHoursBeforeStart:
      overrides.cancellationDeadlineHoursBeforeStart === undefined
        ? base.cancellationDeadlineHoursBeforeStart
        : overrides.cancellationDeadlineHoursBeforeStart,
    closeRegistrationOffset:
      overrides.closeRegistrationOffset ?? base.closeRegistrationOffset,
    description: overrides.description ?? base.description,
    esnCardDiscountedPrice:
      overrides.esnCardDiscountedPrice === undefined
        ? base.esnCardDiscountedPrice
        : (overrides.esnCardDiscountedPrice ?? ''),
    isPaid: overrides.isPaid ?? base.isPaid,
    openRegistrationOffset:
      overrides.openRegistrationOffset ?? base.openRegistrationOffset,
    price: overrides.price ?? base.price,
    refundFeesOnCancellation:
      overrides.refundFeesOnCancellation === undefined
        ? base.refundFeesOnCancellation
        : overrides.refundFeesOnCancellation,
    registeredDescription:
      overrides.registeredDescription ?? base.registeredDescription,
    registrationMode: overrides.registrationMode ?? base.registrationMode,
    roleIds: overrides.roleIds ?? base.roleIds,
    spots: overrides.spots ?? base.spots,
    stripeTaxRateId:
      overrides.stripeTaxRateId === undefined
        ? base.stripeTaxRateId
        : overrides.stripeTaxRateId,
    title: overrides.title ?? base.title,
    transferDeadlineHoursBeforeStart:
      overrides.transferDeadlineHoursBeforeStart === undefined
        ? base.transferDeadlineHoursBeforeStart
        : overrides.transferDeadlineHoursBeforeStart,
  });
};

export { type RegistrationMode } from '@shared/registration-modes';
