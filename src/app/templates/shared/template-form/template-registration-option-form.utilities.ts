export type RegistrationMode = 'application' | 'fcfs' | 'random';

export interface TemplateRegistrationFormModel {
  closeRegistrationOffset: number;
  description: string;
  esnCardDiscountedPrice: '' | number;
  isPaid: boolean;
  openRegistrationOffset: number;
  price: number;
  registeredDescription: string;
  registrationMode: RegistrationMode;
  roleIds: string[];
  spots: number;
  stripeTaxRateId: null | string;
  title: string;
}

export type TemplateRegistrationFormOverrides = Partial<
  Omit<TemplateRegistrationFormModel, 'esnCardDiscountedPrice'>
> & {
  esnCardDiscountedPrice?: '' | null | number;
};

export type TemplateRegistrationSubmitData = Omit<
  TemplateRegistrationFormModel,
  'esnCardDiscountedPrice'
> & {
  esnCardDiscountedPrice: null | number;
};

export const toTemplateRegistrationSubmitData = (
  registration: TemplateRegistrationFormModel,
  options?: { esnEnabled: boolean },
): TemplateRegistrationSubmitData => ({
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
  price: registration.isPaid ? registration.price : 0,
  registeredDescription: registration.registeredDescription?.trim()
    ? registration.registeredDescription
    : '',
  registrationMode: registration.registrationMode,
  roleIds: registration.roleIds,
  spots: registration.spots,
  stripeTaxRateId: registration.isPaid ? registration.stripeTaxRateId : null,
  title: registration.title.trim(),
});

export const createTemplateRegistrationFormModel = (
  overrides: Partial<TemplateRegistrationFormModel> = {},
): TemplateRegistrationFormModel => ({
  closeRegistrationOffset: 1,
  description: '',
  esnCardDiscountedPrice: '',
  isPaid: false,
  openRegistrationOffset: 168,
  price: 0,
  registeredDescription: '',
  registrationMode: 'fcfs',
  roleIds: [],
  spots: 1,
  stripeTaxRateId: null,
  title: '',
  ...overrides,
});

export const mergeTemplateRegistrationFormOverrides = (
  overrides: TemplateRegistrationFormOverrides,
  previous?: TemplateRegistrationFormModel,
): TemplateRegistrationFormModel => {
  const base = previous ?? createTemplateRegistrationFormModel();
  return createTemplateRegistrationFormModel({
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
  });
};
