import { applyEach, schema } from '@angular/forms/signals';

import { EventLocationType } from '../../../../../types/location';
import {
  RegistrationOptionFormModel,
  registrationOptionFormSchema,
} from '../registration-option-form/registration-option-form.schema';

export interface EventGeneralFormModel {
  description: string;
  end: Date;
  icon: null | { iconColor: number; iconName: string };
  location: EventLocationType | null;
  registrationOptions: RegistrationOptionFormModel[];
  start: Date;
  title: string;
}

export const createEventGeneralFormModel = (
  overrides: Partial<EventGeneralFormModel> = {},
): EventGeneralFormModel => ({
  description: '',
  end: new Date(),
  icon: null,
  location: null,
  registrationOptions: [],
  start: new Date(),
  title: '',
  ...overrides,
});

export const eventGeneralFormSchema = schema<EventGeneralFormModel>((form) => {
  applyEach(form.registrationOptions, registrationOptionFormSchema);
});
