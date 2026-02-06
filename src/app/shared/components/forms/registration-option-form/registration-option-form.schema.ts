import {
  hidden,
  min,
  required,
  schema,
  validate,
} from '@angular/forms/signals';
import { hasTemporaryRichTextImageSources } from '@shared/utils/rich-text-media';
import { DateTime } from 'luxon';

export interface RegistrationOptionFormModel {
  closeRegistrationTime: DateTime;
  description: string;
  isPaid: boolean;
  openRegistrationTime: DateTime;
  organizingRegistration: boolean;
  price: number;
  registeredDescription: string;
  registrationMode: 'application' | 'fcfs' | 'random';
  roleIds: string[];
  spots: number;
  stripeTaxRateId: null | string;
  title: string;
}

export const createRegistrationOptionFormModel = (
  overrides: Partial<RegistrationOptionFormModel> = {},
): RegistrationOptionFormModel => ({
  closeRegistrationTime: DateTime.now(),
  description: '',
  isPaid: false,
  openRegistrationTime: DateTime.now(),
  organizingRegistration: false,
  price: 0,
  registeredDescription: '',
  registrationMode: 'fcfs',
  roleIds: [],
  spots: 1,
  // eslint-disable-next-line unicorn/no-null
  stripeTaxRateId: null,
  title: '',
  ...overrides,
});

export const registrationOptionFormSchema = schema<RegistrationOptionFormModel>(
  (form) => {
    validate(form.description, ({ value }) => {
      return hasTemporaryRichTextImageSources(value())
        ? {
            kind: 'richTextPendingUpload',
            message: 'Wait for image uploads to finish before saving.',
          }
        : undefined;
    });
    validate(form.registeredDescription, ({ value }) => {
      return hasTemporaryRichTextImageSources(value())
        ? {
            kind: 'richTextPendingUpload',
            message: 'Wait for image uploads to finish before saving.',
          }
        : undefined;
    });
    hidden(form.price, ({ valueOf }) => !valueOf(form.isPaid));
    hidden(form.stripeTaxRateId, ({ valueOf }) => !valueOf(form.isPaid));
    min(form.spots, 1);
    required(form.stripeTaxRateId);
  },
);
