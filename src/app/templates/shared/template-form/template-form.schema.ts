import { apply, hidden, min, required, schema } from '@angular/forms/signals';
import { EventLocationType } from '../../../../types/location';

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
}

export interface TemplateFormData {
  categoryId: string;
  description: string;
  icon: { iconColor: number; iconName: string } | null;
  location: EventLocationType | null;
  organizerRegistration: TemplateRegistrationFormModel;
  participantRegistration: TemplateRegistrationFormModel;
  title: string;
}

export type TemplateFormSubmitData = Omit<TemplateFormData, 'icon'> & {
  icon: { iconColor: number; iconName: string };
};

export type TemplateFormOverrides = Partial<
  Pick<
    TemplateFormData,
    'categoryId' | 'description' | 'icon' | 'location' | 'title'
  >
> & {
  organizerRegistration?: Partial<TemplateRegistrationFormModel>;
  participantRegistration?: Partial<TemplateRegistrationFormModel>;
};

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
  ...overrides,
});

export const createTemplateFormModel = (
  overrides: TemplateFormOverrides = {},
): TemplateFormData => {
  const base: TemplateFormData = {
    categoryId: '',
    description: '',
    icon: null,
    location: null,
    organizerRegistration: createTemplateRegistrationFormModel({ spots: 1 }),
    participantRegistration: createTemplateRegistrationFormModel({ spots: 20 }),
    title: '',
  };

  const organizerRegistration = createTemplateRegistrationFormModel({
    ...base.organizerRegistration,
    ...(overrides.organizerRegistration ?? {}),
  });
  const participantRegistration = createTemplateRegistrationFormModel({
    ...base.participantRegistration,
    ...(overrides.participantRegistration ?? {}),
  });

  return {
    ...base,
    ...overrides,
    organizerRegistration,
    participantRegistration,
  };
};

export const mergeTemplateFormOverrides = (
  overrides: TemplateFormOverrides,
  previous?: TemplateFormData,
): TemplateFormData => {
  const base = previous ?? createTemplateFormModel();
  const mergedIcon =
    overrides.icon === undefined
      ? base.icon
      : overrides.icon?.iconColor && overrides.icon?.iconName
        ? {
            iconColor: overrides.icon.iconColor,
            iconName: overrides.icon.iconName,
          }
        : null;

  const organizerRegistration = overrides.organizerRegistration
    ? {
        ...base.organizerRegistration,
        ...overrides.organizerRegistration,
      }
    : base.organizerRegistration;
  const participantRegistration = overrides.participantRegistration
    ? {
        ...base.participantRegistration,
        ...overrides.participantRegistration,
      }
    : base.participantRegistration;

  return createTemplateFormModel({
    categoryId: overrides.categoryId ?? base.categoryId,
    description: overrides.description ?? base.description,
    icon: mergedIcon,
    location:
      overrides.location === undefined ? base.location : overrides.location,
    organizerRegistration,
    participantRegistration,
    title: overrides.title ?? base.title,
  });
};

const templateRegistrationSchema = schema<TemplateRegistrationFormModel>(
  (form) => {
    hidden(form.price, ({ valueOf }) => !valueOf(form.isPaid));
    hidden(form.stripeTaxRateId, ({ valueOf }) => !valueOf(form.isPaid));
    min(form.price, 0);
    min(form.spots, 1);
    required(form.stripeTaxRateId);
  },
);

export const templateFormSchema = schema<TemplateFormData>((form) => {
  apply(form.organizerRegistration, templateRegistrationSchema);
  apply(form.participantRegistration, templateRegistrationSchema);
});
