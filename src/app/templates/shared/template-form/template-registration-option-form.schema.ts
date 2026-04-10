import {
  hidden,
  min,
  minLength,
  required,
  schema,
} from '@angular/forms/signals';

import { TemplateRegistrationFormModel } from './template-registration-option-form.utilities';

export const templateRegistrationOptionFormSchema =
  schema<TemplateRegistrationFormModel>((form) => {
    hidden(form.price, ({ valueOf }) => !valueOf(form.isPaid));
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
  });
