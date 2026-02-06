import type { IconValue } from '@shared/types/icon';
import { hasTemporaryRichTextImageSources } from '@shared/utils/rich-text-media';

import { applyEach, schema, validate } from '@angular/forms/signals';
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
  validate(form.description, ({ value }) => {
    return hasTemporaryRichTextImageSources(value())
      ? {
          kind: 'richTextPendingUpload',
          message: 'Wait for image uploads to finish before saving.',
        }
      : undefined;
  });
  applyEach(form.registrationOptions, registrationOptionFormSchema);
});
