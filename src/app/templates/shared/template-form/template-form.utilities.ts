import type { IconValue } from '@shared/types/icon';

import {
  createTemplateGeneralFormModel,
  mergeTemplateGeneralFormOverrides,
  TemplateGeneralFormModel,
  TemplateGeneralFormOverrides,
} from './template-general-form.utilities';
import {
  createTemplateRegistrationFormModel,
  mergeTemplateRegistrationFormOverrides,
  TemplateRegistrationFormModel,
  TemplateRegistrationFormOverrides,
  TemplateRegistrationSubmitData,
} from './template-registration-option-form.utilities';

export interface TemplateFormData extends TemplateGeneralFormModel {
  organizerRegistration: TemplateRegistrationFormModel;
  participantRegistration: TemplateRegistrationFormModel;
}

export type TemplateFormOverrides = TemplateGeneralFormOverrides & {
  organizerRegistration?: TemplateRegistrationFormOverrides;
  participantRegistration?: TemplateRegistrationFormOverrides;
};

export type TemplateFormSubmitData = Omit<
  TemplateFormData,
  'icon' | 'organizerRegistration' | 'participantRegistration'
> & {
  icon: IconValue;
  organizerRegistration: TemplateRegistrationSubmitData;
  participantRegistration: TemplateRegistrationSubmitData;
};

export const createTemplateFormModel = (
  overrides: TemplateFormOverrides = {},
): TemplateFormData => {
  const base: TemplateFormData = {
    ...createTemplateGeneralFormModel(),
    organizerRegistration: createTemplateRegistrationFormModel({
      spots: 1,
      title: 'Organizer Registration',
    }),
    participantRegistration: createTemplateRegistrationFormModel({
      spots: 20,
      title: 'Participant Registration',
    }),
  };

  const organizerRegistration = mergeTemplateRegistrationFormOverrides(
    overrides.organizerRegistration ?? {},
    base.organizerRegistration,
  );
  const participantRegistration = mergeTemplateRegistrationFormOverrides(
    overrides.participantRegistration ?? {},
    base.participantRegistration,
  );
  const generalOverrides: TemplateGeneralFormOverrides = {};
  if (overrides.categoryId !== undefined) {
    generalOverrides.categoryId = overrides.categoryId;
  }
  if (overrides.description !== undefined) {
    generalOverrides.description = overrides.description;
  }
  if (overrides.icon !== undefined) {
    generalOverrides.icon = overrides.icon;
  }
  if (overrides.location !== undefined) {
    generalOverrides.location = overrides.location;
  }
  if (overrides.planningTips !== undefined) {
    generalOverrides.planningTips = overrides.planningTips;
  }
  if (overrides.title !== undefined) {
    generalOverrides.title = overrides.title;
  }
  const general = mergeTemplateGeneralFormOverrides(generalOverrides, base);

  return {
    ...general,
    organizerRegistration,
    participantRegistration,
  };
};

export const mergeTemplateFormOverrides = (
  overrides: TemplateFormOverrides,
  previous?: TemplateFormData,
): TemplateFormData => {
  const base = previous ?? createTemplateFormModel();
  return createTemplateFormModel({
    categoryId: overrides.categoryId ?? base.categoryId,
    description: overrides.description ?? base.description,
    icon: overrides.icon === undefined ? base.icon : overrides.icon,
    location:
      overrides.location === undefined ? base.location : overrides.location,
    organizerRegistration: mergeTemplateRegistrationFormOverrides(
      overrides.organizerRegistration ?? {},
      base.organizerRegistration,
    ),
    participantRegistration: mergeTemplateRegistrationFormOverrides(
      overrides.participantRegistration ?? {},
      base.participantRegistration,
    ),
    planningTips: overrides.planningTips ?? base.planningTips,
    title: overrides.title ?? base.title,
  });
};

export const templateWriteSubmitDisabled = (input: {
  formInvalid: boolean;
  formSubmitting: boolean;
  mutationPending: boolean;
}) => input.formInvalid || input.formSubmitting || input.mutationPending;
