import {
  hidden,
  min,
  minLength,
  required,
  schema,
  validate,
} from '@angular/forms/signals';
import { hasTemporaryRichTextImageSources } from '@shared/utils/rich-text-media';

import { TemplateRegistrationFormModel } from './template-registration-option-form.utilities';

export const templateRegistrationOptionFormSchema =
  schema<TemplateRegistrationFormModel>((form) => {
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
    min(form.closeRegistrationOffset, 0);
    min(form.openRegistrationOffset, 0);
    min(form.price, 0);
    min(form.spots, 1);
    minLength(form.roleIds, 1);
    required(form.closeRegistrationOffset);
    required(form.openRegistrationOffset);
    required(form.price);
    required(form.registrationMode);
    required(form.roleIds);
    required(form.spots);
    required(form.stripeTaxRateId, {
      when: ({ valueOf }) => valueOf(form.isPaid),
    });
    required(form.title);
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
  });
