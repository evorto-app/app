export type RegistrationMode = 'application' | 'fcfs' | 'random';

export interface TemplateRegistrationFormModel {
  closeRegistrationOffset: number;
  description: string;
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

export type TemplateRegistrationSubmitData = TemplateRegistrationFormModel;

export const toTemplateRegistrationSubmitData = (
  registration: TemplateRegistrationFormModel,
): TemplateRegistrationSubmitData => ({
  closeRegistrationOffset: registration.closeRegistrationOffset,
  description: registration.description?.trim() ? registration.description : '',
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
  overrides: Partial<TemplateRegistrationFormModel>,
  previous?: TemplateRegistrationFormModel,
): TemplateRegistrationFormModel => {
  const base = previous ?? createTemplateRegistrationFormModel();
  return createTemplateRegistrationFormModel({
    closeRegistrationOffset:
      overrides.closeRegistrationOffset ?? base.closeRegistrationOffset,
    description: overrides.description ?? base.description,
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
