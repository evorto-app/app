export type RegistrationMode = 'application' | 'fcfs' | 'random';

export interface TemplateRegistrationFormModel {
  closeRegistrationOffset: number;
  isPaid: boolean;
  openRegistrationOffset: number;
  price: number;
  registrationMode: RegistrationMode;
  roleIds: string[];
  spots: number;
  stripeTaxRateId: null | string;
  title: string;
}

export type TemplateRegistrationSubmitData = Omit<
  TemplateRegistrationFormModel,
  'title'
>;

export const createTemplateRegistrationFormModel = (
  overrides: Partial<TemplateRegistrationFormModel> = {},
): TemplateRegistrationFormModel => ({
  closeRegistrationOffset: 1,
  isPaid: false,
  openRegistrationOffset: 168,
  price: 0,
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
    isPaid: overrides.isPaid ?? base.isPaid,
    openRegistrationOffset:
      overrides.openRegistrationOffset ?? base.openRegistrationOffset,
    price: overrides.price ?? base.price,
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
