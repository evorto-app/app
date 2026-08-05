import {
  hidden,
  min,
  minLength,
  required,
  schema,
  validate,
} from '@angular/forms/signals';

import { TemplateGraphRegistrationOptionFormModel } from './template-graph-form.model';

export const templateGraphRegistrationOptionFormSchema =
  schema<TemplateGraphRegistrationOptionFormModel>((registration) => {
    required(registration.title, {
      message: 'Enter a sign-up choice name.',
    });
    validate(registration.title, ({ value }) =>
      value().trim()
        ? undefined
        : {
            kind: 'required',
            message: 'Enter a sign-up choice name.',
          },
    );
    required(registration.closeRegistrationOffset, {
      message: 'Choose when sign-up closes.',
    });
    min(registration.closeRegistrationOffset, 0);
    required(registration.openRegistrationOffset, {
      message: 'Choose when sign-up opens.',
    });
    min(registration.openRegistrationOffset, 0);
    validate(registration.closeRegistrationOffset, ({ value, valueOf }) =>
      value() > valueOf(registration.openRegistrationOffset)
        ? {
            kind: 'registrationWindowOrder',
            message: 'Sign-up must open before it closes.',
          }
        : undefined,
    );
    required(registration.price, {
      message: 'Enter a price.',
      when: ({ valueOf }) => valueOf(registration.isPaid),
    });
    min(registration.price, 1, {
      message: 'A paid choice must cost at least 0.01.',
    });
    required(registration.spots, { message: 'Enter the number of places.' });
    min(registration.spots, 1);
    minLength(registration.roleIds, 1, {
      message: 'Choose who can use this sign-up choice.',
    });
    required(registration.stripeTaxRateId, {
      message: 'Select the tax included in the shown price.',
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
            message: 'Discounted price cannot exceed the regular price.',
          }
        : undefined;
    });
  });
