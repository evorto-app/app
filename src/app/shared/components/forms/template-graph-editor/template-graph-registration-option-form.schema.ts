import {
  hidden,
  min,
  minLength,
  required,
  schema,
  validate,
} from '@angular/forms/signals';
import { hasTemporaryRichTextImageSources } from '@shared/utils/rich-text-media';

import { TemplateGraphRegistrationOptionFormModel } from './template-graph-form.model';

export const templateGraphRegistrationOptionFormSchema =
  schema<TemplateGraphRegistrationOptionFormModel>((registration) => {
    required(registration.title, {
      message: 'Enter a registration option name.',
    });
    validate(registration.title, ({ value }) =>
      value().trim()
        ? undefined
        : {
            kind: 'required',
            message: 'Enter a registration option name.',
          },
    );
    validate(registration.description, ({ value }) =>
      hasTemporaryRichTextImageSources(value())
        ? {
            kind: 'richTextPendingUpload',
            message: 'Wait for image uploads to finish before saving.',
          }
        : undefined,
    );
    validate(registration.registeredDescription, ({ value }) =>
      hasTemporaryRichTextImageSources(value())
        ? {
            kind: 'richTextPendingUpload',
            message: 'Wait for image uploads to finish before saving.',
          }
        : undefined,
    );
    min(registration.closeRegistrationOffset, 0);
    min(registration.openRegistrationOffset, 0);
    validate(registration.closeRegistrationOffset, ({ value, valueOf }) =>
      value() > valueOf(registration.openRegistrationOffset)
        ? {
            kind: 'registrationWindowOrder',
            message: 'Registration must open before it closes.',
          }
        : undefined,
    );
    min(registration.price, 0);
    min(registration.spots, 1);
    minLength(registration.roleIds, 1, {
      message: 'Select at least one eligible role.',
    });
    required(registration.stripeTaxRateId, {
      message: 'Select an inclusive tax rate.',
      when: ({ valueOf }) => valueOf(registration.isPaid),
    });
    hidden(registration.price, ({ valueOf }) => !valueOf(registration.isPaid));
    hidden(
      registration.esnCardDiscountedPrice,
      ({ valueOf }) => !valueOf(registration.isPaid),
    );
    hidden(
      registration.stripeTaxRateId,
      ({ valueOf }) => !valueOf(registration.isPaid),
    );
    validate(registration.cancellationDeadlineHoursBeforeStart, ({ value }) => {
      const deadline = value();
      return deadline !== '' && deadline < 0
        ? { kind: 'min', message: 'Deadline cannot be negative.' }
        : undefined;
    });
    validate(registration.transferDeadlineHoursBeforeStart, ({ value }) => {
      const deadline = value();
      return deadline !== '' && deadline < 0
        ? { kind: 'min', message: 'Deadline cannot be negative.' }
        : undefined;
    });
    validate(registration.esnCardDiscountedPrice, ({ value, valueOf }) => {
      const discountedPrice = value();
      if (discountedPrice === '') return;
      if (discountedPrice < 0) {
        return {
          kind: 'min',
          message: 'Discounted price cannot be negative.',
        };
      }
      return discountedPrice > valueOf(registration.price)
        ? {
            kind: 'max',
            message: 'Discounted price cannot exceed the base price.',
          }
        : undefined;
    });
  });
