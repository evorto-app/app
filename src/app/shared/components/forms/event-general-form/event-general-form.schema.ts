import type { IconValue } from '@shared/types/icon';

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
  icon: IconValue | null;
  location: EventLocationType | null;
  registrationOptions: RegistrationOptionFormModel[];
  start: DateTime;
  title: string;
}

export const createEventGeneralFormModel = (
  overrides: Partial<EventGeneralFormModel> = {},
): EventGeneralFormModel => {
  const defaultStart = DateTime.now().plus({ weeks: 1 });
  return {
    description: '',
    end: defaultStart,
    // eslint-disable-next-line unicorn/no-null
    icon: null,
    // eslint-disable-next-line unicorn/no-null
    location: null,
    registrationOptions: [],
    start: defaultStart,
    title: '',
    ...overrides,
  };
};

export const eventGeneralFormSchema = schema<EventGeneralFormModel>((form) => {
  applyEach(form.registrationOptions, registrationOptionFormSchema);
});
