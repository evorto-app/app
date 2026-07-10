import {
  apply,
  applyEach,
  hidden,
  min,
  required,
  schema,
  validate,
} from '@angular/forms/signals';

import { templateGeneralFormSchema } from '../../../../templates/shared/template-form/template-general-form.schema';
import { OrdinaryTemplateGraphFormModel } from './ordinary-template-graph-form';
import { templateGraphRegistrationOptionFormSchema } from './template-graph-registration-option-form.schema';

export const ordinaryTemplateGraphFormSchema =
  schema<OrdinaryTemplateGraphFormModel>((form) => {
    apply(form, templateGeneralFormSchema);
    applyEach(
      form.registrationOptions,
      templateGraphRegistrationOptionFormSchema,
    );

    applyEach(form.addOns, (addOn) => {
      required(addOn.title, { message: 'Enter an add-on name.' });
      min(addOn.maxQuantityPerUser, 1);
      min(addOn.price, 1, {
        message: 'Paid add-ons must cost at least one cent.',
      });
      min(addOn.totalAvailableQuantity, 1);
      hidden(addOn.price, ({ valueOf }) => !valueOf(addOn.isPaid));
      hidden(addOn.stripeTaxRateId, ({ valueOf }) => !valueOf(addOn.isPaid));
      required(addOn.stripeTaxRateId, {
        message: 'Select an inclusive tax rate.',
        when: ({ valueOf }) => valueOf(addOn.isPaid),
      });
      applyEach(addOn.registrationOptions, (mapping) => {
        required(mapping.registrationOptionKey, {
          message: 'Select a registration option.',
        });
        min(mapping.includedQuantity, 0);
        min(mapping.optionalPurchaseQuantity, 0);
        validate(mapping.includedQuantity, ({ value, valueOf }) =>
          value() + valueOf(mapping.optionalPurchaseQuantity) === 0
            ? {
                kind: 'required',
                message: 'Set an included or optional quantity.',
              }
            : undefined,
        );
        validate(mapping.includedQuantity, ({ value, valueOf }) =>
          value() + valueOf(mapping.optionalPurchaseQuantity) >
          valueOf(addOn.totalAvailableQuantity)
            ? {
                kind: 'max',
                message:
                  'Included and optional quantities cannot exceed available stock.',
              }
            : undefined,
        );
        validate(mapping.optionalPurchaseQuantity, ({ value, valueOf }) =>
          value() > valueOf(addOn.maxQuantityPerUser)
            ? {
                kind: 'max',
                message: 'Optional quantity cannot exceed max per user.',
              }
            : undefined,
        );
      });
      validate(addOn.maxQuantityPerUser, ({ value, valueOf }) =>
        value() > valueOf(addOn.totalAvailableQuantity)
          ? {
              kind: 'max',
              message: 'Max per user cannot exceed available quantity.',
            }
          : undefined,
      );
    });

    applyEach(form.questions, (question) => {
      required(question.title, { message: 'Enter a question.' });
      required(question.registrationOptionKey, {
        message: 'Select a registration option.',
      });
      min(question.sortOrder, 0);
    });

    validate(form.simpleModeEnabled, ({ value, valueOf }) => {
      if (!value()) return;
      const options = valueOf(form.registrationOptions);
      const organizingCount = options.filter(
        (option) => option.organizingRegistration,
      ).length;
      return options.length === 2 && organizingCount === 1
        ? undefined
        : {
            kind: 'simpleModeShape',
            message:
              'Simple configuration requires exactly one organizing and one non-organizing option.',
          };
    });
  });
