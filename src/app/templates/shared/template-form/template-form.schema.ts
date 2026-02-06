import type { IconValue } from '@shared/types/icon';

import { apply, hidden, min, required, schema } from '@angular/forms/signals';

import { EventLocationType } from '../../../../types/location';

export type RegistrationMode = 'application' | 'fcfs' | 'random';

export interface TemplateFormData {
  categoryId: string;
  description: string;
  icon: IconValue | null;
  location: EventLocationType | null;
  organizerRegistration: TemplateRegistrationFormModel;
  participantRegistration: TemplateRegistrationFormModel;
  title: string;
}

export type TemplateFormOverrides = Partial<
  Pick<
    TemplateFormData,
    'categoryId' | 'description' | 'icon' | 'location' | 'title'
  >
> & {
  organizerRegistration?: Partial<TemplateRegistrationFormModel>;
  participantRegistration?: Partial<TemplateRegistrationFormModel>;
};

export type TemplateRegistrationSubmitData = Omit<
  TemplateRegistrationFormModel,
  'title'
>;

export type TemplateFormSubmitData = Omit<
  TemplateFormData,
  'icon' | 'organizerRegistration' | 'participantRegistration'
> & {
  icon: IconValue;
  organizerRegistration: TemplateRegistrationSubmitData;
  participantRegistration: TemplateRegistrationSubmitData;
};

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
  // eslint-disable-next-line unicorn/no-null
  stripeTaxRateId: null,
  title: '',
  ...overrides,
});

export const createTemplateFormModel = (
  overrides: TemplateFormOverrides = {},
): TemplateFormData => {
  const base: TemplateFormData = {
    categoryId: '',
    description: '',
    // eslint-disable-next-line unicorn/no-null
    icon: null,
    // eslint-disable-next-line unicorn/no-null
    location: null,
    organizerRegistration: createTemplateRegistrationFormModel({
      spots: 1,
      title: 'Organizer Registration',
    }),
    participantRegistration: createTemplateRegistrationFormModel({
      spots: 20,
      title: 'Participant Registration',
    }),
    title: '',
  };

  const organizerRegistration = createTemplateRegistrationFormModel({
    ...base.organizerRegistration,
    ...overrides.organizerRegistration,
  });
  const participantRegistration = createTemplateRegistrationFormModel({
    ...base.participantRegistration,
    ...overrides.participantRegistration,
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
  const mergedIcon = overrides.icon === undefined ? base.icon : overrides.icon;

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
