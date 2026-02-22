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
  esnCardDiscountedPrice: '' | number;
  id: string;
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
  esnCardDiscountedPrice: '',
  id: '',
  isPaid: false,
  openRegistrationTime: DateTime.now(),
  organizingRegistration: false,
  price: 0,
  registeredDescription: '',
  registrationMode: 'fcfs',
  roleIds: [],
  spots: 1,
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
    hidden(form.esnCardDiscountedPrice, ({ valueOf }) => !valueOf(form.isPaid));
    hidden(form.stripeTaxRateId, ({ valueOf }) => !valueOf(form.isPaid));
    min(form.spots, 1);
    required(form.stripeTaxRateId);
    validate(form.esnCardDiscountedPrice, ({ value, valueOf }) => {
      const discountedPrice = value();
      if (discountedPrice === '') {
        return;
      }
      if (discountedPrice < 0) {
        return {
          kind: 'min',
          message: 'Discounted price must be non-negative.',
        };
      }
      if (discountedPrice > valueOf(form.price)) {
        return {
          kind: 'max',
          message: 'Discounted price cannot exceed the base price.',
        };
      }
      return;
    });
  },
);
