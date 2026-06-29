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
    min(form.quantity, 1);
    min(form.totalAvailableQuantity, 1);
    required(form.maxQuantityPerUser);
    required(form.price);
    required(form.quantity);
    required(form.registrationOptionKind);
    required(form.stripeTaxRateId, {
      when: ({ valueOf }) => valueOf(form.isPaid),
    });
    required(form.title);
    required(form.totalAvailableQuantity);
    validate(form, ({ value }) => {
      const addOn = value();
      if (
        !addOn.allowPurchaseBeforeEvent &&
        !addOn.allowPurchaseDuringEvent &&
        !addOn.allowPurchaseDuringRegistration
      ) {
        return {
          kind: 'purchaseWindow',
          message: 'Select at least one purchase timing.',
        };
      }
      return;
    });
    validate(form.quantity, ({ value, valueOf }) => {
      if (value() > valueOf(form.totalAvailableQuantity)) {
        return {
          kind: 'max',
          message: 'Included quantity cannot exceed available quantity.',
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
