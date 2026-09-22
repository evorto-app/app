import {
  apply,
  hidden,
  min,
  minLength,
  required,
  schema,
  validate,
} from '@angular/forms/signals';

import { roleSelectionSchema } from '../../controls/role-select/role-selection.schema';
import { TemplateGraphRegistrationOptionFormModel } from './template-graph-form.model';

export const templateGraphRegistrationOptionFormSchema =
  schema<TemplateGraphRegistrationOptionFormModel>((registration) => {
    apply(registration.roleIds, roleSelectionSchema);
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
      message: 'Enter how long before the event sign-up closes.',
    });
    min(registration.closeRegistrationOffset, 0);
    required(registration.openRegistrationOffset, {
      message: 'Enter how long before the event sign-up opens.',
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
      message: 'Paid choices must cost at least 0.01.',
    });
    required(registration.spots, { message: 'Enter available spots.' });
    min(registration.spots, 1);
    minLength(registration.roleIds, 1, {
      message: 'Select at least one role that can use this choice.',
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
