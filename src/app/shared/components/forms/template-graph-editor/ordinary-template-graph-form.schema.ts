import {
  apply,
  applyEach,
  disabled,
  hidden,
  max,
  maxLength,
  min,
  required,
  schema,
  validate,
} from '@angular/forms/signals';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';

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
    required(addOn.maxQuantityPerUser, {
      message: 'Enter the maximum each person can get.',
    });
    min(addOn.maxQuantityPerUser, 1);
    max(addOn.maxQuantityPerUser, MAX_REGISTRATION_ADDON_QUANTITY, {
      message: `Each person can get at most ${MAX_REGISTRATION_ADDON_QUANTITY} items.`,
    });
    required(addOn.price, {
      message: 'Enter a price.',
      when: ({ valueOf }) => valueOf(addOn.isPaid),
    });
    min(addOn.price, 1, {
      message: 'Paid add-ons must cost at least one cent.',
    });
    required(addOn.totalAvailableQuantity, {
      message: 'Enter the total available.',
    });
    min(addOn.totalAvailableQuantity, 1);
    hidden(addOn.price, ({ valueOf }) => !valueOf(addOn.isPaid));
    hidden(addOn.stripeTaxRateId, ({ valueOf }) => !valueOf(addOn.isPaid));
    required(addOn.stripeTaxRateId, {
      message: 'Select the tax included in the shown price.',
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
            message: 'Add each sign-up choice only once.',
          };
    });
    applyEach(addOn.registrationOptions, (mapping) => {
      required(mapping.registrationOptionKey, {
        message: 'Choose a sign-up choice.',
      });
      required(mapping.includedQuantity, {
        message: 'Enter how many items are included.',
      });
      min(mapping.includedQuantity, 0);
      required(mapping.optionalPurchaseQuantity, {
        message: 'Enter how many items people can buy.',
      });
      min(mapping.optionalPurchaseQuantity, 0);
      validate(mapping.includedQuantity, ({ value, valueOf }) =>
        value() + valueOf(mapping.optionalPurchaseQuantity) === 0
          ? {
              kind: 'required',
              message: 'Include or offer at least one item.',
            }
          : undefined,
      );
      validate(mapping.includedQuantity, ({ value, valueOf }) =>
        value() + valueOf(mapping.optionalPurchaseQuantity) >
        MAX_REGISTRATION_ADDON_QUANTITY
          ? {
              kind: 'max',
              message: `Included and optional items cannot exceed ${MAX_REGISTRATION_ADDON_QUANTITY} per sign-up.`,
            }
          : undefined,
      );
      validate(mapping.includedQuantity, ({ value, valueOf }) =>
        value() + valueOf(mapping.optionalPurchaseQuantity) >
        valueOf(addOn.totalAvailableQuantity)
          ? {
              kind: 'max',
              message:
                'The amount offered with this choice cannot exceed the total available.',
            }
          : undefined,
      );
      validate(mapping.optionalPurchaseQuantity, ({ value, valueOf }) =>
        value() > valueOf(addOn.maxQuantityPerUser)
          ? {
              kind: 'max',
              message:
                'The number people can buy cannot exceed the per-person maximum.',
            }
          : undefined,
      );
    });
    validate(addOn.maxQuantityPerUser, ({ value, valueOf }) =>
      value() > valueOf(addOn.totalAvailableQuantity)
        ? {
            kind: 'max',
            message:
              'The per-person maximum cannot exceed the total available.',
          }
        : undefined,
    );
  },
);

export const templateGraphQuestionFormSchema =
  schema<TemplateGraphQuestionFormModel>((question) => {
    required(question.title, { message: 'Enter a question.' });
    maxLength(question.title, MAX_REGISTRATION_QUESTION_TITLE_LENGTH, {
      message: `Questions must be ${MAX_REGISTRATION_QUESTION_TITLE_LENGTH} characters or fewer.`,
    });
    maxLength(
      question.description,
      MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
      {
        message: `Question descriptions must be ${MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH} characters or fewer.`,
      },
    );
    required(question.registrationOptionKey, {
      message: 'Choose where this question appears.',
    });
    required(question.sortOrder, { message: 'Enter a display order.' });
    min(question.sortOrder, 0);
  });

export const ordinaryTemplateGraphFormSchema =
  schema<OrdinaryTemplateGraphFormModel>((form) => {
    apply(form, templateGeneralFormSchema);
    validate(form.addOns, ({ value }) =>
      value().length > MAX_EVENT_ADDON_TYPES
        ? {
            kind: 'maxLength',
            message: `A template can have at most ${MAX_EVENT_ADDON_TYPES} add-ons.`,
          }
        : undefined,
    );
    validate(form.questions, ({ value }) =>
      value().length > MAX_REGISTRATION_QUESTIONS
        ? {
            kind: 'maxLength',
            message: `A template can have at most ${MAX_REGISTRATION_QUESTIONS} sign-up questions.`,
          }
        : undefined,
    );
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
              'Simple setup needs exactly one organizer choice and one attendee choice.',
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
