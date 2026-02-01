import { applyEach, schema } from '@angular/forms/signals';
import { DateTime } from 'luxon';

import { EventLocationType } from '../../../../../types/location';
import {
  RegistrationOptionFormModel,
  registrationOptionFormSchema,
} from '../registration-option-form/registration-option-form.schema';

export interface EventGeneralFormModel {
  description: string;
  end: DateTime;
  icon: null | { iconColor: number; iconName: string };
  location: EventLocationType | null;
  registrationOptions: RegistrationOptionFormModel[];
  start: DateTime;
  title: string;
}

export const createEventGeneralFormModel = (
  overrides: Partial<EventGeneralFormModel> = {},
): EventGeneralFormModel => ({
  description: '',
  end: DateTime.now(),
  icon: null,
  location: null,
  registrationOptions: [],
  start: DateTime.now(),
  title: '',
  ...overrides,
});

export const eventGeneralFormSchema = schema<EventGeneralFormModel>((form) => {
  applyEach(form.registrationOptions, registrationOptionFormSchema);
});
