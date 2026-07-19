import {
  hidden,
  min,
  required,
  schema,
  validate,
} from '@angular/forms/signals';

import { TemplateAddonFormModel } from './template-addon-form.utilities';

export const templateAddonFormSchema = schema<TemplateAddonFormModel>(
  (form) => {
    hidden(form.price, ({ valueOf }) => !valueOf(form.isPaid));
    hidden(form.stripeTaxRateId, ({ valueOf }) => !valueOf(form.isPaid));
    min(form.maxQuantityPerUser, 1);
    min(form.price, 0);
    min(form.includedQuantity, 0);
    min(form.optionalPurchaseQuantity, 0);
    min(form.totalAvailableQuantity, 1);
    required(form.maxQuantityPerUser);
    required(form.price);
    required(form.includedQuantity);
    required(form.optionalPurchaseQuantity);
    required(form.registrationOptionKind);
    required(form.stripeTaxRateId, {
      when: ({ valueOf }) => valueOf(form.isPaid),
    });
    required(form.title);
    required(form.totalAvailableQuantity);
    validate(form.includedQuantity, ({ value, valueOf }) => {
      if (
        value() + valueOf(form.optionalPurchaseQuantity) >
        valueOf(form.totalAvailableQuantity)
      ) {
        return {
          kind: 'max',
          message:
            'Included and optional quantities cannot exceed available stock.',
        };
      }
      return;
    });
    validate(form.optionalPurchaseQuantity, ({ value, valueOf }) => {
      if (value() > valueOf(form.maxQuantityPerUser)) {
        return {
          kind: 'max',
          message: 'Optional quantity cannot exceed max per user.',
        };
      }
      if (value() + valueOf(form.includedQuantity) === 0) {
        return {
          kind: 'required',
          message: 'Configure an included or optional quantity.',
        };
      }
      return;
    });
    validate(form.maxQuantityPerUser, ({ value, valueOf }) => {
      if (value() > valueOf(form.totalAvailableQuantity)) {
        return {
          kind: 'max',
          message: 'Max per user cannot exceed available quantity.',
        };
      }
      return;
    });
  },
);
