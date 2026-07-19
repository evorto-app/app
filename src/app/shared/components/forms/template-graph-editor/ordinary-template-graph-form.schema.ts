import {
  apply,
  applyEach,
  disabled,
  hidden,
  min,
  required,
  schema,
  validate,
} from '@angular/forms/signals';
import { hasTemporaryRichTextImageSources } from '@shared/utils/rich-text-media';

import { templateGeneralFormSchema } from '../../../../templates/shared/template-form/template-general-form.schema';
import { OrdinaryTemplateGraphFormModel } from './ordinary-template-graph-form';
import {
  TemplateGraphAddonFormModel,
  TemplateGraphQuestionFormModel,
} from './template-graph-form.model';
import { templateGraphRegistrationOptionFormSchema } from './template-graph-registration-option-form.schema';

export const templateGraphAddonFormSchema = schema<TemplateGraphAddonFormModel>(
  (addOn) => {
    required(addOn.title, { message: 'Enter an add-on name.' });
    validate(addOn.description, ({ value }) =>
      hasTemporaryRichTextImageSources(value())
        ? {
            kind: 'richTextPendingUpload',
            message: 'Wait for image uploads to finish before saving.',
          }
        : undefined,
    );
    required(addOn.maxQuantityPerUser, {
      message: 'Enter a per-user maximum.',
    });
    min(addOn.maxQuantityPerUser, 1);
    required(addOn.price, {
      message: 'Enter a price.',
      when: ({ valueOf }) => valueOf(addOn.isPaid),
    });
    min(addOn.price, 1, {
      message: 'Paid add-ons must cost at least one cent.',
    });
    required(addOn.totalAvailableQuantity, {
      message: 'Enter available stock.',
    });
    min(addOn.totalAvailableQuantity, 1);
    hidden(addOn.price, ({ valueOf }) => !valueOf(addOn.isPaid));
    hidden(addOn.stripeTaxRateId, ({ valueOf }) => !valueOf(addOn.isPaid));
    required(addOn.stripeTaxRateId, {
      message: 'Select an inclusive tax rate.',
      when: ({ valueOf }) => valueOf(addOn.isPaid),
    });
    validate(addOn.allowPurchaseDuringRegistration, ({ value, valueOf }) =>
      value() ||
      valueOf(addOn.allowPurchaseBeforeEvent) ||
      valueOf(addOn.allowPurchaseDuringEvent)
        ? undefined
        : {
            kind: 'purchaseWindow',
            message: 'Choose when this add-on is available.',
          },
    );
    validate(addOn.registrationOptions, ({ value }) => {
      const registrationOptionKeys = value().map(
        (mapping) => mapping.registrationOptionKey,
      );
      return new Set(registrationOptionKeys).size ===
        registrationOptionKeys.length
        ? undefined
        : {
            kind: 'duplicateRegistrationOption',
            message: 'Use each registration option only once.',
          };
    });
    applyEach(addOn.registrationOptions, (mapping) => {
      required(mapping.registrationOptionKey, {
        message: 'Select a registration option.',
      });
      required(mapping.includedQuantity, {
        message: 'Enter an included quantity.',
      });
      min(mapping.includedQuantity, 0);
      required(mapping.optionalPurchaseQuantity, {
        message: 'Enter an optional quantity.',
      });
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
  },
);

export const templateGraphQuestionFormSchema =
  schema<TemplateGraphQuestionFormModel>((question) => {
    required(question.title, { message: 'Enter a question.' });
    required(question.registrationOptionKey, {
      message: 'Select a registration option.',
    });
    required(question.sortOrder, { message: 'Enter a sort order.' });
    min(question.sortOrder, 0);
  });

export const ordinaryTemplateGraphFormSchema =
  schema<OrdinaryTemplateGraphFormModel>((form) => {
    apply(form, templateGeneralFormSchema);
    applyEach(
      form.registrationOptions,
      templateGraphRegistrationOptionFormSchema,
    );

    applyEach(form.addOns, templateGraphAddonFormSchema);
    applyEach(form.questions, templateGraphQuestionFormSchema);

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

export const ordinaryTemplateGraphFormSchemaWithPaymentAvailability = (
  paymentAllowed: () => boolean,
) =>
  schema<OrdinaryTemplateGraphFormModel>((form) => {
    apply(form, ordinaryTemplateGraphFormSchema);
    applyEach(form.registrationOptions, (option) => {
      disabled(option.isPaid, () => !paymentAllowed());
      disabled(option.price, () => !paymentAllowed());
      disabled(option.esnCardDiscountedPrice, () => !paymentAllowed());
      disabled(option.stripeTaxRateId, () => !paymentAllowed());
    });
    applyEach(form.addOns, (addOn) => {
      disabled(addOn.isPaid, () => !paymentAllowed());
      disabled(addOn.price, () => !paymentAllowed());
      disabled(addOn.stripeTaxRateId, () => !paymentAllowed());
    });
  });
